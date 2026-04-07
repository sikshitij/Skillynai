import logging
from google import genai
from google.genai import types
from backend.config import GEMINI_API_KEY, PERSONAS

logger = logging.getLogger(__name__)

client = genai.Client(api_key=GEMINI_API_KEY)

active_sessions = {}

MAX_RESUME_LENGTH = 3000
MAX_ANSWER_LENGTH = 2000
MAX_OUTPUT_TOKENS = 512
MAX_OUTPUT_TOKENS_QUESTIONS = 2048
MODEL = "models/gemini-2.5-flash"


def _generate(prompt: str) -> str:
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt[:8000],
        config=types.GenerateContentConfig(max_output_tokens=MAX_OUTPUT_TOKENS)
    )
    return response.text.strip()


COMPANY_CONTEXT = {
    "Google":    "known for large-scale distributed systems, data-driven decisions, and OKR culture. Heavily uses Python, Go, C++, Kubernetes, BigQuery. Interviews focus on algorithms, system design, and Googleyness.",
    "Amazon":    "driven by 16 Leadership Principles (ownership, customer obsession, bias for action). Uses Java, AWS services, microservices, and high-scale systems. Interviews heavily use STAR behavioral questions tied to LPs.",
    "Microsoft": "focused on enterprise software, cloud (Azure), and collaboration tools. Uses C#, .NET, TypeScript, Azure DevOps. Interviews test problem solving, growth mindset, and collaboration.",
    "TCS":       "large IT services firm focused on client delivery, agile execution, and multi-domain projects. Uses Java, .NET, SAP, and cloud migrations. Interviews test fundamentals, communication, and client-handling skills.",
    "Infosys":   "IT consulting and outsourcing with focus on digital transformation. Uses Java, Python, Salesforce, and cloud platforms. Interviews test core CS fundamentals and project delivery experience.",
    "Wipro":     "IT services with focus on automation, AI, and cloud. Uses Python, Java, RPA tools, and AWS/Azure. Interviews test technical breadth, adaptability, and delivery mindset.",
    "Cognizant": "digital and IT services focused on healthcare, finance, and retail domains. Uses Java, Python, Salesforce, and data engineering. Interviews test domain knowledge, technical skills, and client communication.",
}

QUESTION_PLAN = [
    "Introductory: Ask about their background and specifically why they want to join {company} for the {role} position. Reference something unique about {company}'s culture or mission.",
    "Resume deep-dive: Pick ONE specific project or work experience from the resume. Ask a detailed question about the technical decisions made, challenges faced, or results achieved in that specific project.",
    "Core technical concept: Ask about a fundamental {role} concept or theory that {company} specifically values. Make it directly tied to a skill listed in their resume.",
    "Tech stack hands-on: Ask a practical, hands-on question about a specific tool, framework, or technology from their resume that is actively used at {company}.",
    "Scenario-based problem solving: Present a realistic, specific work scenario that could happen at {company} for a {role}. Ask how they would approach and solve it step by step.",
    "Behavioral - teamwork or conflict: Ask a STAR-format question about a real situation where they had to collaborate under pressure or resolve a disagreement with a teammate.",
    "Technical depth: Ask an advanced, edge-case, or architecture-level question on the most prominent technical skill in their resume. Push beyond surface-level knowledge.",
    "System design or process: Ask them to design or architect something specific and realistic for the {role} at {company}'s scale and domain.",
    "Behavioral - failure or learning: Ask about a specific time a project or decision went wrong, what their role was, and what concrete changes they made afterward.",
    "Closing - career vision: Ask where they see themselves in 3-5 years and how the {role} at {company} specifically fits into that career path.",
]


