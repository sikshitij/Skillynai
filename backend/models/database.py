from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
from backend.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    resumes = relationship("Resume", back_populates="user")
    sessions = relationship("InterviewSession", back_populates="user")


class Resume(Base):
    __tablename__ = "resumes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_path = Column(String, nullable=False)      # original filename stored as reference
    extracted_text = Column(Text, nullable=False)
    skills = Column(Text, default="")               # comma-separated skills from parser
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="resumes")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String)
    company = Column(String)
    persona = Column(String)
    resume_text = Column(Text)
    skills = Column(Text, default="")          # comma-separated extracted skills
    round_type = Column(String, default="full_mock")  # full_mock | technical | hr | case_study | rapid_fire | resume_deep_dive | salary_negotiation
    status = Column(String, default="setup")   # setup | in_progress | completed
    technical_score = Column(Float, default=0)
    hr_score = Column(Float, default=0)
    confidence_score = Column(Float, default=0)
    communication_score = Column(Float, default=0)
    overall_score = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="sessions")
    questions = relationship("Question", back_populates="session")


class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False)
    question_text = Column(Text)
    answer_text = Column(Text)
    sbr_score = Column(Float, default=0)
    confidence_score = Column(Float, default=0)
    feedback = Column(Text)
    ideal_answer = Column(Text)
    session = relationship("InterviewSession", back_populates="questions")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
