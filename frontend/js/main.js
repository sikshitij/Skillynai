const API = ""

function fadeNavigate(url) {
    document.body.classList.add('page-exit')
    setTimeout(() => { window.location.href = url }, 500)
}

function handleGoogleSignIn() {
    // TODO: integrate Google OAuth
    alert("Google Sign-In coming soon!")
}

let resumeText = ""
let selectedPersona = ""
let sessionId = null

// AUTH FUNCTIONS
async function handleLogin(e) {
    e.preventDefault()
    const email = document.getElementById("login-email").value
    const password = document.getElementById("login-password").value

    const form = new FormData()
    form.append("username", email)
    form.append("password", password)

    const res = await fetch(`${API}/auth/login`, { method: "POST", body: form })
    const data = await res.json()

    if (res.ok) {
        localStorage.setItem("token", data.access_token)
        fadeNavigate("/dashboard.html")
    } else {
        document.getElementById("auth-message").textContent = data.detail || "Login failed"
    }
}

async function handleRegister(e) {
    e.preventDefault()
    const name = document.getElementById("reg-name").value
    const email = document.getElementById("reg-email").value
    const password = document.getElementById("reg-password").value

    const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
    })
    const data = await res.json()

    if (res.ok) {
        document.getElementById("auth-message").textContent = "Registered! Please login."
        showTab("login")
    } else {
        document.getElementById("auth-message").textContent = data.detail || "Registration failed"
    }
}

function logout() {
    localStorage.removeItem("token")
    window.location.href = "/index.html"
}

function getToken() {
    const token = localStorage.getItem("token")
    if (!token) window.location.href = "/index.html"
    return token
}

function unlockRounds() {
    document.querySelectorAll('.round-card').forEach(c => c.classList.remove('locked'))
}

// DASHBOARD FUNCTIONS
async function uploadResume() {
    const file = document.getElementById("resume-file").files[0]
    if (!file) return

    const formData = new FormData()
    formData.append("file", file)

    const statusEl = document.getElementById("upload-status")
    statusEl.textContent = "Parsing resume..."
    statusEl.style.color = ""

    const res = await fetch(`${API}/resume/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${getToken()}` },
        body: formData
    })
    const data = await res.json()

    if (res.ok) {
        resumeText = data.resume_text
        statusEl.textContent = "Resume parsed. Analyzing for job matches..."
        statusEl.style.color = "var(--success)"

        const area = document.getElementById("upload-area")
        if (area) {
            area.classList.add("uploaded")
            area.querySelector("p").textContent = file.name
        }
        const nextBtn = document.getElementById("btn-next-1")
        if (nextBtn) nextBtn.disabled = false

        // Unlock specialty rounds immediately after successful upload
        unlockRounds()

        // Call AI analysis
        try {
            const ar = await fetch(`${API}/resume/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
                body: JSON.stringify({ resume_text: resumeText })
            })
            const suggestions = await ar.json()
            if (ar.ok) {
                statusEl.textContent = "Resume analyzed successfully!"
                window._resumeSuggestions = suggestions
                if (typeof renderSuggestions === 'function') renderSuggestions(suggestions)
            }
        } catch(e) {
            statusEl.textContent = "Resume parsed successfully!"
        }

    } else {
        statusEl.textContent = "Failed: " + (data.detail || "Upload failed. Try again.")
        statusEl.style.color = "var(--danger)"
        const area = document.getElementById("upload-area")
        if (area) {
            area.classList.remove("uploaded")
            area.querySelector("p").textContent = "Click to upload PDF or DOCX"
        }
        const nextBtn = document.getElementById("btn-next-1")
        if (nextBtn) nextBtn.disabled = true
    }
}

function selectPersona(persona, el) {
    selectedPersona = persona
    document.querySelectorAll(".persona-card").forEach(c => c.classList.remove("selected"))
    el.classList.add("selected")
    const startBtn = document.getElementById("start-btn")
    if (startBtn) startBtn.style.display = "block"
    const rtBtn = document.getElementById("realtime-btn")
    if (rtBtn) rtBtn.style.display = "block"
}

async function startRealtimeInterview() {
    const role = document.getElementById("role-select").value
    const company = document.getElementById("company-select").value

    if (!role || !company || !selectedPersona || !resumeText) {
        alert("Please complete all steps before starting!")
        return
    }

    const res = await fetch(`${API}/resume/setup-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` },
        body: JSON.stringify({ role, company, persona: selectedPersona, resume_text: resumeText })
    })
    const data = await res.json()

    if (res.ok) {
        localStorage.setItem("session_id", data.session_id)
        localStorage.setItem("role", role)
        localStorage.setItem("company", company)
        fadeNavigate("/realtime_interview/realtime.html")
    } else {
        alert("Failed to start session. Try again.")
    }
}

async function startInterview() {
    const role = document.getElementById("role-select").value
    const company = document.getElementById("company-select").value

    if (!role || !company || !selectedPersona || !resumeText) {
        alert("Please complete all steps before starting!")
        return
    }

    const res = await fetch(`${API}/resume/setup-session`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getToken()}`
        },
        body: JSON.stringify({ role, company, persona: selectedPersona, resume_text: resumeText })
    })
    const data = await res.json()

    if (res.ok) {
        localStorage.setItem("session_id", data.session_id)
        localStorage.setItem("role", role)
        localStorage.setItem("company", company)
        fadeNavigate("/interview.html")
    } else {
        alert("Failed to start session. Try again.")
    }
}
