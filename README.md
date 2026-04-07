# Skillyn AI

**AI-Powered Mock Interview and Placement Readiness Platform**

> Because Every Student Deserves a Fair Shot at Their Dream Job

---

## Overview

Skillyn AI is a full-stack web application that simulates real job interviews using Google Gemini AI. It analyzes a candidate's resume, generates personalized interview questions tailored to the target role and company, evaluates answers in real time, and produces a detailed performance report with a career roadmap.

The platform supports six distinct interview round types, live webcam proctoring, voice-based answering with tone analysis, and an optional per-question answer timer — giving candidates a realistic, high-pressure interview experience from their browser.

---

## Features

**Interview Rounds**

| Round | Questions | Description |
|---|---|---|
| Full Mock Interview | 10 | Complete end-to-end interview across all categories |
| Technical Round | 15 | DSA, system design, architecture, and role-specific tech |
| HR Round | 10 | Behavioral STAR questions, culture fit, leadership |
| Case Study Round | 5 | Business and product problem solving |
| Rapid Fire Round | 20 | 30-second timed questions testing breadth under pressure |
| Resume Deep Dive | 8 | AI grills every line of the candidate's resume |
| Salary Negotiation | 6 | Simulated offer negotiation with an AI HR manager |

**Core Capabilities**

- Resume upload and AI-powered job match analysis (roles, companies, skills, experience level)
- Gemini-generated questions personalized to resume, role, company, and interviewer persona
- Three interviewer personas: Stress Tester, Encouraging Mentor, Silent Observer
- Live webcam feed with MediaPipe face detection
- WebSocket-based proctoring: extra person detection, device detection, face-turned detection
- Violation timer system with 7-second threshold before logging
- Speech recognition with real-time transcript display
- AudioContext tone analysis: volume, pitch stability, pause detection, filler word scoring
- Optional answer timer (10 to 600 seconds) with pause/resume and SVG ring countdown
- Per-answer feedback: SBR score, confidence score, clarity score, ideal answer
- Session report with radar chart, career roadmap, and downloadable PDF

---

## Tech Stack

**Backend**

- Python 3.11+
- FastAPI
- SQLAlchemy + SQLite
- Google Gemini 2.5 Flash (via google-genai SDK)
- ReportLab (PDF generation)
- pdfplumber + python-docx (resume parsing)
- python-jose (JWT authentication)
- passlib + bcrypt (password hashing)

**Frontend**

- Vanilla HTML, CSS, JavaScript
- MediaPipe Face Detection
- Web Speech API (speech recognition)
- AudioContext API (tone analysis)
- Chart.js (radar chart)
- WebSocket (real-time proctoring)

---

## Project Structure

```
skillyn-ai/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # Environment config and constants
│   ├── models/
│   │   └── database.py          # SQLAlchemy models: User, Resume, InterviewSession, Question
│   ├── routes/
│   │   ├── auth.py              # Register, login, JWT
│   │   ├── resume.py            # Upload, analyze, setup session
│   │   ├── interview.py         # Start, answer, complete
│   │   └── report.py            # Summary and PDF generation
│   ├── services/
│   │   ├── gemini_service.py    # All Gemini AI calls and question generation
│   │   ├── resume_parser.py     # PDF and DOCX text extraction
│   │   ├── sbr_scorer.py        # Heuristic confidence, clarity, SBR scoring
│   │   └── report_generator.py  # ReportLab PDF report card
│   └── ws_vision.py             # WebSocket proctoring endpoint
├── frontend/
│   ├── index.html               # Sign in and register
│   ├── dashboard.html           # Resume upload, job match, round selection
│   ├── interview.html           # Basic interview page
│   ├── report.html              # Report card
│   ├── css/style.css            # All styles
│   └── js/
│       ├── main.js              # Auth, upload, dashboard logic
│       ├── interview.js         # Basic interview flow
│       └── report.js            # Report display and PDF download
├── frontend/rounds/
│   ├── round.js                 # Shared logic for all specialty rounds
│   ├── technical.html
│   ├── hr.html
│   ├── case_study.html
│   ├── rapid_fire.html
│   ├── resume_deep_dive.html
│   └── salary_negotiation.html
├── realtime_interview/
│   ├── realtime_routes.py       # Frame analysis endpoint
│   ├── realtime.html            # Full real-time interview page
│   └── realtime.js              # Webcam, voice, WebSocket, violation logic
├── .env                         # Environment variables (not committed)
├── .gitignore
├── migrate_db.py                # Database migration script
├── requirements.txt
├── render.yaml                  # Render deployment config
└── Procfile
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | /auth/register | Register a new user |
| POST | /auth/login | Login and receive JWT token |
| GET | /auth/me | Get current user info |
| POST | /resume/upload | Upload and parse a PDF or DOCX resume |
| POST | /resume/analyze | AI job match analysis from resume text |
| POST | /resume/setup-session | Create an interview session |
| GET | /resume/sessions | List all sessions for current user |
| POST | /interview/start | Start interview and get first question |
| POST | /interview/answer | Submit answer and get feedback + next question |
| POST | /interview/complete | Complete interview and calculate final scores |
| GET | /report/summary/{id} | Get full session report as JSON |
| GET | /report/generate/{id} | Download PDF report card |
| WS | /ws/vision | WebSocket for real-time proctoring |

---

## Local Setup

**Prerequisites**

- Python 3.11 or higher
- A Gemini API key from [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)

**Step 1 — Clone the repository**

```bash
git clone https://github.com/YOUR_USERNAME/skillyn-ai.git
cd skillyn-ai
```

**Step 2 — Create a virtual environment**

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac / Linux
source venv/bin/activate
```

