const API    = ""
const WS_URL = `ws://${location.host}/ws/vision`

let currentQuestion  = ""
let questionNumber   = 1
const totalQuestions = 10

// ── WEBCAM ─────────────────────────────────────────────────────────────────────

let visionWS     = null
let wsReady      = false
let mpFace       = null
let detectTimer  = null
let offscreenCtx = null
let latestFlags  = { extra_person: false, device: false, face_turned: false }

async function startWebcam() {
    showCamState("loading")
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const video  = document.getElementById("webcam")
        video.srcObject = stream

        // Fix: resolve immediately if metadata already loaded, otherwise wait
        await new Promise(r => {
            if (video.readyState >= 1) return r()
            video.onloadedmetadata = r
            setTimeout(r, 3000) // fallback timeout so it never hangs
        })

        await video.play().catch(() => {}) // play() can throw on some browsers, ignore
        showCamState("live")

        // Init MediaPipe in background — don't block camera display
        document.getElementById("posture-badge").textContent = "Loading AI..."
        initMediaPipe(video).then(() => {
            document.getElementById("posture-badge").textContent = "Detecting..."
        }).catch(err => {
            console.warn("MediaPipe failed:", err)
            document.getElementById("posture-badge").textContent = "AI unavailable"
        })

        connectVisionWS()

    } catch (err) {
        console.error("Webcam error:", err)
        showCamState("error")
        document.getElementById("wc-metrics").style.opacity = "0.45"
    }
}

function retryCamera() {
    showCamState("loading")
    startWebcam()
}

function showCamState(state) {
    document.getElementById("cam-loading").style.display = state === "loading" ? "flex" : "none"
    document.getElementById("cam-error").style.display   = state === "error"   ? "flex" : "none"
    document.getElementById("webcam").style.display      = state === "live"    ? "block" : "none"
    document.getElementById("wc-overlay").style.display  = state === "live"    ? "flex" : "none"
    document.getElementById("live-badge").style.opacity  = state === "live"    ? "1" : "0.3"
}

// ── VIOLATION TIMER SYSTEM ─────────────────────────────────────────────────────
// Each violation type must be continuously detected for 7s before it counts.
// face_turned also uses 7s. Violations cap at 8 → auto-redirect.

const VIOLATION_THRESHOLD_MS = 7000  // 7 seconds continuous detection
const MAX_VIOLATIONS         = 8

const violationCounts = { extra_person: 0, device: 0, face_turned: 0 }

// Tracks when each flag first became true (null = not currently active)
const flagSince = { extra_person: null, device: null, face_turned: null }

// Tracks if a violation is currently "in cooldown" (prevent double-counting same event)
const flagCooldown = { extra_person: false, device: false, face_turned: false }

let totalViolations = 0

// Called every detection tick with the current true/false state of each flag
function processViolationFlags(flags) {
    const now = Date.now()
    const keys = ['extra_person', 'device', 'face_turned']

    keys.forEach(key => {
        if (flags[key]) {
            // Flag is active — start timer if not already started
            if (flagSince[key] === null) flagSince[key] = now

            const elapsed = now - flagSince[key]

            // Show a warning countdown toast after 3s so user can correct themselves
            if (elapsed >= 3000 && elapsed < VIOLATION_THRESHOLD_MS && !flagCooldown[key]) {
                const remaining = Math.ceil((VIOLATION_THRESHOLD_MS - elapsed) / 1000)
                const labels = {
                    extra_person: `👥 Extra person detected — violation in ${remaining}s`,
                    device:       `📱 Device detected — violation in ${remaining}s`,
                    face_turned:  `👀 Look at the camera — violation in ${remaining}s`
                }
                showToast(labels[key], 'warn')
            }

            // Threshold reached → register violation
            if (elapsed >= VIOLATION_THRESHOLD_MS && !flagCooldown[key]) {
                flagCooldown[key] = true   // lock so it only fires once per continuous event
                registerViolation(key)
            }
        } else {
            // Flag cleared — reset timer and cooldown so next occurrence is tracked fresh
            flagSince[key]    = null
            flagCooldown[key] = false
        }
    })
}

