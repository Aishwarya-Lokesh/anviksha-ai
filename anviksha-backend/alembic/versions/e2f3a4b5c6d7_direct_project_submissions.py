"""direct project submissions to a guide

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-10-28 10:00:00

Adds only: one new table and one nullable column. Nothing existing changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('project_submissions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('guide_faculty_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('files', sa.Text(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('client_token', sa.String(), nullable=True),
    sa.Column('student_unread', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('reviewed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.ForeignKeyConstraint(['guide_faculty_id'], ['faculty.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['student_projects.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_project_submissions_project_id'), 'project_submissions', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_submissions_student_id'), 'project_submissions', ['student_id'], unique=False)
    op.create_index(op.f('ix_project_submissions_guide_faculty_id'), 'project_submissions', ['guide_faculty_id'], unique=False)
    op.create_index(op.f('ix_project_submissions_client_token'), 'project_submissions', ['client_token'], unique=False)
    with op.batch_alter_table('project_comments') as batch:
        batch.add_column(sa.Column('submission_id', sa.Integer(), nullable=True))
        batch.create_index(batch.f('ix_project_comments_submission_id'), ['submission_id'], unique=False)
        batch.create_foreign_key('fk_project_comments_submission_id', 'project_submissions', ['submission_id'], ['id'])
    # Second barrier, as on every other table: nothing reaches these rows except through the API.
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE public."project_submissions" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    with op.batch_alter_table('project_comments') as batch:
        batch.drop_constraint('fk_project_comments_submission_id', type_='foreignkey')
        batch.drop_index(batch.f('ix_project_comments_submission_id'))
        batch.drop_column('submission_id')
    op.drop_index(op.f('ix_project_submissions_client_token'), table_name='project_submissions')
    op.drop_index(op.f('ix_project_submissions_guide_faculty_id'), table_name='project_submissions')
    op.drop_index(op.f('ix_project_submissions_student_id'), table_name='project_submissions')
    op.drop_index(op.f('ix_project_submissions_project_id'), table_name='project_submissions')
    op.drop_table('project_submissions')