def _generate_all_questions(resume_text: str, role: str, company: str, persona: str) -> list:
    """Pre-generate all 10 unique questions in one Gemini call."""
    company_ctx = COMPANY_CONTEXT.get(company, f"a leading tech company hiring for {role}.")
    persona_prompt = PERSONAS.get(persona, PERSONAS["encouraging_mentor"])

    plan_lines = "\n".join(
        f"Q{i+1}: {q.format(role=role, company=company)}"
        for i, q in enumerate(QUESTION_PLAN)
    )

    prompt = f"""{persona_prompt}

You are a senior interviewer at {company} hiring for the role of {role}.
{company} is {company_ctx}

Candidate Resume:
{resume_text[:MAX_RESUME_LENGTH]}

Generate exactly 10 interview questions following this plan:
{plan_lines}

STRICT RULES:
- Every question MUST be completely unique — no two questions can overlap in topic, phrasing, or concept.
- Each question MUST reference specific details from the candidate's resume (mention their actual projects, tools, skills, or experiences by name).
- Each question MUST reflect {company}'s actual tech stack, culture, and interview bar.
- Questions must get progressively harder — Q1 is broad/introductory, Q10 is deep/strategic.
- Output ONLY the 10 questions separated by the delimiter: ---
- Do NOT include question numbers, labels, preamble, or any commentary.

Output format:
<question 1>
---
<question 2>
---
<question 3>
---
<question 4>
---
<question 5>
---
<question 6>
---
<question 7>
---
<question 8>
---
<question 9>
---
<question 10>"""

    fallbacks = [
        f"Tell me about yourself and why you specifically want to join {company} as a {role}.",
        f"Walk me through the most technically complex project on your resume — what decisions did you make and why?",
        f"What is the most critical technical concept a {role} must master, and how have you applied it?",
        f"Pick a tool or framework from your resume — how deeply have you used it and what are its limitations?",
        f"You are on-call at {company} and a critical service goes down. Walk me through your response.",
        f"Tell me about a time you disagreed with a teammate on a technical decision. What happened?",
        f"What is the hardest technical problem you have solved? Walk me through your thought process.",
        f"How would you design a system to handle millions of requests per day at {company}'s scale?",
        f"Tell me about a project that failed or underdelivered. What was your role and what did you change?",
        f"Where do you see yourself in 5 years and how does the {role} position at {company} fit that vision?",
    ]

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=MAX_OUTPUT_TOKENS_QUESTIONS)
        )
        raw = response.text.strip()
        questions = [q.strip() for q in raw.split("---") if q.strip()]
        if len(questions) >= 10:
            return questions[:10]
        while len(questions) < 10:
            questions.append(fallbacks[len(questions)])
        return questions
    except Exception as e:
        logger.exception("Gemini error generating questions: %s", e)
        return fallbacks


ROUND_CONFIGS = {
    "technical":           {"count": 15, "label": "Technical Round"},
    "hr":                  {"count": 10, "label": "HR Round"},
    "case_study":          {"count": 5,  "label": "Case Study Round"},
    "rapid_fire":          {"count": 20, "label": "Rapid Fire Round"},
    "resume_deep_dive":    {"count": 8,  "label": "Resume Deep Dive"},
    "salary_negotiation":  {"count": 6,  "label": "Salary Negotiation"},
    "full_mock":           {"count": 10, "label": "Full Mock Interview"},
}


