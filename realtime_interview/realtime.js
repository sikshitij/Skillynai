const API = ""

let currentQuestion = ""
let questionNumber   = 1
const TOTAL          = 10

let recognition    = null
let isListening    = false
let transcript     = ""
let webcamStream   = null
let frameInterval  = null
let lastEmotion    = {}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getToken() {
    const t = localStorage.getItem("token")
    if (!t) window.location.href = "/index.html"
    return t
}

async function apiFetch(url, body) {
    const res  = await fetch(API + url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + getToken() },
        body: JSON.stringify(body)
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { detail: text } }
    return { ok: res.ok, status: res.status, data }
}

// ── WEBCAM ────────────────────────────────────────────────────────────────────

async function startWebcam() {
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        document.getElementById("webcam").srcObject = webcamStream
        startFrameLoop()
    } catch {
        document.getElementById("cam-error").style.display = "block"
    }
}

function startFrameLoop() {
    const video  = document.getElementById("webcam")
    const canvas = document.createElement("canvas")
    canvas.width = 320; canvas.height = 240

    frameInterval = setInterval(async () => {
        if (video.readyState < 2) return
        canvas.getContext("2d").drawImage(video, 0, 0, 320, 240)
        const b64 = canvas.toDataURL("image/jpeg", 0.6).split(",")[1]

        const { ok, data } = await apiFetch("/realtime/analyze-frame", { frame: b64 })
        if (ok) {
            lastEmotion = data
            setBar("em-conf", data.confidence)
            setBar("em-nerv", data.nervousness)
            setBar("em-eng",  data.engagement)
            document.getElementById("posture-label").textContent = data.posture || "—"
        }
    }, 3000)
}

function setBar(id, val) {
    document.getElementById(id).style.width        = Math.round((val || 0) * 10) + "%"
    document.getElementById(id + "-val").textContent = val != null ? val.toFixed(1) : "—"
}

// ── VOICE ─────────────────────────────────────────────────────────────────────

function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
        document.getElementById("voice-status").textContent = "⚠️ Speech recognition not supported — use Chrome."
        document.getElementById("mic-btn").disabled = true
        return
    }

    recognition = new SR()
    recognition.continuous     = true
    recognition.interimResults = true
    recognition.lang           = "en-US"

    recognition.onresult = e => {
        let interim = "", final = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript
            e.results[i].isFinal ? (final += t + " ") : (interim += t)
        }
        transcript += final
        document.getElementById("transcript-box").textContent = (transcript + interim) || "Listening..."
        if (transcript.trim()) document.getElementById("submit-btn").disabled = false
    }

    recognition.onstart = () => {
        isListening = true
        setMicState("listening", "🎙️ Listening... speak your answer", "⏹ Stop Speaking")
    }

    recognition.onend = () => {
        isListening = false
        setMicState("", transcript.trim() ? "✅ Answer captured — submit when ready." : "Click 'Start Speaking' to answer", "🎙️ Start Speaking")
    }

    recognition.onerror = e => {
        isListening = false
        setMicState("", "Mic error: " + e.error + ". Try again.", "🎙️ Start Speaking")
    }
}

function setMicState(dotClass, statusText, btnText) {
    document.getElementById("mic-dot").className  = "mic-dot " + dotClass
    document.getElementById("voice-status").textContent = statusText
    document.getElementById("mic-btn").textContent = btnText
}

function toggleMic() {
    if (!recognition) return
    if (isListening) {
        recognition.stop()
    } else {
        transcript = ""
        document.getElementById("transcript-box").textContent = "Listening..."
        document.getElementById("submit-btn").disabled = true
        recognition.start()
    }
}

// ── INTERVIEW FLOW ────────────────────────────────────────────────────────────

async function loadFirstQuestion() {
    const sid     = localStorage.getItem("session_id")
    const role    = localStorage.getItem("role")
    const company = localStorage.getItem("company")

    if (!sid) {
        document.getElementById("question-text").textContent = "No session found. Go back to dashboard."
        return
    }

    document.getElementById("role-display").textContent    = role
    document.getElementById("company-display").textContent = company

    const { ok, status, data } = await apiFetch("/interview/start", { session_id: parseInt(sid) })
    if (ok) {
        currentQuestion = data.question
        document.getElementById("question-text").textContent = data.question
    } else {
        document.getElementById("question-text").textContent = "Error " + status + ": " + data.detail
    }
}

async function submitAnswer() {
    if (isListening) recognition.stop()

    const answer = transcript.trim()
    if (!answer) { alert("No answer captured. Please speak first."); return }

    const sid = localStorage.getItem("session_id")
    setSubmitting(true)

    const { ok, status, data } = await apiFetch("/interview/answer", {
        session_id:   parseInt(sid),
        question:     currentQuestion,
        answer,
        emotion_data: lastEmotion
    })

    if (ok) {
        showFeedback(data)

        if (data.interview_complete || questionNumber >= TOTAL) {
            await endInterview(); return
        }

        questionNumber++
        document.getElementById("progress-fill").style.width = (questionNumber / TOTAL * 100) + "%"
        document.getElementById("question-counter").textContent = "Question " + questionNumber + "/" + TOTAL
        currentQuestion = data.next_question
        document.getElementById("question-text").textContent = data.next_question
        transcript = ""
        document.getElementById("transcript-box").textContent = "Your spoken answer will appear here..."
        document.getElementById("submit-btn").disabled = true
    } else {
        alert("Error " + status + ": " + data.detail)
    }

    setSubmitting(false)
}

function setSubmitting(on) {
    document.getElementById("submit-btn").textContent = on ? "Evaluating..." : "Submit Answer →"
    document.getElementById("submit-btn").disabled    = on
    document.getElementById("mic-btn").disabled       = on
    if (on) setMicState("processing", "Evaluating your answer...", "🎙️ Start Speaking")
}

function showFeedback(data) {
    document.getElementById("live-feedback").style.display = "block"
    document.getElementById("sbr-pill").textContent        = "SBR: "        + data.sbr_score        + "/10"
    document.getElementById("confidence-pill").textContent = "Confidence: " + data.confidence_score + "/10"
    document.getElementById("clarity-pill").textContent    = "Clarity: "    + data.clarity_score    + "/10"
    document.getElementById("emotion-pill").textContent    = lastEmotion.confidence != null
        ? "Emotion Conf: " + lastEmotion.confidence.toFixed(1) + "/10" : "Emotion: —"
    document.getElementById("feedback-text").textContent   = data.feedback
    document.getElementById("missing-sbr").textContent     = data.missing_sbr?.length
        ? "⚠️ Missing: " + data.missing_sbr.join(", ") : "✅ Great SBR structure!"
}

async function endInterview() {
    if (frameInterval) clearInterval(frameInterval)
    if (webcamStream)  webcamStream.getTracks().forEach(t => t.stop())
    if (isListening)   recognition.stop()

    const sid = localStorage.getItem("session_id")
    await apiFetch("/interview/complete", { session_id: parseInt(sid) }).catch(() => {})
    window.location.href = "/report.html"
}

// ── INIT ──────────────────────────────────────────────────────────────────────

window.onload = async () => {
    await startWebcam()
    setupVoice()
    await loadFirstQuestion()
}
