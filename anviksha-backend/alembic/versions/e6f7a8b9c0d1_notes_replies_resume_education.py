"""notes table, counseling replies, resume file, education, extra-work status

Everything here backs a screen that already exists in the app but had no
storage behind it. Additive only.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-10-12 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.placement_views import create_views, drop_views


# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # The production database already has a notes table that no earlier
    # migration created; it is left exactly as it is. Anywhere else, create it.
    if 'notes' not in inspector.get_table_names():
        op.create_table(
            'notes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('teaching_assignment_id', sa.Integer(), nullable=True),
            sa.Column('faculty_id', sa.Integer(), nullable=True),
            sa.Column('kind', sa.String(), nullable=True),
            sa.Column('title', sa.String(), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('due_date', sa.String(), nullable=True),
            sa.Column('file_url', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(['faculty_id'], ['faculty.id']),
            sa.ForeignKeyConstraint(['teaching_assignment_id'], ['teaching_assignments.id']),
            sa.PrimaryKeyConstraint('id'),
        )

    with op.batch_alter_table('students') as batch_op:
        batch_op.add_column(sa.Column('resume_file', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('education', sa.JSON(), nullable=True))

    with op.batch_alter_table('faculty') as batch_op:
        batch_op.add_column(sa.Column('extra_work_status', sa.String(), nullable=True))

    with op.batch_alter_table('counseling_notes') as batch_op:
        batch_op.add_column(sa.Column('reply_status', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('reply_description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('replied_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('teacher_reply', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('teacher_replied_at', sa.DateTime(), nullable=True))

    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE public."notes" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    # SQLite removes a column by rebuilding the table, which it refuses to do
    # while a view reads from that table; the placement views read students.
    sqlite = op.get_bind().dialect.name == "sqlite"
    if sqlite:
        drop_views(op.get_bind())
    with op.batch_alter_table('counseling_notes') as batch_op:
        for column in ('teacher_replied_at', 'teacher_reply', 'replied_at', 'reply_description', 'reply_status'):
            batch_op.drop_column(column)
    with op.batch_alter_table('faculty') as batch_op:
        batch_op.drop_column('extra_work_status')
    with op.batch_alter_table('students') as batch_op:
        batch_op.drop_column('education')
        batch_op.drop_column('resume_file')
    if sqlite:
        create_views(op.get_bind())
    # The notes table is deliberately not dropped: in production it pre-dates
    # this migration and holds real rows.
