import sys
sys.path.insert(0, '.')

try:
    from dotenv import load_dotenv
    load_dotenv()
    import os
    key = os.getenv("GEMINI_API_KEY")
    print("API KEY:", key[:15] if key else "NOT FOUND")

    from google import genai
    client = genai.Client(api_key=key)
    response = client.models.generate_content(model="models/gemini-2.5-flash", contents="Say hello in one word")
    print("Gemini Response:", response.text)

    from backend.services.gemini_service import start_interview, evaluate_answer
    q = start_interview(999, "Python developer with Flask experience", "Software Development Engineer", "Google", "encouraging_mentor")
    print("First Question:", q)

    ev = evaluate_answer(q, "I built REST APIs using Flask for a college project", "Software Development Engineer")
    print("Evaluation:", ev)

except Exception as e:
    print("ERROR:", str(e))
    import traceback
    traceback.print_exc()
