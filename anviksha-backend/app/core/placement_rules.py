"""Real placement/CTC business rules — extracted from app/routers/admin.py's
placement_dashboard endpoint (Part A4: reuse existing logic rather than
duplicate it). admin.py has been re-pointed at these same functions, with
output verified byte-for-byte identical before and after the extraction.
"""
import re

_CTC_NUMBER_RE = re.compile(r"(\d+(\.\d+)?)")

# Real offer-tier thresholds, exactly as previously defined inline in
# admin.py's placement_dashboard — not changed, only named and shared.
REGULAR_MAX_LPA = 6
DREAM_MAX_LPA = 10


def parse_ctc_lpa(ctc_text: str):
    """Extracts the leading numeric LPA value from a real free-text CTC
    string (e.g. "11 LPA" -> 11.0). Returns None if no number is present —
    never guessed."""
    if not ctc_text:
        return None
    match = _CTC_NUMBER_RE.search(ctc_text)
    return float(match.group(1)) if match else None


def classify_ctc_tiers(ctc_values: list) -> dict:
    """Real offer-tier classification by real CTC value — Regular < 6 LPA,
    Dream 6-10 LPA, Super Dream > 10 LPA. Only computed over values that
    were actually parseable; `classifiable_count` records how many of the
    given values that was."""
    regular = sum(1 for v in ctc_values if v < REGULAR_MAX_LPA)
    dream = sum(1 for v in ctc_values if REGULAR_MAX_LPA <= v <= DREAM_MAX_LPA)
    super_dream = sum(1 for v in ctc_values if v > DREAM_MAX_LPA)
    return {
        "regular": regular, "dream": dream, "super_dream": super_dream,
        "classifiable_count": len(ctc_values),
        "note": f"Regular < {REGULAR_MAX_LPA} LPA, Dream {REGULAR_MAX_LPA}-{DREAM_MAX_LPA} LPA, Super Dream > {DREAM_MAX_LPA} LPA — only computed for records with a real parsed CTC value.",
    }
