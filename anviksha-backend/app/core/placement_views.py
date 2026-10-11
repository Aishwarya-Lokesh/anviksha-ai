"""The three placement views every screen, report and assistant reads from.

Kept here rather than inside the migration so the test suite can create the
same views on its in-memory database. If a view ever needs to change, add a
new migration that drops and recreates it from this module.
"""
from sqlalchemy import text

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


def create_views(conn) -> None:
    for ddl in (V_STUDENT, V_BATCH, V_COMPANY):
        conn.execute(text(ddl))


def drop_views(conn) -> None:
    for view in VIEWS:
        conn.execute(text(f"DROP VIEW IF EXISTS {view}"))
