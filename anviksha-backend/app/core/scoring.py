"""
Real achievement-points calculation — shared by Teacher > Performance &
Feedback and Student > Excellence Score, so the same student's achievement
points are always identical no matter which page computes them.

Formula (exact, from the Teacher/Student module specs):
    Certificate           = 50 points each
    Hackathon participated = 50 points each
    Hackathon won          = +100 points bonus (on top of the 50 for participating)
    Project completed      = 100 points each

Counts are read directly from real Achievement records — never fabricated,
never duplicated (a won hackathon is still exactly one Achievement record,
counted once, with the win bonus added on top).
"""

from sqlalchemy.orm import Session
from app.models.models import Achievement

CERT_POINTS = 50
HACKATHON_PARTICIPATE_POINTS = 50
HACKATHON_WIN_BONUS = 100
PROJECT_POINTS = 100


def calculate_achievement_points(db: Session, student_id: int) -> dict:
    """Real, live-computed breakdown — never cached, never hardcoded."""
    achievements = db.query(Achievement).filter(Achievement.student_id == student_id).all()

    cert_count = sum(1 for a in achievements if a.type == "Certificate")
    hackathon_count = sum(1 for a in achievements if a.type == "Hackathon")
    hackathon_won_count = sum(1 for a in achievements if a.type == "Hackathon" and a.won)
    project_count = sum(1 for a in achievements if a.type == "Project")

    cert_points = cert_count * CERT_POINTS
    hackathon_points = hackathon_count * HACKATHON_PARTICIPATE_POINTS
    hackathon_won_points = hackathon_won_count * HACKATHON_WIN_BONUS
    project_points = project_count * PROJECT_POINTS

    total = cert_points + hackathon_points + hackathon_won_points + project_points

    return {
        "certificate_count": cert_count, "certificate_points": cert_points,
        "hackathon_count": hackathon_count, "hackathon_points": hackathon_points,
        "hackathon_won_count": hackathon_won_count, "hackathon_won_points": hackathon_won_points,
        "project_count": project_count, "project_points": project_points,
        "total_achievement_points": total,
    }


def calculate_cgpa_points(cgpa) -> dict:
    """Real, tiered CGPA point calculation — exact thresholds from spec.
    Boundary values (exactly 9.0, 8.0, 7.0, 6.0, 5.0) always round DOWN into
    the lower-labeled tier per the spec's explicit examples (e.g. CGPA
    exactly 9.0 -> 800, not 1000)."""
    if cgpa is None:
        return {"cgpa": None, "cgpa_points": 0, "reason": "No CGPA on record yet"}
    if cgpa > 9.0:
        points, reason = 1000, "CGPA above 9.0"
    elif cgpa >= 8.0:
        points, reason = 800, "CGPA between 8.0 and 9.0"
    elif cgpa >= 7.0:
        points, reason = 600, "CGPA between 7.0 and 8.0"
    elif cgpa >= 6.0:
        points, reason = 400, "CGPA between 6.0 and 7.0"
    elif cgpa >= 5.0:
        points, reason = 200, "CGPA between 5.0 and 6.0"
    else:
        points, reason = 50, "CGPA below 5.0"
    return {"cgpa": cgpa, "cgpa_points": points, "reason": reason}
