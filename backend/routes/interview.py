import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from backend.models.database import get_db, InterviewSession, Question
from backend.services.gemini_service import start_interview, get_next_question, evaluate_answer, generate_roadmap
from backend.services.sbr_scorer import analyze_confidence, analyze_soft_skills, check_sbr_structure
from backend.routes.auth import get_current_user
from backend.models.database import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/interview", tags=["interview"])


class StartRequest(BaseModel):
    session_id: int


class AnswerRequest(BaseModel):
    session_id: int
    question: str
    answer: str

    @field_validator("answer")
    @classmethod
    def answer_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Answer cannot be empty")
        return v.strip()

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Question cannot be empty")
        return v.strip()


def _get_session_or_404(db: Session, session_id: int) -> InterviewSession:
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/start")
def start(data: StartRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = _get_session_or_404(db, data.session_id)

    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        first_question = start_interview(
            session_id=session.id,
            resume_text=session.resume_text,
            role=session.role,
            company=session.company,
            persona=session.persona,
            round_type=session.round_type
        )
    except Exception as e:
        logger.exception("Failed to start interview for session %d: %s", data.session_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to start interview: {str(e)}")

    session.status = "in_progress"
    db.commit()

    return {"question": first_question, "question_number": 1}


@router.post("/answer")
def submit_answer(data: AnswerRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = _get_session_or_404(db, data.session_id)

    try:
        evaluation = evaluate_answer(data.question, data.answer, session.role)
    except Exception as e:
        logger.exception("Evaluation failed for session %d: %s", data.session_id, e)
        evaluation = {
            "technical_score": 5.0,
            "sbr_score": 5.0,
            "feedback": "Evaluation unavailable. Keep going!",
            "ideal_answer": "A strong answer includes specific examples with measurable outcomes.",
            "missing_sbr": ""
        }

    confidence = analyze_confidence(data.answer)
    soft_skills = analyze_soft_skills(data.answer)
    sbr = check_sbr_structure(data.answer)

    question_record = Question(
        session_id=session.id,
        question_text=data.question,
        answer_text=data.answer,
        sbr_score=sbr["sbr_score"],
        confidence_score=confidence,
        feedback=evaluation["feedback"],
        ideal_answer=evaluation["ideal_answer"]
    )
    db.add(question_record)
    db.commit()

    try:
        next_question = get_next_question(session.id, data.answer)
    except Exception as e:
        logger.exception("Failed to get next question for session %d: %s", data.session_id, e)
        next_question = None

    return {
        "feedback": evaluation["feedback"],
        "sbr_score": sbr["sbr_score"],
        "missing_sbr": sbr["missing"],
        "confidence_score": confidence,
        "clarity_score": soft_skills["clarity_score"],
        "filler_words": soft_skills["filler_words_found"],
        "ideal_answer": evaluation["ideal_answer"],
        "next_question": next_question,
        "interview_complete": next_question is None
    }


@router.post("/complete")
def complete_interview(data: StartRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = _get_session_or_404(db, data.session_id)

    questions = db.query(Question).filter(Question.session_id == data.session_id).all()

    if not questions:
        raise HTTPException(status_code=400, detail="No questions found for this session")

    n = len(questions)

    # technical_score = avg of Gemini sbr_score (stored in question.sbr_score)
    avg_technical  = round(sum(q.sbr_score for q in questions) / n, 1)
    # confidence_score = avg of heuristic confidence
    avg_confidence = round(sum(q.confidence_score for q in questions) / n, 1)
    # hr_score = avg of soft skills clarity (re-compute from answers)
    from backend.services.sbr_scorer import analyze_soft_skills, check_sbr_structure
    clarity_scores = [analyze_soft_skills(q.answer_text)["clarity_score"] for q in questions if q.answer_text]
    avg_hr = round(sum(clarity_scores) / len(clarity_scores), 1) if clarity_scores else 5.0
    # communication_score = avg SBR structure score
    sbr_scores = [check_sbr_structure(q.answer_text)["sbr_score"] for q in questions if q.answer_text]
    avg_communication = round(sum(sbr_scores) / len(sbr_scores), 1) if sbr_scores else 5.0
    # overall = average of all 4
    overall = round((avg_technical + avg_confidence + avg_hr + avg_communication) / 4, 1)

    session.technical_score     = avg_technical
    session.confidence_score    = avg_confidence
    session.hr_score            = avg_hr
    session.communication_score = avg_communication
    session.overall_score       = overall
    session.status              = "completed"
    db.commit()

    return {
        "session_id":         session.id,
        "overall_score":      overall,
        "technical_score":    avg_technical,
        "confidence_score":   avg_confidence,
        "hr_score":           avg_hr,
        "communication_score": avg_communication,
        "message": "Interview completed successfully"
    }
