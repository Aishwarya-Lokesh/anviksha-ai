"""store the 'faculty' role as 'teacher'

One login was created with role 'faculty', which no dashboard recognises.
The code now treats it as an alias; this brings the stored value in line.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-10-11 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET role = 'teacher' WHERE lower(trim(role)) = 'faculty'")


def downgrade() -> None:
    # Which accounts were originally 'faculty' is not recorded, and the code
    # accepts both spellings, so there is nothing to put back.
    pass