def _generate_round_questions(resume_text: str, role: str, company: str, persona: str, round_type: str) -> list:
    persona_prompt = PERSONAS.get(persona, PERSONAS["encouraging_mentor"])
    company_ctx = COMPANY_CONTEXT.get(company, f"a leading company hiring for {role}.")
    cfg = ROUND_CONFIGS.get(round_type, ROUND_CONFIGS["full_mock"])
    count = cfg["count"]

    prompts = {
        "technical": f"""{persona_prompt}
You are a senior technical interviewer at {company} conducting a Technical Round for the role of {role}.
{company} is {company_ctx}

Candidate Resume:
{resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} technical interview questions following this strict progression:

Q1-Q3   — Fundamentals: Core CS/role concepts the candidate claims on their resume. Ask them to explain or define something specific they listed.
Q4-Q6   — Resume projects: Pick specific projects or experiences from the resume. Ask about technical decisions, architecture choices, or problems they solved in those exact projects.
Q7-Q9   — {company}-specific tech: Ask about tools, frameworks, or systems that {company} actually uses and that match the candidate's resume skills. Make it hands-on and practical.
Q10-Q12 — Problem solving: Present realistic technical scenarios or challenges that would occur in the {role} position at {company}. Ask how they would approach and solve them.
Q13-Q14 — Advanced depth: Ask architecture-level or edge-case questions on the candidate's strongest listed skill. Push beyond surface knowledge.
Q15     — System design: Ask them to design or architect a specific system relevant to {company}'s scale and the {role} responsibilities.

STRICT RULES:
- Every question MUST be unique — no overlap in topic or concept.
- Every question MUST reference something specific from the resume (project name, tool, skill, or achievement).
- Every question MUST reflect {company}'s actual tech stack and interview bar.
- Questions get progressively harder — Q1 is easy, Q15 is expert-level.
- Output ONLY the {count} questions separated by: ---
- No question numbers, labels, preamble, or commentary.""",

        "hr": f"""{persona_prompt}
You are an HR interviewer at {company} for the role of {role}.
Candidate Resume: {resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} HR/behavioral interview questions.
Rules:
- Use STAR format behavioral questions (teamwork, conflict, failure, leadership, motivation).
- Mix culture fit, values alignment, and situational questions.
- Reference the candidate's background from the resume.
- Output ONLY questions separated by ---
- No numbers, labels, or commentary.""",

        "case_study": f"""{persona_prompt}
You are a case interviewer at {company} for the role of {role}.
{company} is {company_ctx}
Candidate Resume: {resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} case study / problem-solving questions.
Rules:
- Each question presents a realistic business or technical scenario at {company}'s scale.
- Questions should require structured thinking, trade-off analysis, and clear recommendations.
- Vary the domains: product, operations, data, strategy, and technical.
- Output ONLY questions separated by ---
- No numbers, labels, or commentary.""",

        "rapid_fire": f"""{persona_prompt}
You are a rapid-fire interviewer at {company} for the role of {role}.
Candidate Resume: {resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} rapid-fire questions.
Rules:
- Each question must be answerable in 20-30 seconds.
- Mix: quick definitions, yes/no with brief justification, "what would you do" micro-scenarios.
- Cover technical concepts, behavioral instincts, and role knowledge.
- Keep each question under 20 words.
- Output ONLY questions separated by ---
- No numbers, labels, or commentary.""",

        "resume_deep_dive": f"""{persona_prompt}
You are a thorough interviewer at {company} grilling the candidate's resume for the role of {role}.
Candidate Resume: {resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} resume deep-dive questions.
Rules:
- Every question MUST reference a specific project, job, skill, or achievement from the resume.
- Probe for depth: ask about decisions made, challenges faced, metrics achieved, and lessons learned.
- Include at least 2 questions that challenge or verify a claim on the resume.
- Output ONLY questions separated by ---
- No numbers, labels, or commentary.""",

        "salary_negotiation": f"""{persona_prompt}
You are an HR manager at {company} conducting a salary negotiation conversation for the role of {role}.
Candidate Resume: {resume_text[:MAX_RESUME_LENGTH]}

Generate exactly {count} salary negotiation scenario prompts/questions.
Rules:
- Start with an opening offer scenario, then escalate through counter-offers, benefits discussion, competing offers, and final decision.
- Each prompt should be a realistic HR statement or question that requires the candidate to negotiate.
- Include scenarios like: initial offer, pushback on salary, equity vs cash, notice period, competing offer leverage.
- Output ONLY the HR statements/questions separated by ---
- No numbers, labels, or commentary.""",
    }

    prompt = prompts.get(round_type)
    if not prompt:
        return _generate_all_questions(resume_text, role, company, persona)

    fallbacks = [
        f"Tell me about yourself and your interest in this {role} position at {company}.",
        f"Walk me through your most relevant experience for this role.",
        f"What is your greatest strength relevant to this position?",
        f"Describe a challenging situation you faced and how you resolved it.",
        f"Where do you see yourself in 3-5 years?",
        f"Why do you want to work at {company}?",
        f"What is your biggest weakness and how are you working on it?",
        f"Tell me about a time you worked in a team under pressure.",
        f"What motivates you professionally?",
        f"Do you have any questions for us?",
    ]

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=MAX_OUTPUT_TOKENS_QUESTIONS)
        )
        raw = response.text.strip()
        questions = [q.strip() for q in raw.split("---") if q.strip()]
        if len(questions) >= count:
            return questions[:count]
        while len(questions) < count:
            questions.append(fallbacks[len(questions) % len(fallbacks)])
        return questions
    except Exception as e:
        logger.exception("Gemini error generating %s questions: %s", round_type, e)
        return (fallbacks * 3)[:count]


