from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from backend.models.database import get_db, InterviewSession, Question
from backend.services.report_generator import generate_report
from backend.services.gemini_service import generate_roadmap
from backend.routes.auth import get_current_user
from backend.models.database import User
from datetime import datetime, timezone

router = APIRouter(prefix="/report", tags=["report"])

@router.get("/generate/{session_id}")
def get_report(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    questions = db.query(Question).filter(Question.session_id == session_id).all()
    
    scores = {
        "technical_score": session.technical_score,
        "hr_score": session.hr_score,
        "confidence_score": session.confidence_score,
        "communication_score": session.communication_score,
        "overall_score": session.overall_score
    }
    
    roadmap = generate_roadmap(session.resume_text, session.role, scores)
    
    session_data = {
        "role": session.role,
        "company": session.company,
        "persona": session.persona,
        "date": datetime.now(timezone.utc).strftime("%d %B %Y"),
        **scores
    }
    
    questions_data = [
        {
            "question_text": q.question_text,
            "answer_text": q.answer_text,
            "feedback": q.feedback,
            "sbr_score": q.sbr_score
        }
        for q in questions
    ]
    
    pdf_bytes = generate_report(session_data, questions_data, roadmap)
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=skillyn_report_{session_id}.pdf"}
    )

@router.get("/summary/{session_id}")
def get_summary(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    questions = db.query(Question).filter(Question.session_id == session_id).all()
    roadmap = generate_roadmap(session.resume_text, session.role, {
        "overall_score": session.overall_score
    })
    
    return {
        "session": {
            "role": session.role,
            "company": session.company,
            "overall_score": session.overall_score,
            "technical_score": session.technical_score,
            "confidence_score": session.confidence_score
        },
        "questions": [
            {
                "question": q.question_text,
                "answer": q.answer_text,
                "feedback": q.feedback,
                "sbr_score": q.sbr_score,
                "ideal_answer": q.ideal_answer
            }
            for q in questions
        ],
        "roadmap": roadmap
    }