function registerViolation(key) {
    violationCounts[key]++
    totalViolations++

    // Update UI counts
    document.getElementById(`viol-${key}`).textContent = violationCounts[key]

    // Flash the row
    const row = document.getElementById(`viol-row-${key}`)
    if (row) {
        row.classList.add('viol-flash')
        setTimeout(() => row.classList.remove('viol-flash'), 1200)
    }

    // Update total badge
    const tb = document.getElementById('viol-total')
    tb.textContent = totalViolations
    tb.className   = 'viol-total-badge has-violations'

    const labels = {
        extra_person: 'Extra person — violation logged!',
        device:       'Device detected — violation logged!',
        face_turned:  'Face turned away — violation logged!'
    }
    showToast(`🚨 ${labels[key]}`, 'danger')

    // Deduct score penalty (stored in localStorage, applied at report time)
    const current = parseFloat(localStorage.getItem('violation_penalty') || '0')
    localStorage.setItem('violation_penalty', (current + 1.0).toFixed(1))

    // Auto-redirect when max violations hit
    if (totalViolations >= MAX_VIOLATIONS) {
        showToast('🚫 Too many violations — ending interview!', 'danger')
        setTimeout(() => completeInterview(), 2500)
    }
}

// ── MEDIAPIPE ──────────────────────────────────────────────────────────────────

