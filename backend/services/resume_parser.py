import re
import pdfplumber
from docx import Document
import io

SKILL_KEYWORDS = [
    "python", "java", "javascript", "typescript", "c++", "c#", "go", "rust", "sql", "html", "css",
    "react", "angular", "vue", "node", "flask", "django", "fastapi", "spring", "docker", "kubernetes",
    "aws", "azure", "gcp", "git", "linux", "machine learning", "deep learning", "tensorflow", "pytorch",
    "data analysis", "pandas", "numpy", "scikit-learn", "mongodb", "postgresql", "mysql", "redis"
]

SECTION_HEADERS = ["experience", "education", "skills", "projects", "certifications", "summary", "objective"]


def parse_resume(file_bytes: bytes, filename: str) -> dict:
    if filename.lower().endswith(".pdf"):
        text = parse_pdf(file_bytes)
    elif filename.lower().endswith(".docx"):
        text = parse_docx(file_bytes)
    else:
        text = ""

    text_lower = text.lower()
    skills = ", ".join(kw for kw in SKILL_KEYWORDS if kw in text_lower)
    sections = [h for h in SECTION_HEADERS if h in text_lower]
    entities = re.findall(r'[A-Z][a-z]+ [A-Z][a-z]+', text)

    return {
        "text": text,
        "skills": skills,
        "entities": list(set(entities))[:10],
        "sections": sections
    }


def parse_pdf(file_bytes: bytes) -> str:
    text = ""
    buffer = io.BytesIO(file_bytes)
    try:
        with pdfplumber.open(buffer) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
    finally:
        buffer.close()
    return text.strip()


def parse_docx(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs).strip()
