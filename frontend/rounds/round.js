// ── round.js — shared logic for all specialty round pages ──────────────────
const API    = ""
const WS_URL = `ws://${location.host}/ws/vision`

let currentQuestion  = ""
let questionNumber   = 1
let totalQuestions   = 10
let roundType        = localStorage.getItem("round_type") || "technical"

// ── TIMER SETTINGS (read from dashboard localStorage) ─────────────────────
const _timerEnabled = localStorage.getItem("timerEnabled") === "1"
const _timerSeconds = parseInt(localStorage.getItem("timerSeconds") || "60")

const ROUND_META = {
    technical:          { total: 15, label: "Technical Round",       timer: _timerEnabled, timerSec: _timerSeconds },
    hr:                 { total: 10, label: "HR Round",               timer: _timerEnabled, timerSec: _timerSeconds },
    case_study:         { total: 5,  label: "Case Study Round",       timer: _timerEnabled, timerSec: _timerSeconds },
    rapid_fire:         { total: 20, label: "Rapid Fire Round",       timer: true,          timerSec: 30 },
    resume_deep_dive:   { total: 8,  label: "Resume Deep Dive",       timer: _timerEnabled, timerSec: _timerSeconds },
    salary_negotiation: { total: 6,  label: "Salary Negotiation",     timer: _timerEnabled, timerSec: _timerSeconds },
}

const meta = ROUND_META[roundType] || ROUND_META.technical
totalQuestions = meta.total

// ── AUTH ───────────────────────────────────────────────────────────────────
function getToken() {
    const t = localStorage.getItem("token")
    if (!t) window.location.href = "/index.html"
    return t
}

// ── WEBCAM + MEDIAPIPE ─────────────────────────────────────────────────────
let visionWS    = null
let wsReady     = false
let mpFace      = null
let detectTimer = null
let offCtx      = null
let latestFlags = { extra_person: false, device: false, face_turned: false }

const violCounts = { extra_person: 0, device: 0, face_turned: 0 }
const flagSince  = { extra_person: null, device: null, face_turned: null }
const flagCool   = { extra_person: false, device: false, face_turned: false }
let totalViol    = 0
const MAX_VIOL   = 8
const VIOL_MS    = 7000

async function startWebcam() {
    showCamState("loading")
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const video  = document.getElementById("webcam")
        video.srcObject = stream
        await new Promise(r => { if (video.readyState >= 1) return r(); video.onloadedmetadata = r; setTimeout(r, 3000) })
        await video.play().catch(() => {})
        showCamState("live")
        document.getElementById("posture-badge").textContent = "Loading AI..."
        initMediaPipe(video).then(() => {
            document.getElementById("posture-badge").textContent = "Detecting..."
        }).catch(() => {
            document.getElementById("posture-badge").textContent = "AI unavailable"
        })
        connectVisionWS()
    } catch {
        showCamState("error")
    }
}

function showCamState(s) {
    document.getElementById("cam-loading").style.display = s === "loading" ? "flex" : "none"
    document.getElementById("cam-error").style.display   = s === "error"   ? "flex" : "none"
    document.getElementById("webcam").style.display      = s === "live"    ? "block" : "none"
    document.getElementById("wc-overlay").style.display  = s === "live"    ? "flex" : "none"
    document.getElementById("live-badge").style.opacity  = s === "live"    ? "1" : "0.3"
}

function retryCamera() { showCamState("loading"); startWebcam() }