async function initMediaPipe(video) {
    mpFace = new FaceDetection({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/${f}`
    })
    mpFace.setOptions({ model: "short", minDetectionConfidence: 0.5 })
    mpFace.onResults(onFaceResults)
    await mpFace.send({ image: video })

    const c = document.createElement("canvas")
    c.width = 160; c.height = 120
    offscreenCtx = c.getContext("2d")

    detectTimer = setInterval(() => runDetection(video), 1000)
}

async function runDetection(video) {
    if (video.readyState < 2) return
    await mpFace.send({ image: video })

    // ── Device detection via edge density ──
    offscreenCtx.drawImage(video, 0, 0, 160, 120)
    const pixels = offscreenCtx.getImageData(0, 0, 160, 120).data
    const W = 160, H = 120
    let edges = 0
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i  = (y * W + x) * 4
            const gx = Math.abs((pixels[i-4]+pixels[i-3]+pixels[i-2])/3 - (pixels[i+4]+pixels[i+5]+pixels[i+6])/3)
            const gy = Math.abs((pixels[i-W*4]+pixels[i-W*4+1]+pixels[i-W*4+2])/3 - (pixels[i+W*4]+pixels[i+W*4+1]+pixels[i+W*4+2])/3)
            if (gx + gy > 60) edges++
        }
    }
    latestFlags.device = (edges / ((W-2)*(H-2))) > 0.18

    latestFlags.voice_confidence = _analyseVoiceConfidence()

    // Run the 7-second violation timer logic
    processViolationFlags(latestFlags)

    if (wsReady && visionWS.readyState === WebSocket.OPEN) {
        visionWS.send(JSON.stringify({ ...latestFlags, violation_counts: violationCounts, total_violations: totalViolations }))
    }
}

function onFaceResults(results) {
    const faces = results.detections || []
    latestFlags.extra_person = faces.length > 1
    if (faces.length === 0) {
        latestFlags.face_turned = true
        return
    }
    if (faces.length === 1) {
        const kp = faces[0].landmarks
        if (kp && kp.length >= 6) {
            const nose = kp[2].x, rEar = kp[4].x, lEar = kp[5].x
            const faceW = Math.abs(lEar - rEar)
            latestFlags.face_turned = faceW > 0.01 && (Math.abs(nose - (rEar+lEar)/2) / faceW) > 0.30
        } else { latestFlags.face_turned = false }
    } else { latestFlags.face_turned = false }
}

// ── WEBSOCKET ──────────────────────────────────────────────────────────────────

function connectVisionWS() {
    const token = localStorage.getItem("token")
    if (!token) return
    visionWS = new WebSocket(`${WS_URL}?token=${token}`)
    setWsDot("connecting")
    visionWS.onopen    = () => { wsReady = true;  setWsDot("connected") }
    visionWS.onmessage = e  => { try { renderMetrics(JSON.parse(e.data)) } catch {} }
    visionWS.onclose   = () => { wsReady = false; setWsDot("disconnected"); setTimeout(connectVisionWS, 3000) }
    visionWS.onerror   = () => visionWS.close()
}

function setWsDot(state) {
    const dot = document.getElementById("wc-ws-dot")
    dot.className = "wc-ws-dot " + state
    dot.title = { connecting: "Connecting to AI...", connected: "AI connected", disconnected: "Reconnecting..." }[state] || ""
}

// ── METRICS ────────────────────────────────────────────────────────────────────

function renderMetrics(d) {
    if (d.confidence  != null) setBar("confidence",  d.confidence,  10)
    if (d.engagement  != null) setBar("engagement",  d.engagement,  10)
    if (d.nervousness != null) setBar("nervousness", d.nervousness, 10)

    if (d.posture != null) {
        const badge = document.getElementById("posture-badge")
        badge.textContent = d.posture
        badge.className   = "wc-posture-badge " + (d.posture_ok ? "ok" : "warn")
    }

    if (d.warning) showToast("⚠️ " + d.warning, 'warn')
}

function showToast(msg, level = 'warn') {
    const t = document.getElementById("wc-warning")
    t.textContent = msg
    t.style.display = "block"
    t.style.background = level === 'danger'
        ? 'rgba(192,57,43,0.92)'
        : 'rgba(180,83,9,0.88)'
    clearTimeout(t._t)
    t._t = setTimeout(() => { t.style.display = "none" }, level === 'danger' ? 5000 : 3000)
}

function setBar(metric, value, max) {
    document.getElementById("bar-" + metric).style.width = Math.round((value/max)*100) + "%"
    document.getElementById("val-" + metric).textContent = value != null ? value.toFixed(1) : "—"
}

function setBg(mode, el) {
    document.querySelectorAll(".wc-bg-btn").forEach(b => b.classList.remove("active"))
    el.classList.add("active")
    const v = document.getElementById("webcam")
    v.style.filter = mode === "blur" ? "blur(8px)" : mode === "office" ? "sepia(0.3) brightness(0.88) contrast(1.08)" : "none"
}

window.addEventListener("beforeunload", () => {
    clearInterval(detectTimer)
    if (visionWS) visionWS.close()
})

// ── VOICE ──────────────────────────────────────────────────────────────────────

let recognition     = null
let isListening     = false
let _committedText  = ""       // finalized transcript so far
let _interimText    = ""       // live interim (not yet final)

// Tone analysis via AudioContext
let _audioCtx       = null
let _analyser       = null
let _micSource      = null
let _toneTimer      = null

// Tone metrics accumulated while speaking
let _tonesamples    = []       // array of { rms, dominantFreq } per sample
let _silenceStart   = null
let _pauseCount     = 0
let _lastSoundTime  = null

const FILLERS = /\b(uh|um|like|you know|basically|literally|actually|so|right|okay|hmm)\b/gi

// ── Audio tone analyser ────────────────────────────────────────────────────────
async function startToneAnalysis() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        _audioCtx  = new (window.AudioContext || window.webkitAudioContext)()
        _analyser  = _audioCtx.createAnalyser()
        _analyser.fftSize = 2048
        _micSource = _audioCtx.createMediaStreamSource(stream)
        _micSource.connect(_analyser)

        const freqBuf  = new Uint8Array(_analyser.frequencyBinCount)
        const timeBuf  = new Float32Array(_analyser.fftSize)

        _toneTimer = setInterval(() => {
            _analyser.getByteFrequencyData(freqBuf)
            _analyser.getFloatTimeDomainData(timeBuf)

            // RMS volume (0–1)
            let sum = 0
            for (let i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i]
            const rms = Math.sqrt(sum / timeBuf.length)

            // Dominant frequency bin (voice range 85–255 Hz)
            const binHz   = _audioCtx.sampleRate / _analyser.fftSize
            const voiceLo = Math.floor(85  / binHz)
            const voiceHi = Math.floor(255 / binHz)
            let maxAmp = 0, dominantBin = voiceLo
            for (let i = voiceLo; i <= voiceHi; i++) {
                if (freqBuf[i] > maxAmp) { maxAmp = freqBuf[i]; dominantBin = i }
            }
            const dominantFreq = dominantBin * binHz

            // Silence / pause tracking
            if (rms > 0.01) {
                if (_silenceStart !== null) {
                    if (Date.now() - _silenceStart > 1500) _pauseCount++
                    _silenceStart = null
                }
                _lastSoundTime = Date.now()
                _tonesamples.push({ rms, dominantFreq })
            } else {
                if (_silenceStart === null && _lastSoundTime !== null) _silenceStart = Date.now()
            }

            // Update confidence bar live while speaking
            if (isListening) {
                const score = _calcToneConfidence()
                if (score !== null) {
                    setBar('confidence', score, 10)
                    latestFlags.voice_confidence = score
                }
            }
        }, 200)
    } catch (err) {
        console.warn('Tone analysis unavailable:', err)
    }
}

function stopToneAnalysis() {
    clearInterval(_toneTimer)
    if (_micSource)  _micSource.disconnect()
    if (_audioCtx)   _audioCtx.close()
    _audioCtx = _analyser = _micSource = null
}

// Confidence score 1–10 based purely on tone signals
function _calcToneConfidence() {
    if (_tonesamples.length < 5) return null

    const recent = _tonesamples.slice(-30)  // last ~6 seconds of samples

    // Average volume — too quiet or too loud = less confident
    const avgRms = recent.reduce((s, x) => s + x.rms, 0) / recent.length
    let score = 7.0
    if (avgRms < 0.03) score -= 2.5        // very quiet / mumbling
    else if (avgRms < 0.06) score -= 1.0   // slightly quiet
    else if (avgRms > 0.5)  score -= 1.5   // shouting

    // Pitch stability — high variance = nervous/shaky voice
    const freqs   = recent.map(x => x.dominantFreq)
    const avgFreq = freqs.reduce((s, f) => s + f, 0) / freqs.length
    const variance = freqs.reduce((s, f) => s + Math.pow(f - avgFreq, 2), 0) / freqs.length
    const stdDev  = Math.sqrt(variance)
    if (stdDev > 40) score -= 1.5          // very shaky pitch
    else if (stdDev > 20) score -= 0.5     // slightly unstable

    // Pause penalty
    score -= _pauseCount * 0.4

    // Filler word penalty (from transcript)
    const fillerMatches = (_committedText.match(FILLERS) || []).length
    const wordCount     = _committedText.trim().split(/\s+/).filter(Boolean).length
    if (wordCount > 3) score -= (fillerMatches / wordCount) * 10

    return Math.round(Math.min(Math.max(score, 1), 10) * 10) / 10
}

// Public getter used by runDetection
function _analyseVoiceConfidence() {
    return _calcToneConfidence()
}

// ── Speech recognition (transcription into answer box) ─────────────────────────
function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
        document.getElementById("mic-btn-text").textContent = "Not supported"
        document.getElementById("mic-btn").disabled = true
        document.getElementById("voice-status-badge").textContent = "N/A"
        return
    }
    recognition = new SR()
    recognition.continuous     = true
    recognition.interimResults = true
    recognition.lang           = "en-US"

    recognition.onresult = e => {
        let newFinal = ""
        _interimText = ""

        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript
            if (e.results[i].isFinal) {
                newFinal += t + " "
            } else {
                _interimText += t
            }
        }

        if (newFinal) _committedText += newFinal

        // Show committed text + live interim preview in the answer box
        _renderTranscript()
    }

    recognition.onstart = () => {
        isListening = true
        setVoiceState(true)
    }

    recognition.onend = () => {
        isListening  = false
        _interimText = ""
        _renderTranscript()   // keep committed text, clear interim
        setVoiceState(false)
    }

    recognition.onerror = e => {
        // 'no-speech' is normal — don't show error for it
        if (e.error === 'no-speech') return
        isListening  = false
        _interimText = ""
        setVoiceState(false)
        document.getElementById("voice-status-badge").textContent = "Error"
    }
}

// Renders committed + interim into the textarea with visual distinction
function _renderTranscript() {
    const box = document.getElementById("answer-input")
    // Committed text is real value; interim shown as a data attribute for CSS styling
    box.value = _committedText + _interimText
    // Scroll to bottom so user always sees latest text
    box.scrollTop = box.scrollHeight
}

function setVoiceState(on) {
    document.getElementById("mic-dot").className        = on ? "mic-dot active" : "mic-dot"
    document.getElementById("mic-label").textContent    = on ? "Listening..." : "Mic off"
    document.getElementById("mic-btn-text").textContent = on ? "Stop Speaking" : "Start Speaking"
    document.getElementById("mic-btn").classList.toggle("listening", on)
    document.getElementById("voice-status-badge").textContent = on ? "Live" : "Off"
    document.getElementById("voice-status-badge").className   = "wc-voice-status" + (on ? " live" : "")
    document.getElementById("wc-waveform").classList.toggle("active", on)
    document.getElementById("answer-input").classList.toggle("listening", on)
}

function toggleMic() {
    if (!recognition) return
    if (isListening) {
        recognition.stop()
    } else {
        // Reset tone metrics for this new speaking session
        _tonesamples   = []
        _pauseCount    = 0
        _silenceStart  = null
        _lastSoundTime = null
        // Keep _committedText so user can speak in multiple bursts
        recognition.start()
    }
}

// ── AUTH ───────────────────────────────────────────────────────────────────────

function getToken() {
    const token = localStorage.getItem("token")
    if (!token) window.location.href = "/index.html"
    return token
}

// ── INTERVIEW FLOW ─────────────────────────────────────────────────────────────

async function startInterview() {
    const sessionId = localStorage.getItem("session_id")
    const role      = localStorage.getItem("role")
    const company   = localStorage.getItem("company")

    document.getElementById("role-display").textContent    = role    || ""
    document.getElementById("company-display").textContent = company || ""

    if (!sessionId) {
        document.getElementById("question-text").textContent = "No session found. Please go back to dashboard."
        return
    }

    try {
        const res  = await fetch(`${API}/interview/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({ session_id: parseInt(sessionId) })
        })
        const data = await res.json()
        if (res.ok) {
            currentQuestion = data.question
            document.getElementById("question-text").textContent = data.question
        } else {
            document.getElementById("question-text").textContent = `Error ${res.status}: ${data.detail || "Failed to load question."}`
        }
    } catch (err) {
        document.getElementById("question-text").textContent = `Network error: ${err.message}`
    }
}

