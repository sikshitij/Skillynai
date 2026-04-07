from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.units import inch
import io

def generate_report(session_data: dict, questions_data: list, roadmap: str) -> bytes:
    buffer = io.BytesIO()
    try:
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=24, textColor=colors.HexColor("#6C63FF"))
        heading_style = ParagraphStyle("heading", parent=styles["Heading2"], fontSize=14, textColor=colors.HexColor("#6C63FF"))

        # Title
        story.append(Paragraph("Skillyn AI — Interview Report Card", title_style))
        story.append(Spacer(1, 0.3 * inch))

        # Candidate Info
        story.append(Paragraph("Candidate Details", heading_style))
        info_data = [
            ["Target Role", session_data.get("role", "")],
            ["Target Company", session_data.get("company", "")],
            ["Interviewer Persona", session_data.get("persona", "").replace("_", " ").title()],
            ["Date", session_data.get("date", "")]
        ]
        info_table = Table(info_data, colWidths=[2 * inch, 4 * inch])
        info_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F0EEFF")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("PADDING", (0, 0), (-1, -1), 8)
        ]))
        story.append(info_table)
        story.append(Spacer(1, 0.3 * inch))

        # Score Summary
        story.append(Paragraph("Performance Scores", heading_style))
        scores_data = [
            ["Parameter", "Score", "Rating"],
            ["Technical Score", f"{session_data.get('technical_score', 0):.1f}/10", get_rating(session_data.get("technical_score", 0))],
            ["HR Score", f"{session_data.get('hr_score', 0):.1f}/10", get_rating(session_data.get("hr_score", 0))],
            ["Confidence Score", f"{session_data.get('confidence_score', 0):.1f}/10", get_rating(session_data.get("confidence_score", 0))],
            ["Communication Score", f"{session_data.get('communication_score', 0):.1f}/10", get_rating(session_data.get("communication_score", 0))],
            ["Overall Readiness", f"{session_data.get('overall_score', 0):.1f}/10", get_rating(session_data.get("overall_score", 0))]
        ]
        scores_table = Table(scores_data, colWidths=[2.5 * inch, 1.5 * inch, 2 * inch])
        scores_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6C63FF")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 11),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("PADDING", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9F9FF")])
        ]))
        story.append(scores_table)
        story.append(Spacer(1, 0.3 * inch))

        # Question by Question Feedback
        story.append(Paragraph("Question by Question Feedback", heading_style))
        for i, q in enumerate(questions_data):
            story.append(Paragraph(f"Q{i+1}: {q.get('question_text', '')}", styles["Heading3"]))
            story.append(Paragraph(f"Your Answer: {q.get('answer_text', '')}", styles["Normal"]))
            story.append(Paragraph(f"Feedback: {q.get('feedback', '')}", styles["Normal"]))
            story.append(Paragraph(f"SBR Score: {q.get('sbr_score', 0)}/10", styles["Normal"]))
            story.append(Spacer(1, 0.2 * inch))

        # Career Roadmap
        story.append(Paragraph("Your Personalized Career Roadmap", heading_style))
        story.append(Paragraph(roadmap, styles["Normal"]))
        story.append(Spacer(1, 0.3 * inch))

        # Footer
        story.append(Paragraph("Skillyn AI — Because Every Student Deserves a Fair Shot at Their Dream Job",
                               ParagraphStyle("footer", parent=styles["Normal"],
                                              textColor=colors.HexColor("#6C63FF"),
                                              alignment=1)))

        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()
    finally:
        buffer.close()

def get_rating(score: float) -> str:
    if score >= 8:
        return "Excellent"
    elif score >= 6:
        return "Good"
    elif score >= 4:
        return "Average"
    else:
        return "Needs Improvement"