async function initMediaPipe(video) {
    mpFace = new FaceDetection({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/${f}` })
    mpFace.setOptions({ model: "short", minDetectionConfidence: 0.5 })
    mpFace.onResults(onFaceResults)
    await mpFace.send({ image: video })
    const c = document.createElement("canvas"); c.width = 160; c.height = 120
    offCtx = c.getContext("2d")
    detectTimer = setInterval(() => runDetection(video), 1000)
}

async function runDetection(video) {
    if (video.readyState < 2) return
    await mpFace.send({ image: video })
    offCtx.drawImage(video, 0, 0, 160, 120)
    const px = offCtx.getImageData(0, 0, 160, 120).data
    const W = 160, H = 120; let edges = 0
    for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
        const i = (y*W+x)*4
        const gx = Math.abs((px[i-4]+px[i-3]+px[i-2])/3-(px[i+4]+px[i+5]+px[i+6])/3)
        const gy = Math.abs((px[i-W*4]+px[i-W*4+1]+px[i-W*4+2])/3-(px[i+W*4]+px[i+W*4+1]+px[i+W*4+2])/3)
        if (gx+gy > 60) edges++
    }
    latestFlags.device = (edges/((W-2)*(H-2))) > 0.18
    latestFlags.voice_confidence = _calcToneConfidence()
    processViolationFlags(latestFlags)
    if (wsReady && visionWS.readyState === WebSocket.OPEN)
        visionWS.send(JSON.stringify(latestFlags))
}

function onFaceResults(r) {
    const faces = r.detections || []
    latestFlags.extra_person = faces.length > 1
    if (!faces.length) { latestFlags.face_turned = true; return }
    if (faces.length === 1) {
        const kp = faces[0].landmarks
        if (kp && kp.length >= 6) {
            const nose = kp[2].x, rEar = kp[4].x, lEar = kp[5].x
            const fw = Math.abs(lEar-rEar)
            latestFlags.face_turned = fw > 0.01 && (Math.abs(nose-(rEar+lEar)/2)/fw) > 0.30
        } else latestFlags.face_turned = false
    } else latestFlags.face_turned = false
}

function processViolationFlags(flags) {
    const now = Date.now()
    ;["extra_person","device","face_turned"].forEach(k => {
        if (flags[k]) {
            if (flagSince[k] === null) flagSince[k] = now
            const el = now - flagSince[k]
            if (el >= 3000 && el < VIOL_MS && !flagCool[k]) {
                const rem = Math.ceil((VIOL_MS-el)/1000)
                const lbl = { extra_person:`👥 Extra person — violation in ${rem}s`, device:`📱 Device detected — violation in ${rem}s`, face_turned:`👀 Look at camera — violation in ${rem}s` }
                showToast(lbl[k], "warn")
            }
            if (el >= VIOL_MS && !flagCool[k]) { flagCool[k] = true; registerViolation(k) }
        } else { flagSince[k] = null; flagCool[k] = false }
    })
}

function registerViolation(k) {
    violCounts[k]++; totalViol++
    const el = document.getElementById(`viol-${k}`)
    if (el) el.textContent = violCounts[k]
    const tb = document.getElementById("viol-total")
    if (tb) { tb.textContent = totalViol; tb.className = "viol-total-badge has-violations" }
    const row = document.getElementById(`viol-row-${k}`)
    if (row) { row.classList.add("viol-flash"); setTimeout(() => row.classList.remove("viol-flash"), 1200) }
    const lbl = { extra_person:"Extra person — violation logged!", device:"Device detected — violation logged!", face_turned:"Face turned away — violation logged!" }
    showToast(`🚨 ${lbl[k]}`, "danger")
    const cur = parseFloat(localStorage.getItem("violation_penalty") || "0")
    localStorage.setItem("violation_penalty", (cur+1).toFixed(1))
    if (totalViol >= MAX_VIOL) { showToast("🚫 Too many violations — ending interview!", "danger"); setTimeout(completeInterview, 2500) }
}

// ── WEBSOCKET ──────────────────────────────────────────────────────────────
function connectVisionWS() {
    const token = getToken()
    visionWS = new WebSocket(`${WS_URL}?token=${token}`)
    setWsDot("connecting")
    visionWS.onopen    = () => { wsReady = true; setWsDot("connected") }
    visionWS.onmessage = e  => { try { renderMetrics(JSON.parse(e.data)) } catch {} }
    visionWS.onclose   = () => { wsReady = false; setWsDot("disconnected"); setTimeout(connectVisionWS, 3000) }
    visionWS.onerror   = () => visionWS.close()
}

function setWsDot(s) {
    const d = document.getElementById("wc-ws-dot")
    d.className = "wc-ws-dot " + s
    d.title = { connecting:"Connecting to AI...", connected:"AI connected", disconnected:"Reconnecting..." }[s] || ""
}

function renderMetrics(d) {
    if (d.confidence  != null) setBar("confidence",  d.confidence,  10)
    if (d.engagement  != null) setBar("engagement",  d.engagement,  10)
    if (d.nervousness != null) setBar("nervousness", d.nervousness, 10)
    if (d.posture != null) {
        const b = document.getElementById("posture-badge")
        b.textContent = d.posture
        b.className   = "wc-posture-badge " + (d.posture_ok ? "ok" : "warn")
    }
    if (d.warning) showToast("⚠️ " + d.warning, "warn")
}

function setBar(m, v, max) {
    const b = document.getElementById("bar-"+m); const val = document.getElementById("val-"+m)
    if (b)   b.style.width    = Math.round((v/max)*100) + "%"
    if (val) val.textContent  = v != null ? v.toFixed(1) : "—"
}

function showToast(msg, level = "warn") {
    const t = document.getElementById("wc-warning")
    t.textContent = msg; t.style.display = "block"
    t.style.background = level === "danger" ? "rgba(192,57,43,0.92)" : "rgba(180,83,9,0.88)"
    clearTimeout(t._t)
    t._t = setTimeout(() => { t.style.display = "none" }, level === "danger" ? 5000 : 3000)
}

function setBg(mode, el) {
    document.querySelectorAll(".wc-bg-btn").forEach(b => b.classList.remove("active"))
    el.classList.add("active")
    const v = document.getElementById("webcam")
    v.style.filter = mode === "blur" ? "blur(8px)" : mode === "office" ? "sepia(0.3) brightness(0.88) contrast(1.08)" : "none"
}

// ── VOICE + TONE ANALYSIS ──────────────────────────────────────────────────
let recognition    = null
let isListening    = false
let _committed     = ""
let _interim       = ""
let _audioCtx      = null
let _analyser      = null
let _micSrc        = null
let _toneTimer     = null
let _toneSamples   = []
let _silenceStart  = null
let _pauseCount    = 0
let _lastSound     = null
const FILLERS = /\b(uh|um|like|you know|basically|literally|actually|so|right|okay|hmm)\b/gi

async function startToneAnalysis() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        _analyser = _audioCtx.createAnalyser(); _analyser.fftSize = 2048
        _micSrc   = _audioCtx.createMediaStreamSource(stream); _micSrc.connect(_analyser)
        const fBuf = new Uint8Array(_analyser.frequencyBinCount)
        const tBuf = new Float32Array(_analyser.fftSize)
        _toneTimer = setInterval(() => {
            _analyser.getByteFrequencyData(fBuf); _analyser.getFloatTimeDomainData(tBuf)
            let sum = 0; for (let i = 0; i < tBuf.length; i++) sum += tBuf[i]*tBuf[i]
            const rms = Math.sqrt(sum/tBuf.length)
            const binHz = _audioCtx.sampleRate/_analyser.fftSize
            const lo = Math.floor(85/binHz), hi = Math.floor(255/binHz)
            let maxA = 0, dBin = lo
            for (let i = lo; i <= hi; i++) if (fBuf[i] > maxA) { maxA = fBuf[i]; dBin = i }
            const dFreq = dBin * binHz
            if (rms > 0.01) {
                if (_silenceStart !== null) { if (Date.now()-_silenceStart > 1500) _pauseCount++; _silenceStart = null }
                _lastSound = Date.now(); _toneSamples.push({ rms, dominantFreq: dFreq })
            } else { if (_silenceStart === null && _lastSound !== null) _silenceStart = Date.now() }
            if (isListening) { const s = _calcToneConfidence(); if (s !== null) { setBar("confidence", s, 10); latestFlags.voice_confidence = s } }
        }, 200)
    } catch(e) { console.warn("Tone analysis unavailable:", e) }
}

function _calcToneConfidence() {
    if (_toneSamples.length < 5) return null
    const r = _toneSamples.slice(-30)
    const avgRms = r.reduce((s,x) => s+x.rms, 0)/r.length
    let score = 7.0
    if (avgRms < 0.03) score -= 2.5; else if (avgRms < 0.06) score -= 1.0; else if (avgRms > 0.5) score -= 1.5
    const freqs = r.map(x => x.dominantFreq)
    const avg   = freqs.reduce((s,f) => s+f, 0)/freqs.length
    const std   = Math.sqrt(freqs.reduce((s,f) => s+Math.pow(f-avg,2), 0)/freqs.length)
    if (std > 40) score -= 1.5; else if (std > 20) score -= 0.5
    score -= _pauseCount * 0.4
    const fm = (_committed.match(FILLERS)||[]).length
    const wc = _committed.trim().split(/\s+/).filter(Boolean).length
    if (wc > 3) score -= (fm/wc)*10
    return Math.round(Math.min(Math.max(score,1),10)*10)/10
}

function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
        const btn = document.getElementById("mic-btn-text")
        if (btn) btn.textContent = "Not supported"
        const mb = document.getElementById("mic-btn"); if (mb) mb.disabled = true
        return
    }
    recognition = new SR(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US"
    recognition.onresult = e => {
        let nf = ""; _interim = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript
            e.results[i].isFinal ? (nf += t+" ") : (_interim += t)
        }
        if (nf) _committed += nf
        _renderTranscript()
    }
    recognition.onstart = () => { isListening = true; setVoiceState(true) }
    recognition.onend   = () => { isListening = false; _interim = ""; _renderTranscript(); setVoiceState(false) }
    recognition.onerror = e => { if (e.error === "no-speech") return; isListening = false; _interim = ""; setVoiceState(false) }
}

function _renderTranscript() {
    const box = document.getElementById("answer-input")
    if (box) { box.value = _committed + _interim; box.scrollTop = box.scrollHeight }
}

function setVoiceState(on) {
    const dot  = document.getElementById("mic-dot");   if (dot)  dot.className = on ? "mic-dot active" : "mic-dot"
    const lbl  = document.getElementById("mic-label"); if (lbl)  lbl.textContent = on ? "Listening..." : "Mic off"
    const btxt = document.getElementById("mic-btn-text"); if (btxt) btxt.textContent = on ? "Stop Speaking" : "Start Speaking"
    const btn  = document.getElementById("mic-btn");   if (btn)  btn.classList.toggle("listening", on)
    const stat = document.getElementById("voice-status-badge")
    if (stat) { stat.textContent = on ? "Live" : "Off"; stat.className = "wc-voice-status" + (on ? " live" : "") }
    const wv = document.getElementById("wc-waveform"); if (wv) wv.classList.toggle("active", on)
    const ai = document.getElementById("answer-input"); if (ai) ai.classList.toggle("listening", on)
}

function toggleMic() {
    if (!recognition) return
    if (isListening) { recognition.stop() }
    else { _toneSamples = []; _pauseCount = 0; _silenceStart = null; _lastSound = null; recognition.start() }
}

// ── RAPID FIRE TIMER ───────────────────────────────────────────────────────
let _rfTimer    = null
let _rfSeconds  = 30
let _rfPaused   = false
let _rfTotal    = 30

function startRapidFireTimer() {
    if (!meta.timer) return
    _rfTotal   = meta.timerSec
    _rfSeconds = meta.timerSec
    _rfPaused  = false
    _updateTimerDisplay()
    _showTimerBar()
    _rfTimer = setInterval(() => {
        if (_rfPaused) return
        _rfSeconds--
        _updateTimerDisplay()
        if (_rfSeconds <= 0) { clearInterval(_rfTimer); autoSubmitAnswer() }
    }, 1000)
}

function resetRapidFireTimer() {
    clearInterval(_rfTimer)
    if (meta.timer) startRapidFireTimer()
}

function toggleTimerPause() {
    _rfPaused = !_rfPaused
    const btn = document.getElementById("at-pause-btn")
    if (btn) btn.textContent = _rfPaused ? "Resume" : "Pause"
}

function _showTimerBar() {
    const bar = document.getElementById("answer-timer-bar")
    if (bar) bar.classList.add("active")
    const sub = document.getElementById("at-sublabel")
    if (sub) sub.textContent = `${_rfTotal}s per question`
    // also update rapid_fire page rf-timer if present
    const rf = document.getElementById("rf-timer")
    if (rf) rf.textContent = _rfSeconds + "s"
}

function _updateTimerDisplay() {
    const pct  = _rfSeconds / _rfTotal
    const circ = 125.66

    // at-time (used by all rounds)
    const atTime = document.getElementById("at-time")
    if (atTime) {
        atTime.textContent = _rfSeconds + "s"
        atTime.className   = "at-time" + (_rfSeconds <= 10 ? " urgent" : "")
    }

    // at-ring SVG
    const atRing = document.getElementById("at-ring")
    if (atRing) {
        atRing.style.strokeDashoffset = circ * (1 - pct)
        atRing.style.stroke = _rfSeconds <= 10 ? "var(--danger)" : "var(--primary)"
    }

    // at-progress-fill bar
    const atProg = document.getElementById("at-progress-fill")
    if (atProg) {
        atProg.style.width      = (pct * 100) + "%"
        atProg.style.background = _rfSeconds <= 10 ? "var(--danger)" : "var(--primary)"
    }

    // rapid_fire page elements
    const rf = document.getElementById("rf-timer")
    if (rf) {
        rf.textContent = _rfSeconds + "s"
        rf.className   = "rf-timer" + (_rfSeconds <= 10 ? " urgent" : "")
    }
    const rfRing = document.getElementById("rf-ring")
    if (rfRing) {
        rfRing.style.strokeDashoffset = circ * (1 - pct)
        rfRing.style.stroke = _rfSeconds <= 10 ? "var(--danger)" : "var(--primary)"
    }
}

async function autoSubmitAnswer() {
    const answer = (document.getElementById("answer-input")?.value || "").trim()
    if (!answer) {
        // skip — submit empty placeholder
        await _doSubmit("(No answer — time ran out)")
    } else {
        await _doSubmit(answer)
    }
}

// ── INTERVIEW FLOW ─────────────────────────────────────────────────────────
async function startInterview() {
    const sid     = localStorage.getItem("session_id")
    const role    = localStorage.getItem("role")
    const company = localStorage.getItem("company")
    const el_role = document.getElementById("role-display")
    const el_comp = document.getElementById("company-display")
    if (el_role) el_role.textContent = role || ""
    if (el_comp) el_comp.textContent = company || ""
    if (!sid) { document.getElementById("question-text").textContent = "No session found. Go back to dashboard."; return }

    try {
        const res  = await fetch(`${API}/interview/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({ session_id: parseInt(sid) })
        })
        const data = await res.json()
        if (res.ok) {
            currentQuestion = data.question
            document.getElementById("question-text").textContent = data.question
            updateProgress()
            if (meta.timer) startRapidFireTimer()
        } else {
            document.getElementById("question-text").textContent = `Error ${res.status}: ${data.detail || "Failed to load question."}`
        }
    } catch(e) {
        document.getElementById("question-text").textContent = `Network error: ${e.message}`
    }
}

