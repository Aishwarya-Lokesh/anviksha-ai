"""anonymous feedback

Two tables that are never joined: the answers (no student), and a record that
a student has answered (no answers, no time).

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-10-12 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'feedback',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('faculty_id', sa.Integer(), nullable=False),
        sa.Column('batch', sa.String(), nullable=True),
        sa.Column('semester', sa.Integer(), nullable=True),
        sa.Column('clarity', sa.Integer(), nullable=False),
        sa.Column('knowledge', sa.Integer(), nullable=False),
        sa.Column('pace', sa.Integer(), nullable=False),
        sa.Column('support', sa.Integer(), nullable=False),
        sa.Column('overall', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculty.id']),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_feedback_subject_id', 'feedback', ['subject_id'])
    op.create_index('ix_feedback_faculty_id', 'feedback', ['faculty_id'])
    op.create_index('ix_feedback_batch', 'feedback', ['batch'])

    op.create_table(
        'feedback_submissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('faculty_id', sa.Integer(), nullable=False),
        sa.Column('semester', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculty.id']),
        sa.ForeignKeyConstraint(['student_id'], ['students.id']),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('student_id', 'subject_id', 'faculty_id', 'semester', name='uq_feedback_once'),
    )
    op.create_index('ix_feedback_submissions_student_id', 'feedback_submissions', ['student_id'])

    if op.get_bind().dialect.name == "postgresql":
        for table in ("feedback", "feedback_submissions"):
            op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    op.drop_index('ix_feedback_submissions_student_id', table_name='feedback_submissions')
    op.drop_table('feedback_submissions')
    for index in ('ix_feedback_batch', 'ix_feedback_faculty_id', 'ix_feedback_subject_id'):
        op.drop_index(index, table_name='feedback')
    op.drop_table('feedback')