**Step 3 — Install dependencies**

```bash
pip install -r requirements.txt
```

**Step 4 — Configure environment variables**

Create a `.env` file in the root directory:

```
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=sqlite:///./skillyn.db
SECRET_KEY=your_random_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

**Step 5 — Run database migration**

```bash
python migrate_db.py
```

**Step 6 — Start the server**

```bash
uvicorn backend.main:app --reload --port 8000
```

**Step 7 — Open the app**

Navigate to [http://localhost:8000](http://localhost:8000) in your browser.

---

## Deployment on Render

1. Push the repository to GitHub
2. Go to [render.com](https://render.com) and create a new Web Service
3. Connect your GitHub repository
4. Set the following:
   - **Root Directory:** `skillyn-ai`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables in the Render dashboard:
   - `GEMINI_API_KEY`
   - `SECRET_KEY`
   - `DATABASE_URL` (use `sqlite:///./skillyn.db` for free tier)
   - `ALGORITHM` = `HS256`
   - `ACCESS_TOKEN_EXPIRE_MINUTES` = `1440`
6. Click Deploy

The app will be available at `https://your-service-name.onrender.com`

---

## Scoring System

Each answer is evaluated across four dimensions:

| Score | Source | Description |
|---|---|---|
| Technical Score | Gemini AI | Accuracy, depth, and relevance of the answer |
| Confidence Score | Heuristic | Assertive language, hedge words, filler words, answer length |
| SBR Score | Heuristic | Presence of Situation, Behavior, and Result in the answer |
| Clarity Score | Heuristic | Logical connectives, sentence structure, communication flow |

The overall session score is the average of all four dimensions across all questions.

---

## Proctoring System

The platform monitors candidates during interviews using three violation types:

| Violation | Threshold | Description |
|---|---|---|
| Extra Person | 7 seconds continuous | More than one face detected in frame |
| Device Detected | 7 seconds continuous | Electronic device detected via edge density analysis |
| Face Turned | 7 seconds continuous | Candidate not looking at the camera |

Violations are logged with a count. At 8 total violations, the interview ends automatically. A warning countdown appears at 3 seconds before a violation is logged, giving the candidate time to correct themselves.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| GEMINI_API_KEY | Google Gemini API key | Required |
| DATABASE_URL | SQLAlchemy database URL | `sqlite:///./skillyn.db` |
| SECRET_KEY | JWT signing secret | Required |
| ALGORITHM | JWT algorithm | `HS256` |
| ACCESS_TOKEN_EXPIRE_MINUTES | Token validity in minutes | `1440` |

---

## License

This project was built for the NextGen Hackathon 2026.

---

*Skillyn AI — Because Every Student Deserves a Fair Shot at Their Dream Job*
