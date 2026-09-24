from pydantic import BaseModel
from typing import Optional, Any


class StudentOut(BaseModel):
    id: int
    usn: str
    name: str
    batch: Optional[str] = None
    status: Optional[str] = None
    semester: Optional[int] = None
    section: Optional[str] = None
    cgpa: Optional[float] = None
    attendance_pct: Optional[float] = None
    backlogs: Optional[int] = None
    data_status: Optional[str] = None

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class AttendanceMarkRequest(BaseModel):
    subject_id: int
    date: str  # "YYYY-MM-DD"
    records: dict  # {student_id: present(bool)}


class NLQueryRequest(BaseModel):
    min_cgpa: Optional[float] = None
    max_backlogs: Optional[int] = None
    batch: Optional[str] = None
    status: Optional[str] = None
    raw_question: Optional[str] = None  # the actual typed question, for real LLM-synthesized answers


class StudentCreate(BaseModel):
    usn: str
    name: str
    batch: str
    semester: Optional[int] = None
    section: Optional[str] = None
    cgpa: Optional[float] = None
    backlogs: Optional[int] = 0


class FacultyCreate(BaseModel):
    name: str
    designation: Optional[str] = None
    email: Optional[str] = None


class AchievementCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: str
    date: Optional[str] = None


class DocumentRequestCreate(BaseModel):
    type: str
    purpose: Optional[str] = None


class DocumentStatusUpdate(BaseModel):
    status: str


class ProfileUpdate(BaseModel):
    linkedin: Optional[str] = None
    github: Optional[str] = None
    skills: Optional[str] = None
