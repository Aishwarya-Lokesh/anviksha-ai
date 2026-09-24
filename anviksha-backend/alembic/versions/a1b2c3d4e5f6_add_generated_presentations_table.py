"""add generated presentations table

Revision ID: a1b2c3d4e5f6
Revises: 7598e2c98eef
Create Date: 2026-09-23 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '7598e2c98eef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('generated_presentations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('faculty_id', sa.Integer(), nullable=False),
    sa.Column('content_source_id', sa.Integer(), nullable=False),
    sa.Column('style_reference_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('source_filename', sa.String(), nullable=False),
    sa.Column('request_fingerprint', sa.String(), nullable=False),
    sa.Column('settings', sa.Text(), nullable=False),
    sa.Column('slides', sa.Text(), nullable=False),
    sa.Column('slide_count', sa.Integer(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.ForeignKeyConstraint(['faculty_id'], ['faculty.id'], ),
    sa.ForeignKeyConstraint(['content_source_id'], ['content_sources.id'], ),
    sa.ForeignKeyConstraint(['style_reference_id'], ['style_references.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_generated_presentations_request_fingerprint'), 'generated_presentations', ['request_fingerprint'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_generated_presentations_request_fingerprint'), table_name='generated_presentations')
    op.drop_table('generated_presentations')
