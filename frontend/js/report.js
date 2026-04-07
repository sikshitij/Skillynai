const API = ""

function getToken() {
    const token = localStorage.getItem("token")
    if (!token) window.location.href = "/index.html"
    return token
}

function getRating(score) {
    if (score >= 8) return "Excellent"
    if (score >= 6) return "Good"
    if (score >= 4) return "Average"
    return "Needs Improvement"
}

function safe(val) {
    return (val != null && !isNaN(val)) ? parseFloat(val).toFixed(1) : "0.0"
}

async function loadReport() {
    const sessionId = localStorage.getItem("session_id")
    if (!sessionId) {
        document.querySelector(".report-container h2").textContent = "No session found. Go back to dashboard."
        return
    }

    const res = await fetch(`${API}/report/summary/${sessionId}`, {
        headers: { "Authorization": `Bearer ${getToken()}` }
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        document.querySelector(".report-container h2").textContent = "Could not load report: " + (err.detail || res.status)
        return
    }

    const data = await res.json()
    const session = data.session

    // Round type label
    const roundLabels = {
        full_mock: "Full Mock Interview",
        technical: "Technical Round",
        hr: "HR Round",
        case_study: "Case Study Round",
        rapid_fire: "Rapid Fire Round",
        resume_deep_dive: "Resume Deep Dive",
        salary_negotiation: "Salary Negotiation"
    }
    const roundType = localStorage.getItem("round_type") || "full_mock"
    document.querySelector(".report-container h2").textContent =
        `${roundLabels[roundType] || "Interview"} — Report Card`

    // Overall score
    const overall = parseFloat(session.overall_score) || 0
    document.getElementById("overall-score").textContent = safe(overall)
    document.getElementById("overall-rating").textContent = getRating(overall)

    // Score cards — correct mappings
    document.getElementById("technical-score").textContent     = `${safe(session.technical_score)}/10`
    document.getElementById("confidence-score").textContent    = `${safe(session.confidence_score)}/10`
    document.getElementById("sbr-score").textContent           = `${safe(session.communication_score)}/10`
    document.getElementById("communication-score").textContent = `${safe(session.hr_score)}/10`

    // Radar Chart
    const ctx = document.getElementById("scoreChart").getContext("2d")
    new Chart(ctx, {
        type: "radar",
        data: {
            labels: ["Technical", "Confidence", "SBR", "Communication", "Overall"],
            datasets: [{
                label: "Your Scores",
                data: [
                    parseFloat(session.technical_score)     || 0,
                    parseFloat(session.confidence_score)    || 0,
                    parseFloat(session.communication_score) || 0,
                    parseFloat(session.hr_score)            || 0,
                    parseFloat(session.overall_score)       || 0
                ],
                backgroundColor: "rgba(60,77,39,0.08)",
                borderColor: "#3C4D27",
                pointBackgroundColor: "#3C4D27",
                pointBorderColor: "#FFFFFF",
                pointBorderWidth: 2
            }]
        },
        options: {
            scales: {
                r: {
                    min: 0, max: 10,
                    ticks: { color: "#6B7560", backdropColor: "transparent", stepSize: 2 },
                    grid: { color: "rgba(0,0,0,0.06)" },
                    pointLabels: { color: "#1E2A14", font: { size: 12 } }
                }
            },
            plugins: { legend: { labels: { color: "#1E2A14", font: { size: 12 } } } }
        }
    })

    // Roadmap
    const roadmapEl = document.getElementById("roadmap-content")
    roadmapEl.textContent = data.roadmap || "Roadmap not available."

    // Violation summary if present
    const totalViol = parseInt(localStorage.getItem("total_violations") || "0")
    if (totalViol > 0) {
        const violCounts = JSON.parse(localStorage.getItem("violation_counts") || "{}")
        const violDiv = document.createElement("div")
        violDiv.style.cssText = "background:rgba(192,57,43,0.07);border:1px solid rgba(192,57,43,0.2);border-radius:12px;padding:1rem 1.4rem;margin-bottom:1.5rem"
        violDiv.innerHTML = `
            <p style="font-size:0.78rem;font-weight:700;color:#C0392B;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:0.5rem">Proctoring Violations</p>
            <p style="font-size:0.88rem;color:#4A5640">Total: <strong>${totalViol}</strong> &nbsp;|&nbsp;
            Extra Person: <strong>${violCounts.extra_person || 0}</strong> &nbsp;|&nbsp;
            Device: <strong>${violCounts.device || 0}</strong> &nbsp;|&nbsp;
            Face Turned: <strong>${violCounts.face_turned || 0}</strong></p>
        `
        document.querySelector(".report-container").insertBefore(violDiv, document.querySelector(".roadmap-section"))
    }

    // Questions feedback
    const feedbackContainer = document.getElementById("questions-feedback")
    feedbackContainer.innerHTML = ""
    if (!data.questions || data.questions.length === 0) {
        feedbackContainer.innerHTML = "<p style='color:var(--text-muted);font-size:0.9rem'>No question data available.</p>"
        return
    }

    data.questions.forEach((q, i) => {
        const item = document.createElement("div")
        item.className = "question-feedback-item"
        item.innerHTML = `
            <h4>Q${i + 1}: ${q.question || ""}</h4>
            <p><strong>Your Answer:</strong> ${q.answer || "—"}</p>
            <p><strong>Feedback:</strong> ${q.feedback || "—"}</p>
            <p><strong>SBR Score:</strong> ${safe(q.sbr_score)}/10</p>
            <p><strong>Ideal Answer:</strong> ${q.ideal_answer || "—"}</p>
        `
        feedbackContainer.appendChild(item)
    })
}

async function downloadReport() {
    const sessionId = localStorage.getItem("session_id")
    const res = await fetch(`${API}/report/generate/${sessionId}`, {
        headers: { "Authorization": `Bearer ${getToken()}` }
    })
    if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `skillyn_report_${sessionId}.pdf`
        a.click()
        URL.revokeObjectURL(url)
    } else {
        alert("Could not generate PDF. Please try again.")
    }
}

window.onload = loadReport