async function submitAnswer() {
    const answer = (document.getElementById("answer-input")?.value || "").trim()
    if (!answer) { alert("Please speak or type your answer before submitting!"); return }
    await _doSubmit(answer)
}

async function _doSubmit(answer) {
    if (isListening) recognition.stop()
    clearInterval(_rfTimer)
    const sid = localStorage.getItem("session_id")
    const btn = document.getElementById("submit-btn")
    if (btn) { btn.textContent = "Evaluating..."; btn.disabled = true }
    const mb = document.getElementById("mic-btn"); if (mb) mb.disabled = true

    try {
        const res  = await fetch(`${API}/interview/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({ session_id: parseInt(sid), question: currentQuestion, answer })
        })
        const data = await res.json()
        if (res.ok) {
            showFeedback(data)
            if (data.interview_complete || questionNumber >= totalQuestions) { await completeInterview(); return }
            questionNumber++
            updateProgress()
            currentQuestion = data.next_question
            document.getElementById("question-text").textContent = data.next_question
            const ai = document.getElementById("answer-input"); if (ai) ai.value = ""
            _committed = ""; _interim = ""
            if (meta.timer) startRapidFireTimer()
        } else {
            alert(`Error ${res.status}: ${data.detail || "Failed to submit answer."}`)
        }
    } catch(e) { alert(`Network error: ${e.message}`) }

    if (btn) { btn.textContent = "Submit Answer →"; btn.disabled = false }
    const mb2 = document.getElementById("mic-btn"); if (mb2) mb2.disabled = false
}

function showFeedback(data) {
    const fb = document.getElementById("live-feedback"); if (fb) fb.style.display = "block"
    const sp = document.getElementById("sbr-pill");       if (sp) sp.textContent = `SBR: ${data.sbr_score}/10`
    const cp = document.getElementById("confidence-pill"); if (cp) cp.textContent = `Confidence: ${data.confidence_score}/10`
    const cl = document.getElementById("clarity-pill");   if (cl) cl.textContent = `Clarity: ${data.clarity_score}/10`
    const ft = document.getElementById("feedback-text");  if (ft) ft.textContent = data.feedback
    const ms = document.getElementById("missing-sbr");    if (ms) ms.textContent = data.missing_sbr?.length ? `⚠️ Missing: ${data.missing_sbr.join(", ")}` : "✅ Great SBR structure!"
}

function updateProgress() {
    const pf = document.getElementById("progress-fill")
    const qc = document.getElementById("question-counter")
    if (pf) pf.style.width = `${(questionNumber/totalQuestions)*100}%`
    if (qc) qc.textContent = `Question ${questionNumber} / ${totalQuestions}`
}

async function completeInterview() {
    clearInterval(_rfTimer); clearInterval(detectTimer)
    if (visionWS) visionWS.close()
    if (isListening) recognition.stop()
    const sid = localStorage.getItem("session_id")
    localStorage.setItem("violation_counts", JSON.stringify(violCounts))
    localStorage.setItem("total_violations", totalViol)
    try {
        await fetch(`${API}/interview/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
            body: JSON.stringify({ session_id: parseInt(sid) })
        })
    } catch {}
    window.location.href = "/report.html"
}

window.addEventListener("beforeunload", () => { clearInterval(detectTimer); clearInterval(_rfTimer); if (visionWS) visionWS.close() })

// ── INIT ───────────────────────────────────────────────────────────────────
window.onload = () => {
    // Set round label in navbar if element exists
    const rl = document.getElementById("round-label"); if (rl) rl.textContent = `${meta.icon} ${meta.label}`
    startWebcam(); setupVoice(); startToneAnalysis(); startInterview()
}
