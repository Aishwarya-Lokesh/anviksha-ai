"""placement single source of truth: companies, drives, structured offers, views

Additive only. Existing placements/internships rows and columns are kept;
new columns are nullable and back-filled where the old free-text value can be
read unambiguously.

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-10-11 21:00:00.000000

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.placement_matching import canonical_company


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = ("companies", "placement_drives")
VIEWS = ("v_batch_placement_stats", "v_company_stats", "v_student_placement_summary")

# An offer counts unless the student declined it. Rows with placed = false are
# "recorded as not placed" markers from the older import, not offers.
_IS_OFFER = "p.placed = true AND coalesce(p.status, '') <> 'declined'"

V_STUDENT = f"""
CREATE VIEW v_student_placement_summary AS
SELECT
    s.id AS student_id, s.usn, s.name, s.batch, s.department_id,
    (SELECT count(*) FROM placements p WHERE p.student_id = s.id AND {_IS_OFFER}) AS offers_count,
    (SELECT max(p.package_lpa) FROM placements p WHERE p.student_id = s.id AND {_IS_OFFER}) AS highest_package_lpa,
    CASE WHEN EXISTS (SELECT 1 FROM placements p WHERE p.student_id = s.id AND {_IS_OFFER}) THEN 1 ELSE 0 END AS is_placed,
    (SELECT count(*) FROM internships i WHERE i.student_id = s.id) AS internships_count,
    (SELECT max(i.stipend_per_month) FROM internships i WHERE i.student_id = s.id) AS highest_stipend_per_month,
    CASE WHEN EXISTS (SELECT 1 FROM placements p WHERE p.student_id = s.id AND {_IS_OFFER}
                      AND p.offer_type IN ('PPO', 'internship+PPO')) THEN 1 ELSE 0 END AS has_ppo
FROM students s
"""

# Median is deliberately not here: it has no portable SQL form, so the API
# computes it from v_student_placement_summary.highest_package_lpa.
V_BATCH = """
CREATE VIEW v_batch_placement_stats AS
SELECT
    v.batch, v.department_id,
    count(*) AS total_students,
    sum(v.is_placed) AS placed_count,
    count(*) - sum(v.is_placed) AS unplaced_count,
    round(100.0 * sum(v.is_placed) / count(*), 1) AS placement_pct,
    sum(v.offers_count) AS offers_count,
    round(avg(v.highest_package_lpa), 2) AS avg_package_lpa,
    max(v.highest_package_lpa) AS highest_package_lpa,
    sum(CASE WHEN v.internships_count > 0 THEN 1 ELSE 0 END) AS students_with_internship,
    sum(v.internships_count) AS internships_count,
    round(avg(v.highest_stipend_per_month), 0) AS avg_stipend_per_month,
    max(v.highest_stipend_per_month) AS highest_stipend_per_month,
    sum(v.has_ppo) AS ppo_count
FROM v_student_placement_summary v
GROUP BY v.batch, v.department_id
"""

V_COMPANY = f"""
CREATE VIEW v_company_stats AS
SELECT
    c.id AS company_id, c.name AS company, x.batch, x.department_id,
    sum(x.offers_count) AS offers_count,
    sum(x.placed_students) AS placed_students,
    max(x.avg_package_lpa) AS avg_package_lpa,
    max(x.highest_package_lpa) AS highest_package_lpa,
    max(x.lowest_package_lpa) AS lowest_package_lpa,
    sum(x.interns_count) AS interns_count,
    max(x.avg_stipend_per_month) AS avg_stipend_per_month,
    max(x.highest_stipend_per_month) AS highest_stipend_per_month
