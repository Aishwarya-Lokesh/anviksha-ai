"""display name and profile photo on login accounts

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-10-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('display_name', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('photo_url', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('photo_url')
        batch_op.drop_column('display_name')
