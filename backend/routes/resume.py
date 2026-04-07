import os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.models.database import get_db, InterviewSession, Resume, User
from backend.services.resume_parser import parse_resume
from backend.services.gemini_service import analyze_resume_for_jobs
from backend.routes.auth import get_current_user

router = APIRouter(prefix="/resume", tags=["resume"])

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "uploads")
UPLOADS_DIR = os.path.normpath(UPLOADS_DIR)
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
os.makedirs(UPLOADS_DIR, exist_ok=True)


class SessionSetup(BaseModel):
    role: str
    company: str
    persona: str
    resume_text: str
    skills: str = ""
    round_type: str = "full_mock"


@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not file.filename.lower().endswith((".pdf", ".docx")):
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")

    safe_filename = f"user_{current_user.id}_{Path(file.filename).name}"
    file_path = os.path.join(UPLOADS_DIR, safe_filename)
    if not os.path.abspath(file_path).startswith(os.path.abspath(UPLOADS_DIR)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    with open(file_path, "wb") as f:
        f.write(file_bytes)

    result = parse_resume(file_bytes, file.filename)

    if not result["text"]:
        raise HTTPException(status_code=400, detail="Could not extract text from resume")

    resume = Resume(
        user_id=current_user.id,
        file_path=file_path,
        extracted_text=result["text"],
        skills=result["skills"]
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)

    return {
        "resume_id": resume.id,
        "resume_text": result["text"],
        "skills": result["skills"],
        "entities": result["entities"],
        "sections": result["sections"],
        "message": "Resume parsed successfully"
    }


class AnalyzeRequest(BaseModel):
    resume_text: str


@router.post("/analyze")
def analyze_resume(
    data: AnalyzeRequest,
    current_user: User = Depends(get_current_user)
):
    suggestions = analyze_resume_for_jobs(data.resume_text)
    return suggestions


@router.post("/setup-session", status_code=201)
def setup_session(
    data: SessionSetup,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        session = InterviewSession(
            user_id=current_user.id,
            role=data.role,
            company=data.company,
            persona=data.persona,
            resume_text=data.resume_text,
            skills=data.skills,
            round_type=data.round_type,
            status="setup"
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return {"session_id": session.id, "message": "Session created successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@router.get("/sessions")
def get_user_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sessions = (
        db.query(InterviewSession)
        .filter(InterviewSession.user_id == current_user.id)
        .order_by(InterviewSession.created_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "role": s.role,
            "company": s.company,
            "status": s.status,
            "overall_score": s.overall_score,
            "created_at": s.created_at
        }
        for s in sessions
    ]


@router.get("/session/{session_id}")
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return {
        "id": session.id,
        "role": session.role,
        "company": session.company,
        "persona": session.persona,
        "skills": session.skills,
        "status": session.status,
        "created_at": session.created_at
    }


@router.get("/{resume_id}")
def get_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if resume.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return {
        "id": resume.id,
        "file_path": resume.file_path,
        "extracted_text": resume.extracted_text,
        "skills": resume.skills,
        "created_at": resume.created_at
    }