async function submitAnswer() {
    const answer = document.getElementById("answer-input").value.trim()
    if (!answer) { alert("Please type or speak your answer before submitting!"); return }

    const sessionId = localStorage.getItem("session_id")
    const btn = document.getElementById("submit-btn")
    btn.textContent = "Evaluating..."; btn.disabled = true

    try {
        const res  = await fetch(`${API}/interview/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({ session_id: parseInt(sessionId), question: currentQuestion, answer })
        })
        const data = await res.json()
        if (res.ok) {
            showFeedback(data)
            if (data.interview_complete || questionNumber >= totalQuestions) { await completeInterview(); return }
            questionNumber++
            updateProgress()
            currentQuestion = data.next_question
            document.getElementById("question-text").textContent = data.next_question
            document.getElementById("answer-input").value = ""
            _committedText = ""   // reset transcript for next question
            _interimText   = ""
        } else {
            alert(`Error ${res.status}: ${data.detail || "Failed to submit answer."}`)
        }
    } catch (err) { alert(`Network error: ${err.message}`) }

    btn.textContent = "Submit Answer →"; btn.disabled = false
}

function showFeedback(data) {
    document.getElementById("live-feedback").style.display = "block"
    document.getElementById("sbr-pill").textContent        = `SBR: ${data.sbr_score}/10`
    document.getElementById("confidence-pill").textContent = `Confidence: ${data.confidence_score}/10`
    document.getElementById("clarity-pill").textContent    = `Clarity: ${data.clarity_score}/10`
    document.getElementById("feedback-text").textContent   = data.feedback
    document.getElementById("missing-sbr").textContent     = data.missing_sbr?.length
        ? `⚠️ Missing: ${data.missing_sbr.join(", ")}` : "✅ Great SBR structure!"
}

function updateProgress() {
    document.getElementById("progress-fill").style.width    = `${(questionNumber/totalQuestions)*100}%`
    document.getElementById("question-counter").textContent = `Question ${questionNumber} / ${totalQuestions}`
}

async function completeInterview() {
    clearInterval(detectTimer)
    if (visionWS) visionWS.close()
    const sessionId = localStorage.getItem("session_id")

    // Store violation summary for report page
    localStorage.setItem('violation_counts', JSON.stringify(violationCounts))
    localStorage.setItem('total_violations', totalViolations)

    try {
        await fetch(`${API}/interview/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({
                session_id: parseInt(sessionId),
                violation_penalty: parseFloat(localStorage.getItem('violation_penalty') || '0'),
                total_violations: totalViolations
            })
        })
    } catch (err) { console.error(err) }
    window.location.href = "/report.html"
}

// ── INIT ───────────────────────────────────────────────────────────────────────

window.onload = () => { startWebcam(); setupVoice(); startToneAnalysis(); startInterview() }
