from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey, Text, JSON, Numeric,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, false
from app.core.database import Base


class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)

    students = relationship("Student", back_populates="department")
    faculty = relationship("Faculty", back_populates="department")
    subjects = relationship("Subject", back_populates="department")


class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True)
    usn = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"))
    batch = Column(String, index=True)          # admission year, e.g. "2023"
    admission_year = Column(Integer)
    status = Column(String, default="active")   # "active" | "passed_out" | "unknown"
    semester = Column(Integer, nullable=True)
    section = Column(String, nullable=True)
    cgpa = Column(Float, nullable=True)          # nullable — NOT AVAILABLE if no data yet
    attendance_pct = Column(Float, nullable=True)
    backlogs = Column(Integer, default=0)
    semester_sgpa = Column(JSON, nullable=True)  # {"1": {"sgpa": 8.1, ...}, ...}
    data_status = Column(String, default="provisional")  # "complete" | "provisional"
    profile_score = Column(Integer, nullable=True)
    linkedin = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)  # real uploaded profile photo, used in Resume Builder
    github = Column(String, nullable=True)
    skills = Column(String, nullable=True)
    resume_link = Column(String, nullable=True)
    resume_file = Column(String, nullable=True)   # stored filename of the uploaded resume, if any
    education = Column(JSON, nullable=True)       # list of {level, institution, board, score, year} for the Resume Builder

    department = relationship("Department", back_populates="students")


class Faculty(Base):
    __tablename__ = "faculty"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"))
    designation = Column(String, nullable=True)
    email = Column(String, nullable=True)
    qualifications = Column(String, nullable=True)
    vtu_teacher_id = Column(String, nullable=True, unique=True)  # real teacher ID from the roster, for traceability
    extra_work = Column(String, nullable=True)  # e.g. "Class Coordinator", "Placement Coordinator", or custom text, editable by HOD
    extra_work_status = Column(String, nullable=True)  # "pending" | "completed" — set by the teacher it was assigned to

    department = relationship("Department", back_populates="faculty")
    subjects = relationship("Subject", back_populates="faculty")


class Subject(Base):
    __tablename__ = "subjects"
    id = Column(Integer, primary_key=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"))
    semester = Column(Integer, nullable=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=True)
    name_verified = Column(Boolean, default=False)  # False = inferred from folder/code, not confirmed against real curriculum
    scheme = Column(String, nullable=True)  # e.g. "2021", "2022" — which VTU scheme this subject belongs to

    department = relationship("Department", back_populates="subjects")
    faculty = relationship("Faculty", back_populates="subjects")


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"))
    date = Column(Date, nullable=False)
    marked_by_faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=True)

    records = relationship("AttendanceRecord", back_populates="session")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id"))
    student_id = Column(Integer, ForeignKey("students.id"))
    present = Column(Boolean, default=True)

    session = relationship("AttendanceSession", back_populates="records")


class Marks(Base):
    __tablename__ = "marks"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    subject_id = Column(Integer, ForeignKey("subjects.id"))
    exam_type = Column(String)  # "IA-1" | "IA-2" | "IA-3" | "Semester"
    marks_obtained = Column(Float, nullable=True)
    max_marks = Column(Float, default=100)


class Achievement(Base):
    """Single table covering all 4 achievement types (Hackathon, Certificate,
    Project, Activity) rather than 4 separate tables — the existing table
    already covers the core fields, this just extends it. certificate_type
    defaults to "ai_generated_demo" for the current demo phase; the field
    exists specifically so real validation can be added later (e.g. set to
    "validated") without a schema change."""
    __tablename__ = "achievements"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String)  # Hackathon | Certificate | Project | Activity
    date = Column(String, nullable=True)
    year = Column(Integer, nullable=True)

    # Hackathon / Certificate / Activity — single certificate/proof file
    certificate_url = Column(String, nullable=True)
    certificate_type = Column(String, nullable=True, default="ai_generated_demo")  # "ai_generated_demo" now, "validated" later
    won = Column(Boolean, default=False)  # Hackathon-only: True if the student explicitly marked this as WON, not just participated

    # Project-only fields
    domain = Column(String, nullable=True)
    tools_used = Column(String, nullable=True)         # comma-separated
    technologies_used = Column(String, nullable=True)  # comma-separated
    images = Column(Text, nullable=True)                # JSON-serialized list of filenames

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DocumentRequest(Base):
    __tablename__ = "document_requests"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    type = Column(String)
    purpose = Column(String, nullable=True)
    status = Column(String, default="Pending")
    requested_date = Column(DateTime, server_default=func.now())


