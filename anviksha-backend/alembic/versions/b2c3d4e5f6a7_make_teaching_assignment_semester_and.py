"""make teaching_assignment semester and subject_id nullable

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-23 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('teaching_assignments') as batch_op:
        batch_op.alter_column('semester', existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column('subject_id', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('teaching_assignments') as batch_op:
        batch_op.alter_column('subject_id', existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column('semester', existing_type=sa.Integer(), nullable=False)