def start_interview(session_id: int, resume_text: str, role: str, company: str, persona: str, round_type: str = "full_mock"):
    if round_type == "full_mock":
        questions = _generate_all_questions(resume_text, role, company, persona)
    else:
        questions = _generate_round_questions(resume_text, role, company, persona, round_type)

    active_sessions[session_id] = {
        "questions": questions,
        "history": [],
        "question_count": 1,
        "total": len(questions),
        "role": role,
        "company": company,
        "resume_text": resume_text[:MAX_RESUME_LENGTH],
        "persona": persona,
    }

    first_question = questions[0]
    active_sessions[session_id]["history"].append({"question": first_question, "answer": None})
    return first_question


def get_next_question(session_id: int, answer: str):
    if session_id not in active_sessions:
        logger.warning("Session %d not in active_sessions (server may have restarted)", session_id)
        return None

    session = active_sessions[session_id]

    if session["question_count"] >= session["total"]:
        return None

    if session["history"] and session["history"][-1]["answer"] is None:
        session["history"][-1]["answer"] = answer[:MAX_ANSWER_LENGTH]

    next_question = session["questions"][session["question_count"]]
    session["history"].append({"question": next_question, "answer": None})
    session["question_count"] += 1

    return next_question


def evaluate_answer(question: str, answer: str, role: str) -> dict:
    prompt = f"""Evaluate this interview answer for a {role} position.
Question: {question}
Answer: {answer[:MAX_ANSWER_LENGTH]}

Provide evaluation in this exact format:
TECHNICAL_SCORE: (number 0-10)
SBR_SCORE: (number 0-10, check if answer has Situation Behavior Result structure)
FEEDBACK: (2-3 lines of specific feedback)
IDEAL_ANSWER: (what a perfect answer would look like in 2-3 lines)
MISSING_SBR: (which of Situation/Behavior/Result is missing, or NONE if all present)"""

    try:
        response_text = _generate(prompt)
        return parse_evaluation(response_text)
    except Exception as e:
        logger.exception("Gemini error on evaluate_answer: %s", e)
        return {
            "technical_score": 5.0,
            "sbr_score": 5.0,
            "feedback": "Could not evaluate answer at this time. Keep practicing!",
            "ideal_answer": "A strong answer would include specific examples with measurable outcomes.",
            "missing_sbr": ""
        }