FROM companies c
JOIN (
    SELECT p.company_id, s.batch, s.department_id,
           count(*) AS offers_count,
           count(DISTINCT p.student_id) AS placed_students,
           round(avg(p.package_lpa), 2) AS avg_package_lpa,
           max(p.package_lpa) AS highest_package_lpa,
           min(p.package_lpa) AS lowest_package_lpa,
           0 AS interns_count,
           CAST(NULL AS NUMERIC) AS avg_stipend_per_month,
           CAST(NULL AS NUMERIC) AS highest_stipend_per_month
    FROM placements p JOIN students s ON s.id = p.student_id
    WHERE p.company_id IS NOT NULL AND {_IS_OFFER}
    GROUP BY p.company_id, s.batch, s.department_id
    UNION ALL
    SELECT i.company_id, s.batch, s.department_id,
           0, 0, CAST(NULL AS NUMERIC), CAST(NULL AS NUMERIC), CAST(NULL AS NUMERIC),
           count(*), round(avg(i.stipend_per_month), 0), max(i.stipend_per_month)
    FROM internships i JOIN students s ON s.id = i.student_id
    WHERE i.company_id IS NOT NULL
    GROUP BY i.company_id, s.batch, s.department_id
) x ON x.company_id = c.id
GROUP BY c.id, c.name, x.batch, x.department_id
"""

# "11 LPA", "4.25 lpa", "14 Lakhs". Anything else (e.g. "Intern with Stipend
# of 25k/Month") is left unparsed rather than guessed at.
_CTC = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?)\s*$", re.IGNORECASE)


def _backfill(conn) -> None:
    companies: dict[str, int] = {}

    def company_id(raw: str) -> int:
        display, key = canonical_company(raw)
        if key not in companies:
            conn.execute(sa.text("INSERT INTO companies (name, name_key) VALUES (:n, :k)"), {"n": display, "k": key})
            companies[key] = conn.execute(sa.text("SELECT id FROM companies WHERE name_key = :k"), {"k": key}).scalar()
        return companies[key]

    rows = conn.execute(sa.text("SELECT id, company, ctc FROM placements")).all()
    for row_id, company, ctc in rows:
        values = {"id": row_id, "cid": None, "pkg": None}
        if company and company.strip():
            values["cid"] = company_id(company)
        parsed = _CTC.match(ctc or "")
        if parsed:
            values["pkg"] = float(parsed.group(1))
        conn.execute(sa.text("UPDATE placements SET company_id = :cid, package_lpa = :pkg WHERE id = :id"), values)

    for row_id, company in conn.execute(sa.text("SELECT id, company FROM internships")).all():
        if company and company.strip():
            conn.execute(sa.text("UPDATE internships SET company_id = :cid WHERE id = :id"),
                         {"cid": company_id(company), "id": row_id})

    for table in ("placements", "internships"):
        conn.execute(sa.text(
            f"UPDATE {table} SET usn = (SELECT s.usn FROM students s WHERE s.id = {table}.student_id) WHERE usn IS NULL"
        ))


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    op.create_table(
        'companies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('name_key', sa.String(), nullable=False),
        sa.Column('sector', sa.String(), nullable=True),
        sa.Column('logo_url', sa.String(), nullable=True),
        sa.Column('website', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index('ix_companies_name_key', 'companies', ['name_key'], unique=True)

    op.create_table(
        'placement_drives',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('drive_type', sa.String(), nullable=True),
        sa.Column('drive_date', sa.Date(), nullable=True),
        sa.Column('venue', sa.String(), nullable=True),
        sa.Column('batch', sa.String(), nullable=True),
        sa.Column('source_note', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_placement_drives_batch', 'placement_drives', ['batch'])

    # The old one-row-per-student rule has to go so a student can hold more
    # than one offer. SQLite can only drop it by rebuilding the table, and its
    # original constraint is unnamed, hence the naming convention.
    sqlite_naming = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table('placements', naming_convention=None if is_postgres else sqlite_naming) as batch_op:
        batch_op.add_column(sa.Column('usn', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('company_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('drive_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('role', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('package_lpa', sa.Numeric(6, 2), nullable=True))
        batch_op.add_column(sa.Column('offer_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('offer_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('status', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('offer_letter_path', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('source_note', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('created_by', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=True))
        batch_op.drop_constraint('placements_student_id_key' if is_postgres else 'uq_placements_student_id', type_='unique')
        batch_op.create_foreign_key('fk_placements_company_id', 'companies', ['company_id'], ['id'])
        batch_op.create_foreign_key('fk_placements_drive_id', 'placement_drives', ['drive_id'], ['id'])
        batch_op.create_foreign_key('fk_placements_created_by', 'users', ['created_by'], ['id'])
        batch_op.create_unique_constraint('uq_placement_student_company_offer', ['student_id', 'company_id', 'offer_type'])
        batch_op.create_index('ix_placements_student_id', ['student_id'])
        batch_op.create_index('ix_placements_company_id', ['company_id'])
        batch_op.create_index('ix_placements_usn', ['usn'])

    with op.batch_alter_table('internships') as batch_op:
        batch_op.add_column(sa.Column('usn', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('company_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('role', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('stipend_per_month', sa.Numeric(10, 2), nullable=True))
        batch_op.add_column(sa.Column('start_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('end_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('status', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('mode', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('certificate_path', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('source_note', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=True))
        batch_op.create_foreign_key('fk_internships_company_id', 'companies', ['company_id'], ['id'])
        batch_op.create_unique_constraint('uq_internship_student_company_start', ['student_id', 'company_id', 'start_date'])
        batch_op.create_index('ix_internships_student_id', ['student_id'])
        batch_op.create_index('ix_internships_company_id', ['company_id'])
        batch_op.create_index('ix_internships_usn', ['usn'])

    _backfill(bind)

    for ddl in (V_STUDENT, V_BATCH, V_COMPANY):
        op.execute(ddl)

    if is_postgres:
        # The API connects as the table owner, which RLS does not restrict, so
        # role scoping stays in the API. These statements close the other door:
        # Supabase's auto-generated REST API, which would otherwise serve these
        # tables and views to anyone holding the project's public anon key.
        for table in NEW_TABLES + ("placements", "internships"):
            op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        # security_invoker (views obey the caller's RLS) exists from Postgres 15.
        if bind.dialect.server_version_info >= (15,):
            for view in VIEWS:
                op.execute(f'ALTER VIEW public."{view}" SET (security_invoker = true)')
        op.execute("""
            DO $$
            DECLARE r text; o text;
            BEGIN
              FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                  FOREACH o IN ARRAY ARRAY['companies', 'placement_drives', 'placements', 'internships',
                                           'v_student_placement_summary', 'v_batch_placement_stats', 'v_company_stats'] LOOP
                    EXECUTE format('REVOKE ALL ON public.%I FROM %I', o, r);
                  END LOOP;
                END IF;
              END LOOP;
            END $$;
        """)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    for view in VIEWS:
        op.execute(f"DROP VIEW IF EXISTS {view}")

    if is_postgres:
        for table in ("placements", "internships"):
            op.execute(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY')

    with op.batch_alter_table('internships') as batch_op:
        for index in ('ix_internships_usn', 'ix_internships_company_id', 'ix_internships_student_id'):
            batch_op.drop_index(index)
        batch_op.drop_constraint('uq_internship_student_company_start', type_='unique')
        batch_op.drop_constraint('fk_internships_company_id', type_='foreignkey')
        for column in ('updated_at', 'source_note', 'verified', 'certificate_path', 'mode', 'status', 'end_date',
                       'start_date', 'stipend_per_month', 'role', 'company_id', 'usn'):
            batch_op.drop_column(column)

    # Restoring UNIQUE(student_id) is only possible while no student holds two
    # offers; if any does, this fails loudly rather than deleting an offer.
    with op.batch_alter_table('placements') as batch_op:
        for index in ('ix_placements_usn', 'ix_placements_company_id', 'ix_placements_student_id'):
            batch_op.drop_index(index)
        batch_op.drop_constraint('uq_placement_student_company_offer', type_='unique')
        for fk in ('fk_placements_created_by', 'fk_placements_drive_id', 'fk_placements_company_id'):
            batch_op.drop_constraint(fk, type_='foreignkey')
        for column in ('updated_at', 'created_by', 'source_note', 'verified', 'offer_letter_path', 'status', 'offer_date',
                       'offer_type', 'package_lpa', 'role', 'drive_id', 'company_id', 'usn'):
            batch_op.drop_column(column)
        batch_op.create_unique_constraint('placements_student_id_key', ['student_id'])

    op.drop_index('ix_placement_drives_batch', table_name='placement_drives')
    op.drop_table('placement_drives')
    op.drop_index('ix_companies_name_key', table_name='companies')
    op.drop_table('companies')