class CounselingNote(Base):
    __tablename__ = "counseling_notes"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    faculty_id = Column(Integer, ForeignKey("faculty.id"))
    note = Column(Text, nullable=False)
    date = Column(DateTime, server_default=func.now())
    # The student's response to the note, and the teacher's follow-up to that.
    reply_status = Column(String, nullable=True)       # e.g. "Pending" | "In Progress" | "Done"
    reply_description = Column(Text, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    teacher_reply = Column(Text, nullable=True)
    teacher_replied_at = Column(DateTime, nullable=True)


class Note(Base):
    """A study note or a deadline a teacher posts to one of their classes.
    Students see it when they belong to that teaching assignment's batch,
    semester and section."""
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    teaching_assignment_id = Column(Integer, ForeignKey("teaching_assignments.id"), nullable=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=True)
    kind = Column(String, nullable=True)       # "note" | "deadline"
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    due_date = Column(String, nullable=True)   # YYYY-MM-DD, deadlines only
    file_url = Column(String, nullable=True)   # stored filename of the attachment
    created_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")
    assignment = relationship("TeachingAssignment")


class QuestionBankChunk(Base):
    """Chunked, subject-tagged text from ingested question papers — indexed
    into the real TF-IDF retrieval layer (app/core/rag_retrieval.py).
    bloom_level/difficulty/marks are populated by scripts/tag_question_bank.py —
    tag_source records HOW each was determined ("extracted" = the real BT Level
    was literally printed in the source PDF, "inferred" = classified from the
    real Bloom's-taxonomy action verb in the question text, "unknown" = neither
    was possible, never guessed)."""
    __tablename__ = "question_bank_chunks"
    id = Column(Integer, primary_key=True)
    subject_folder = Column(String, index=True)
    ia_stage = Column(String, nullable=True)
    source_file = Column(String)
    file_type = Column(String)
    chunk_index = Column(Integer)
    text = Column(Text, nullable=False)
    bloom_level = Column(String, nullable=True)   # Remember | Understand | Apply | Analyze | Evaluate | Create
    difficulty = Column(String, nullable=True)    # Easy | Medium | Hard — derived from real marks value when present
    marks = Column(Integer, nullable=True)         # real marks value, when present in the source text
    tag_source = Column(String, nullable=True)    # "extracted" | "inferred" | "unknown"


class TeachingAssignment(Base):
    """A teacher's real, explicit claim to teach a specific batch/semester/
    department/section/subject. 'batch' is the student's real entry/admission
    year (matches Student.batch exactly, e.g. "2023") — NOT a generic academic
    year. Every teacher-facing page scopes students by batch+semester together
    when assignments exist; falls back to Subject.faculty_id+semester matching
    (batch-blind) when a teacher hasn't configured any assignments yet."""
    __tablename__ = "teaching_assignments"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    year = Column(Integer, nullable=True)  # deprecated, kept for backward compatibility with old rows
    batch = Column(String, nullable=True)  # real student entry-year batch, e.g. "2023" — the correct scoping field
    semester = Column(Integer, nullable=True)   # null only for a passed_out=True "batch is done" record with no current subject
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    section = Column(String, nullable=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)  # null only for a passed_out=True "batch is done" record
    passed_out = Column(Boolean, default=False)

    faculty = relationship("Faculty")
    subject = relationship("Subject")
    department = relationship("Department")


class Company(Base):
    """One row per recruiter. name_key is the normalized form (see
    app.core.placement_matching.company_key) that every import and form goes
    through, so "DELL", "Dell" and "Dell Technologies" can never become three
    different companies."""
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    name_key = Column(String, nullable=False, unique=True, index=True)
    sector = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    website = Column(String, nullable=True)


class PlacementDrive(Base):
    __tablename__ = "placement_drives"
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    drive_type = Column(String, nullable=True)   # "campus" | "off-campus" | "pool" | "Not specified"
    drive_date = Column(Date, nullable=True)
    venue = Column(String, nullable=True)
    batch = Column(String, nullable=True, index=True)  # student entry-year batch, matches Student.batch
    source_note = Column(String, nullable=True)

    company = relationship("Company")


class Placement(Base):
    """One row per offer. Rows loaded before the companies table existed keep
    their original free-text company/ctc and may have placed=False (a student
    recorded as not placed) — those are not offers, so every reader goes
    through the v_* views, which count only placed rows that weren't declined."""
    __tablename__ = "placements"
    __table_args__ = (
        UniqueConstraint("student_id", "company_id", "offer_type", name="uq_placement_student_company_offer"),
    )
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"), index=True)
    placed = Column(Boolean, default=False)
    placement_type = Column(String, nullable=True)  # "Dream" | "Regular" | None
    resume_link = Column(String, nullable=True)
    company = Column(String, nullable=True)   # real company name, only where the source data actually has it
    ctc = Column(String, nullable=True)       # real package/CTC as given in the source, e.g. "11 LPA"

    usn = Column(String, nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True, index=True)
    drive_id = Column(Integer, ForeignKey("placement_drives.id"), nullable=True)
    role = Column(String, nullable=True)
    package_lpa = Column(Numeric(6, 2), nullable=True)
    offer_type = Column(String, nullable=True)   # "full-time" | "PPO" | "internship+PPO"
    offer_date = Column(Date, nullable=True)
    status = Column(String, nullable=True)       # "offered" | "accepted" | "joined" | "declined"
    offer_letter_path = Column(String, nullable=True)
    verified = Column(Boolean, nullable=False, default=False, server_default=false())
    source_note = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    company_ref = relationship("Company")
    drive = relationship("PlacementDrive")


class CourseCompletion(Base):
    __tablename__ = "course_completions"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    course_name = Column(String, nullable=False)
    duration = Column(String, nullable=True)
    platform = Column(String, nullable=True)
    remarks = Column(String, nullable=True)

    student = relationship("Student")


class Internship(Base):
    __tablename__ = "internships"
    __table_args__ = (
        UniqueConstraint("student_id", "company_id", "start_date", name="uq_internship_student_company_start"),
    )
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    company = Column(String, nullable=False)
    duration_text = Column(String, nullable=True)  # real text as given, e.g. "May 19th - July 18th"
    stipend = Column(String, nullable=True)  # left null unless a real official figure is provided

    usn = Column(String, nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True, index=True)
    role = Column(String, nullable=True)
    stipend_per_month = Column(Numeric(10, 2), nullable=True)  # INR
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    status = Column(String, nullable=True)   # "ongoing" | "completed"
    mode = Column(String, nullable=True)     # "onsite" | "remote" | "hybrid"
    certificate_path = Column(String, nullable=True)
    verified = Column(Boolean, nullable=False, default=False, server_default=false())
    source_note = Column(String, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    company_ref = relationship("Company")


class CertificateFile(Base):
    """Links a certificate/achievement PDF to a student — either a real,
    verified file (checked by content, not just filename) or a clearly-marked
    demo/placeholder file explicitly requested by the user for demonstration
    purposes. Does NOT attempt to parse a course name out of the file — the
    certificate formats vary too much across issuing platforms to do that
    reliably. The file itself is the record."""
    __tablename__ = "certificate_files"
    id = Column(Integer, primary_key=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    filename = Column(String, nullable=False)  # actual file on disk, e.g. "4GW23IS001_Aishwarya_S_L.pdf"
    display_label = Column(String, nullable=True)  # e.g. "MOOC Certificate" — no fabricated course name
    category = Column(String, nullable=False, default="Certificate")  # "Hackathon" | "Certificate" | "Project" | "Activity"
    is_demo = Column(Boolean, default=False)  # True = explicitly a placeholder/demo file, never presented as a real record
    uploaded_at = Column(DateTime, server_default=func.now())

    student = relationship("Student")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    message = Column(String, nullable=False)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True)
    actor_email = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)
    action = Column(String, nullable=False)
    timestamp = Column(DateTime, server_default=func.now())


class User(Base):
    """Login identity, separate from Student/Faculty profile rows so admin accounts
    don't require a student/faculty record."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "admin" | "hod" | "teacher" | "student"
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)  # for "hod" role
    hod_title = Column(String, nullable=True)  # e.g. "Head of Department, ISE"
    display_name = Column(String, nullable=True)  # for accounts with no student/faculty record behind them (admin, HOD)
    photo_url = Column(String, nullable=True)     # profile photo for staff accounts; a student's lives on the student record


class StyleReference(Base):
    """A real past PPT or notes document a teacher uploads so the system can
    learn their real formatting style — never fabricated, extracted directly
    from the real uploaded file's actual structure (slide count, bullets per
    slide, heading patterns for PPTs; heading/paragraph patterns for notes)."""
    __tablename__ = "style_references"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)
    output_type = Column(String, nullable=False)  # "ppt" | "notes"
    filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    style_profile = Column(Text, nullable=True)  # JSON: real structural stats extracted from the file
    uploaded_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")
    subject = relationship("Subject")


class ContentSource(Base):
    """A real textbook/reference document a teacher uploads as the grounding
    content for generation. chapters is real text extracted from the file,
    split by real detected chapter/module headings when possible — never
    invented chapter titles."""
    __tablename__ = "content_sources"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)
    filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    chapters = Column(Text, nullable=True)  # JSON list of {title, text}
    chapters_detected = Column(Boolean, default=False)  # True if real headings were found; False if fallback chunking was used
    uploaded_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")
    subject = relationship("Subject")


class QuestionPaperDocument(Base):
    """A real .pdf/.docx file a teacher uploads for the Question Paper
    Generator — either their own Subject Notes (used only to check that
    generated questions are actually supported by taught content) or an
    Important Questions bank (the real source questions are extracted
    from this file whenever possible, never invented)."""
    __tablename__ = "question_paper_documents"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    kind = Column(String, nullable=False)  # "notes" | "important_questions"
    filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    module_hint = Column(String, nullable=True)
    extracted_text = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="processed")
    uploaded_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")


class QuestionPaper(Base):
    """A saved, generated question paper — one row per Set A / Set B — built
    from a teacher's own uploaded Important Questions + Subject Notes rather
    than a generic template. validation records the real quality-control
    results computed at generation time (mark totals, duplicates, how many
    questions were extracted verbatim vs. AI-completed for an under-supplied
    slot)."""
    __tablename__ = "question_papers"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    title = Column(String, nullable=False)
    set_label = Column(String, nullable=False)  # "A" | "B"
    settings = Column(Text, nullable=False)      # JSON: subject/exam/header/structure config
    paper = Column(Text, nullable=False)         # JSON: list of {name, questions:[...]}
    validation = Column(Text, nullable=True)     # JSON: quality-control results
    created_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")


class GeneratedPresentation(Base):
    """A saved AI-generated slide deck (real slide JSON, not a template) so a
    teacher can reopen a past generation without spending another AI call,
    and so a repeat request for the exact same chapters+settings can be
    served instantly instead of re-generating. request_fingerprint hashes
    the real chapter text plus every generation setting that changes the
    output, so any actual content or setting change produces a fresh
    fingerprint rather than a stale cache hit."""
    __tablename__ = "generated_presentations"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    content_source_id = Column(Integer, ForeignKey("content_sources.id"), nullable=False)
    style_reference_id = Column(Integer, ForeignKey("style_references.id"), nullable=True)
    title = Column(String, nullable=False)
    source_filename = Column(String, nullable=False)
    request_fingerprint = Column(String, nullable=False, index=True)
    settings = Column(Text, nullable=False)  # JSON: the real generation settings used
    slides = Column(Text, nullable=False)    # JSON: the real slide list returned by the AI
    slide_count = Column(Integer, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")
    content_source = relationship("ContentSource")
    style_reference = relationship("StyleReference")


class ModuleMapping(Base):
    """A teacher's real, saved mapping of syllabus module -> real textbook
    chapters. A textbook's own chapters and a department's syllabus modules
    are two independent structures — nothing can safely auto-guess which
    real chapters belong to which module. The teacher makes this decision
    ONCE, it's saved here, and every future generation for that module reuses
    it correctly instead of re-asking or guessing."""
    __tablename__ = "module_mappings"
    id = Column(Integer, primary_key=True)
    faculty_id = Column(Integer, ForeignKey("faculty.id"), nullable=False)
    content_source_id = Column(Integer, ForeignKey("content_sources.id"), nullable=False)
    module_name = Column(String, nullable=False)
    chapter_titles = Column(Text, nullable=False)  # JSON list of real chapter titles from that content source
    created_at = Column(DateTime, server_default=func.now())

    faculty = relationship("Faculty")
    content_source = relationship("ContentSource")