def analyze_resume_for_jobs(resume_text: str) -> dict:
    prompt = f"""You are a career advisor. Analyze this resume and respond ONLY in the exact format below. No extra text.

Resume:
{resume_text[:MAX_RESUME_LENGTH]}

ROLES: role1, role2, role3, role4, role5
COMPANIES: company1, company2, company3, company4, company5
TOP_SKILLS: skill1, skill2, skill3, skill4, skill5, skill6
EXPERIENCE_LEVEL: Fresher
SUMMARY: one line profile summary

For COMPANIES only pick from: Google, Amazon, Microsoft, TCS, Infosys, Wipro, Cognizant
For EXPERIENCE_LEVEL only use: Fresher, Junior, Mid-Level, or Senior"""

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=512)
        )
        raw = response.text.strip()
        logger.info("Resume analyze raw response: %s", raw)

        result = {
            "roles": [],
            "companies": [],
            "top_skills": [],
            "experience_level": "Fresher",
            "summary": ""
        }

        for line in raw.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.upper().startswith("ROLES:"):
                result["roles"] = [r.strip() for r in line.split(":", 1)[1].split(",") if r.strip()][:5]
            elif line.upper().startswith("COMPANIES:"):
                result["companies"] = [c.strip() for c in line.split(":", 1)[1].split(",") if c.strip()][:6]
            elif line.upper().startswith("TOP_SKILLS:"):
                result["top_skills"] = [s.strip() for s in line.split(":", 1)[1].split(",") if s.strip()][:6]
            elif line.upper().startswith("EXPERIENCE_LEVEL:"):
                result["experience_level"] = line.split(":", 1)[1].strip()
            elif line.upper().startswith("SUMMARY:"):
                result["summary"] = line.split(":", 1)[1].strip()

        # fallback if parsing failed
        if not result["roles"]:
            result["roles"] = ["Software Development Engineer", "Data Analyst", "Product Manager", "DevOps Engineer", "Machine Learning Engineer"]
        if not result["companies"]:
            result["companies"] = ["Google", "Amazon", "Microsoft", "TCS", "Infosys", "Wipro"]
        if not result["summary"]:
            result["summary"] = "Candidate profile analyzed successfully."

        return result

    except Exception as e:
        logger.exception("Gemini error on analyze_resume_for_jobs: %s", e)
        return {
            "roles": ["Software Development Engineer", "Data Analyst", "Product Manager", "DevOps Engineer", "Machine Learning Engineer"],
            "companies": ["Google", "Amazon", "Microsoft", "TCS", "Infosys", "Wipro"],
            "top_skills": [],
            "experience_level": "Fresher",
            "summary": "Could not analyze resume at this time."
        }


def generate_roadmap(resume_text: str, role: str, scores: dict) -> str:
    prompt = f"""Based on this candidate resume and interview performance, generate a personalized career roadmap.
Resume: {resume_text[:MAX_RESUME_LENGTH]}
Target Role: {role}
Performance Scores: {scores}

Provide:
1. Top 3 skill gaps
2. Recommended courses or certifications
3. Timeline to be job ready
4. Resume improvement suggestions
Keep it concise and actionable."""

    try:
        return _generate(prompt)
    except Exception as e:
        logger.exception("Gemini error on generate_roadmap: %s", e)
        return "Roadmap could not be generated at this time. Please try again later."


def parse_evaluation(text: str) -> dict:
    result = {
        "technical_score": 5.0,
        "sbr_score": 5.0,
        "feedback": "Good attempt. Keep practicing.",
        "ideal_answer": "A strong answer would include specific examples with measurable outcomes.",
        "missing_sbr": ""
    }

    for line in text.strip().split("\n"):
        if "TECHNICAL_SCORE:" in line:
            try:
                result["technical_score"] = float(line.split(":")[1].strip().split()[0])
            except ValueError as e:
                logger.warning("Could not parse TECHNICAL_SCORE: %s", e)
        elif "SBR_SCORE:" in line:
            try:
                result["sbr_score"] = float(line.split(":")[1].strip().split()[0])
            except ValueError as e:
                logger.warning("Could not parse SBR_SCORE: %s", e)
        elif "FEEDBACK:" in line:
            result["feedback"] = line.split(":", 1)[1].strip()
        elif "IDEAL_ANSWER:" in line:
            result["ideal_answer"] = line.split(":", 1)[1].strip()
        elif "MISSING_SBR:" in line:
            result["missing_sbr"] = line.split(":", 1)[1].strip()

    return result
