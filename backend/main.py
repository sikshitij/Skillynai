from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.routes import auth, resume, interview, report
from backend.models.database import create_tables
from realtime_interview.realtime_routes import router as realtime_router
from backend.ws_vision import router as vision_ws_router

app = FastAPI(title="Skillyn AI", description="AI Powered Mock Interview Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(auth.router)
app.include_router(resume.router)
app.include_router(interview.router)
app.include_router(report.router)
app.include_router(realtime_router)
app.include_router(vision_ws_router)

@app.on_event("startup")
def startup():
    create_tables()

@app.get("/health")
def health():
    return {"status": "Skillyn AI is running!"}

app.mount("/realtime_interview", StaticFiles(directory="realtime_interview", html=True), name="realtime")
app.mount("/rounds", StaticFiles(directory="frontend/rounds", html=True), name="rounds")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
