from dotenv import load_dotenv
import os

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))

PERSONAS = {
    "stress_tester": "You are a strict and aggressive interviewer who challenges every answer and asks tough follow up questions.",
    "encouraging_mentor": "You are a supportive and encouraging interviewer who guides the candidate and gives hints when needed.",
    "silent_observer": "You are a silent and neutral interviewer who gives minimal reactions and asks straightforward questions."
}

COMPANIES = ["Google", "Amazon", "Microsoft", "TCS", "Infosys", "Wipro", "Cognizant"]

ROLES = ["Software Development Engineer", "Data Analyst", "Product Manager", "DevOps Engineer", "Machine Learning Engineer"]
