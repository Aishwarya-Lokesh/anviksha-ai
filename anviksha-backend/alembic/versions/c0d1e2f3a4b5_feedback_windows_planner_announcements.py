"""feedback windows, student planner, announcements, account active flag

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-10-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = ("feedback_windows", "planner_items", "announcements")


def upgrade() -> None:
    op.create_table(
        'feedback_windows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('faculty_id', sa.Integer(), nullable=False),
        sa.Column('is_open', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('changed_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column('changed_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id']),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculty.id']),
        sa.ForeignKeyConstraint(['changed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('subject_id', 'faculty_id', name='uq_feedback_window'),
    )
    op.create_index('ix_feedback_windows_faculty_id', 'feedback_windows', ['faculty_id'])

    op.create_table(
        'planner_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('subject', sa.String(), nullable=True),
        sa.Column('due_at', sa.DateTime(), nullable=True),
        sa.Column('priority', sa.String(), nullable=True),
        sa.Column('remind', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('done', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['student_id'], ['students.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_planner_items_student_id', 'planner_items', ['student_id'])

    op.create_table(
        'announcements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('author_user_id', sa.Integer(), nullable=False),
        sa.Column('author_name', sa.String(), nullable=False),
        sa.Column('author_role', sa.String(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('audience', sa.String(), nullable=False),
        sa.Column('batch', sa.String(), nullable=True),
        sa.Column('semester', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(), nullable=False, server_default='notice'),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['author_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_announcements_author_user_id', 'announcements', ['author_user_id'])

    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))

    if op.get_bind().dialect.name == "postgresql":
        for table in NEW_TABLES:
            op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('is_active')
    op.drop_index('ix_announcements_author_user_id', table_name='announcements')
    op.drop_table('announcements')
    op.drop_index('ix_planner_items_student_id', table_name='planner_items')
    op.drop_table('planner_items')
    op.drop_index('ix_feedback_windows_faculty_id', table_name='feedback_windows')
    op.drop_table('feedback_windows')
