"""Reads a report format (.docx) and writes a student's report into it.

The uploaded template is the base document. Its page setup, section breaks,
headers, footers, cover, certificate and declaration pages stay as they are.
Only two things change: the fill-in fields (title, names, ...) and the sample
content of the abstract, acknowledgement, contents lists, chapters and
references, which is replaced with the student's content written in copies of
the template's own paragraphs. No formatting is invented: every new paragraph
is a clone of one the template already contains."""
import copy
import io
import re
from typing import Optional

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from app.core import project_fields as pf

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
P, TBL, R, T, PPR, RPR, SECT = (qn(f"w:{n}") for n in ("p", "tbl", "r", "t", "pPr", "rPr", "sectPr"))

ZONE_WORDS = {
    "ABSTRACT": "abstract", "ACKNOWLEDGEMENT": "acknowledgement", "ACKNOWLEDGEMENTS": "acknowledgement",
    "ACKNOWLEDGMENT": "acknowledgement", "ACKNOWLEDGMENTS": "acknowledgement", "CERTIFICATE": "certificate",
    "DECLARATION": "declaration", "CONTENTS": "contents", "TABLE OF CONTENTS": "contents", "LIST OF FIGURES": "figures",
    "LIST OF TABLES": "tables", "REFERENCES": "references", "REFERENCE": "references", "BIBLIOGRAPHY": "references",
    "APPENDIX": "appendix", "APPENDICES": "appendix",
}
ZONE_LABELS = {"front": "Cover page", "certificate": "Certificate", "declaration": "Declaration", "acknowledgement": "Acknowledgement",
               "abstract": "Abstract", "contents": "Table of contents", "figures": "List of figures", "tables": "List of tables",
               "chapter": "Chapters", "references": "References", "appendix": "Appendix"}
LIST_ZONES = ("contents", "figures", "tables")
CHAPTER_RE = re.compile(r"^\s*chapter\s*[-–:.]?\s*(\d+|[ivxlc]+)\b\s*[-–:.]?\s*(.*)$", re.IGNORECASE)
CAPTION_RE = re.compile(r"^\s*(fig(?:ure)?\.?|table)\s*[-:.]?\s*(\d+)\s*([.\-:])\s*(\d+)\s*([:.\-–]?)\s*", re.IGNORECASE)
REF_NUMBER_RE = re.compile(r"^\s*\[?\d+[\].)]\s*")       # a number the student already typed in front of a reference
SECTION_RE = re.compile(r"^\s*(\d+)\.(\d+)(\.(\d+))?\.?\s+\S")
MAX_IMAGE_SHARE = 0.42          # of the page height
ROMAN = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]


# ------------------------------------------------------------------ small xml helpers

def text_of(el) -> str:
    return "".join(t.text or "" for t in el.iter(T))


def _style_name(doc, el) -> str:
    ppr = el.find(PPR)
    style = ppr.find(qn("w:pStyle")) if ppr is not None else None
    if style is None:
        return "Normal"
    try:
        return doc.styles.element.xpath(f'w:style[@w:styleId="{style.get(qn("w:val"))}"]/w:name/@w:val')[0]
    except IndexError:
        return style.get(qn("w:val")) or "Normal"


def _ends_page(el) -> bool:
    """True when the next block starts on a new page because of this one."""
    if el.tag != P:
        return False
    ppr = el.find(PPR)
    if ppr is not None and ppr.find(SECT) is not None:
        return True
    return any(br.get(qn("w:type")) == "page" for br in el.iter(qn("w:br")))


def _starts_page(el) -> bool:
    ppr = el.find(PPR) if el.tag == P else None
    return ppr is not None and ppr.find(qn("w:pageBreakBefore")) is not None


def _has_sect(el) -> bool:
    ppr = el.find(PPR) if el.tag == P else None
    return ppr is not None and ppr.find(SECT) is not None


def _has_drawing(el) -> bool:
    return any(True for _ in el.iter(qn("w:drawing"))) or any(True for _ in el.iter(qn("w:pict")))


def _is_list(el) -> bool:
    ppr = el.find(PPR)
    return ppr is not None and ppr.find(qn("w:numPr")) is not None


def roman(n: int, upper: bool = False) -> str:
    out = ""
    for value, sym in ROMAN:
        while n >= value:
            out, n = out + sym, n - value
    return out.upper() if upper else out


def _roman_value(s: str) -> int:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}
    total, prev = 0, 0
    for ch in reversed(s.lower()):
        v = vals.get(ch, 0)
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


# ------------------------------------------------------------------ zones

def zone_kind(doc, el, in_list_zone: bool, after_break: bool) -> Optional[tuple[str, dict]]:
    """Whether a paragraph is the heading that opens a zone."""
    if el.tag != P:
        return None
    raw = text_of(el).strip()
    if not raw or len(raw) > 90 or "\t" in raw:
        return None
    if in_list_zone and not after_break:
        return None                       # a line inside the contents list, not a heading
    m = CHAPTER_RE.match(raw)
    if m:
        number = int(m.group(1)) if m.group(1).isdigit() else _roman_value(m.group(1))
        return "chapter", {"number": number, "title": m.group(2).strip(), "numeral": m.group(1)}
    word = re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", "", raw.upper())).strip()
    if word in ZONE_WORDS:
        return ZONE_WORDS[word], {}
    return None


def scan(doc) -> list[dict]:
    """The template cut into zones: everything before the first recognised
    heading is the front (cover), then one zone per heading."""
    zones = [{"kind": "front", "heading": None, "items": [], "info": {}}]
    after_break = True
    for el in doc.element.body.iterchildren():
        if el.tag not in (P, TBL):
            continue
        current = zones[-1]
        kind = zone_kind(doc, el, current["kind"] in LIST_ZONES, after_break or _starts_page(el))
        if kind:
            zones.append({"kind": kind[0], "heading": el, "items": [], "info": kind[1]})
        else:
            current["items"].append(el)
        after_break = _ends_page(el)
    _heading1_chapters(doc, zones)
    return zones


def _heading1_chapters(doc, zones: list[dict]) -> None:
    """Formats that mark chapters only with the Heading 1 style ("1. INTRODUCTION")
    rather than the word CHAPTER: split those out as chapter zones."""
    if any(z["kind"] == "chapter" for z in zones):
        return
    out = []
    for zone in zones:
        if zone["kind"] in ("front", "certificate", "declaration", "references", "appendix"):
            out.append(zone)
            continue
        # inside a contents list, a Heading 1 only counts once the list's page has ended
        open_for_headings = zone["kind"] not in LIST_ZONES
        pieces, number = [dict(zone, items=[])], len([z for z in out if z["kind"] == "chapter"])
        for el in zone["items"]:
            name = _style_name(doc, el).lower() if el.tag == P else ""
            raw = text_of(el).strip() if el.tag == P else ""
            if open_for_headings and name == "heading 1" and raw and len(raw) <= 90:
                m = re.match(r"^(\d+)[.)]?\s+(.*)$", raw)
                number = int(m.group(1)) if m else number + 1
                pieces.append({"kind": "chapter", "heading": el, "items": [],
                               "info": {"number": number, "title": (m.group(2) if m else raw).strip(), "numeral": str(number), "single": True}})
            else:
                pieces[-1]["items"].append(el)
            open_for_headings = open_for_headings or _ends_page(el)
        out.extend(pieces)
    zones[:] = out


# ------------------------------------------------------------------ formatting read-out

def _resolved(doc, el) -> dict:
    """Font, size and paragraph settings a paragraph ends up with, following
    its runs, its style and the styles that one is based on."""
    para = Paragraph(el, None)
    out = {"font": None, "size": None, "bold": None, "italic": None, "align": None, "line_spacing": None}
    for run in para.runs:
        if not run.text.strip():
            continue
        out["font"] = out["font"] or run.font.name
        out["size"] = out["size"] or (run.font.size.pt if run.font.size else None)
        out["bold"] = run.font.bold if out["bold"] is None else out["bold"]
        out["italic"] = run.font.italic if out["italic"] is None else out["italic"]
        break
    fmt = para.paragraph_format
    out["align"] = fmt.alignment
    out["line_spacing"] = fmt.line_spacing
    style_id = None
    ppr = el.find(PPR)
    if ppr is not None and ppr.find(qn("w:pStyle")) is not None:
        style_id = ppr.find(qn("w:pStyle")).get(qn("w:val"))
    style = next((s for s in doc.styles if s.style_id == style_id), None) if style_id else None
    if style is None:
        try:
            style = doc.styles["Normal"]
        except KeyError:
            style = None
    hops = 0
    while style is not None and hops < 8:
        font = getattr(style, "font", None)
        if font is not None:
            out["font"] = out["font"] or font.name
            out["size"] = out["size"] or (font.size.pt if font.size else None)
            out["bold"] = font.bold if out["bold"] is None else out["bold"]
            out["italic"] = font.italic if out["italic"] is None else out["italic"]
        sfmt = getattr(style, "paragraph_format", None)
        if sfmt is not None:
            out["align"] = sfmt.alignment if out["align"] is None else out["align"]
            out["line_spacing"] = out["line_spacing"] or sfmt.line_spacing
        style, hops = getattr(style, "base_style", None), hops + 1
    defaults = doc.styles.element.find(qn("w:docDefaults"))
    if defaults is not None:
        fonts = next(iter(defaults.iter(qn("w:rFonts"))), None)
        size = next(iter(defaults.iter(qn("w:sz"))), None)
        if fonts is not None:
            out["font"] = out["font"] or fonts.get(qn("w:ascii"))
        if size is not None:
            out["size"] = out["size"] or int(size.get(qn("w:val"))) / 2
    align = {WD_ALIGN_PARAGRAPH.CENTER: "centre", WD_ALIGN_PARAGRAPH.RIGHT: "right", WD_ALIGN_PARAGRAPH.JUSTIFY: "justified"}.get(out["align"], "left")
    spacing = out["line_spacing"]
    if spacing is not None and not isinstance(spacing, (int, float)):
        spacing = f"{spacing.pt:g} pt"
    return {"font": out["font"] or "the document default", "size": out["size"], "bold": bool(out["bold"]), "italic": bool(out["italic"]),
            "align": align, "line_spacing": spacing or 1.0}


def _hf_texts(doc) -> tuple[list[str], list[str]]:
    headers, footers = [], []
    for section in doc.sections:
        for part, bucket in ((section.header, headers), (section.footer, footers), (section.first_page_header, headers), (section.first_page_footer, footers)):
            try:
                text = " | ".join(t for t in (text_of(p._p).strip() for p in part.paragraphs) if t)
                has_page = any("PAGE" in (i.text or "") for p in part.paragraphs for i in p._p.iter(qn("w:instrText"))) or any(
                    "PAGE" in (f.get(qn("w:instr")) or "") for p in part.paragraphs for f in p._p.iter(qn("w:fldSimple")))
            except Exception:
                continue
            label = (text + (" [page number]" if has_page else "")).strip()
            if label and label not in bucket:
                bucket.append(label)
    return headers, footers


def _numbering(doc) -> list[dict]:
    out = []
    for i, section in enumerate(doc.sections):
        pg = section._sectPr.find(qn("w:pgNumType"))
        fmt = pg.get(qn("w:fmt")) if pg is not None else None
        start = pg.get(qn("w:start")) if pg is not None else None
        out.append({"section": i + 1, "format": fmt or "decimal", "start": int(start) if start else None})
    return out


def exemplars(doc, zones: list[dict]) -> dict:
    """The template's own paragraphs to copy for each kind of content."""
    ex: dict = {"chapter_number": None, "chapter_title": None, "section": None, "subsection": None, "body": None, "bullet": None,
                "figure_caption": None, "table_caption": None, "table": None, "reference": None, "toc": None, "toc_table": None,
                "abstract": None, "acknowledgement": None, "fig_word": "Fig", "fig_sep": ".", "fig_tail": "", "table_word": "Table", "table_tail": "",
                "caption_above_table": True, "chapter_single": False, "chapter_numeral": "arabic"}
    chapters = [z for z in zones if z["kind"] == "chapter"]
    if chapters:
        first = chapters[0]
        info = first["info"]
        ex["chapter_single"] = bool(info.get("single") or info.get("title"))
        ex["chapter_numeral"] = "arabic" if str(info.get("numeral", "1")).isdigit() else ("ROMAN" if str(info["numeral"]).isupper() else "roman")
        ex["chapter_number"] = first["heading"]
        items = [e for z in chapters for e in z["items"]]
        if not ex["chapter_single"]:
            title = next((e for e in first["items"] if e.tag == P and text_of(e).strip()), None)
            ex["chapter_title"] = title
            items = [e for e in items if e is not title]
        bodies = []
        for i, el in enumerate(items):
            if el.tag == TBL:
                ex["table"] = ex["table"] or el
                continue
            raw = text_of(el).strip()
            if not raw:
                continue
            cap = CAPTION_RE.match(raw)
            name = _style_name(doc, el).lower()
            if cap:
                if cap.group(1).lower().startswith("fig"):
                    if ex["figure_caption"] is None:
                        ex.update(figure_caption=el, fig_word=cap.group(1), fig_sep=cap.group(3), fig_tail=cap.group(5))
                elif ex["table_caption"] is None:
                    nxt = next((e for e in items[i + 1:] if e.tag == TBL or text_of(e).strip()), None)
                    ex.update(table_caption=el, table_word=cap.group(1), table_tail=cap.group(5), caption_above_table=nxt is not None and nxt.tag == TBL)
            elif name == "heading 3" or (SECTION_RE.match(raw) and SECTION_RE.match(raw).group(3)):
                ex["subsection"] = ex["subsection"] or el
            elif name == "heading 2" or (SECTION_RE.match(raw) and len(raw) < 90):
                ex["section"] = ex["section"] or el
            elif _is_list(el) or name.startswith("list"):
                ex["bullet"] = ex["bullet"] or el
            elif not _has_drawing(el):
                bodies.append(el)
        ex["body"] = max(bodies, key=lambda e: len(text_of(e)), default=None)
    for zone in zones:
        texts = [e for e in zone["items"] if e.tag == P and text_of(e).strip() and not _has_sect(e)]
        if zone["kind"] in ("abstract", "acknowledgement") and texts:
            ex[zone["kind"]] = max(texts, key=lambda e: len(text_of(e)))
        elif zone["kind"] == "references" and texts:
            ex["reference"] = texts[0]
        elif zone["kind"] == "contents":
            ex["toc"] = texts[0] if texts else None
            ex["toc_table"] = next((e for e in zone["items"] if e.tag == TBL), None)
    ex["body"] = ex["body"] if ex["body"] is not None else (ex["abstract"] if ex["abstract"] is not None else ex["acknowledgement"])
    return ex


def analyse(data: bytes) -> dict:
    """Everything worth knowing about a report format, in plain values."""
    try:
        doc = Document(io.BytesIO(data))
    except Exception as exc:
        raise ValueError("This file could not be opened as a Word document. Save it again as .docx and upload that.") from exc
    zones = scan(doc)
    ex = exemplars(doc, zones)
    first = doc.sections[0]
    inch = lambda v: round(v.inches, 2) if v is not None else None  # noqa: E731
    headers, footers = _hf_texts(doc)
    front_texts = [text_of(e) for z in zones if z["kind"] in ("front", "certificate", "declaration") for e in ([z["heading"]] if z["heading"] is not None else []) + z["items"]]
    for z in zones:
        if z["kind"] in ("front", "certificate", "declaration"):
            for el in z["items"]:
                if el.tag == TBL:
                    front_texts.extend(text_of(c) for c in el.iter(P))
    for section in doc.sections:
        for part in (section.header, section.footer, section.first_page_header, section.first_page_footer):
            try:
                front_texts.extend(text_of(p._p) for p in part.paragraphs)
            except Exception:
                pass
    fmt = lambda key: _resolved(doc, ex[key]) if ex.get(key) is not None else None  # noqa: E731
    chapters = [z for z in zones if z["kind"] == "chapter"]
    chapter_titles = []
    for z in chapters:
        title = z["info"].get("title") or next((text_of(e).strip() for e in z["items"] if e.tag == P and text_of(e).strip()), "")
        chapter_titles.append(title.title() if title.isupper() else title)
    kinds = [z["kind"] for z in zones]
    warnings = []
    if not chapters:
        warnings.append("No chapter was found (looked for \"CHAPTER 1\" or Heading 1). Chapters will be added at the end using the document's heading styles.")
    if ex["body"] is None:
        warnings.append("No sample body paragraph was found, so body text will use the Normal style.")
    if "contents" not in kinds:
        warnings.append("There is no table of contents page in this format, so none will be produced.")
    numbering = _numbering(doc)
    if len(numbering) == 1 and chapters:
        warnings.append("The whole document is one section, so the front pages and the chapters share one page-number sequence.")
    return {
        "kind": "report",
        "page": {"width_in": inch(first.page_width), "height_in": inch(first.page_height),
                 "margins_in": {"top": inch(first.top_margin), "bottom": inch(first.bottom_margin), "left": inch(first.left_margin), "right": inch(first.right_margin)}},
        "sections": numbering,
        "headers": headers, "footers": footers,
        "parts": [ZONE_LABELS[k] for k in dict.fromkeys(kinds)],
        "chapter_titles": chapter_titles,
        "styles": {"chapter heading": fmt("chapter_title") or fmt("chapter_number"), "section heading": fmt("section"), "sub-section heading": fmt("subsection"),
                   "body text": fmt("body"), "figure caption": fmt("figure_caption"), "table caption": fmt("table_caption"), "reference": fmt("reference")},
        "captions": {"figure": f"{ex['fig_word']} 4{ex['fig_sep']}1{ex['fig_tail']}", "table": f"{ex['table_word']} 4{ex['fig_sep']}1{ex['table_tail']}",
                     "table_caption_position": "above the table" if ex["caption_above_table"] else "below the table"},
        "field_map": pf.guess_map(front_texts),
        "warnings": warnings,
    }


# ------------------------------------------------------------------ writing

def _clone(el, text: str, bold_marks: bool = True):
    """A copy of a template paragraph carrying new text. The paragraph
    settings and the first run's character formatting are kept; `**bold**`
    marks become bold runs."""
    new = copy.deepcopy(el)
    ppr = new.find(PPR)
    if ppr is not None:
        for tag in (SECT, qn("w:pageBreakBefore")):
            for child in ppr.findall(tag):
                ppr.remove(child)
    base_rpr = None
    for run in new.iter(R):
        if run.find(RPR) is not None and text_of(run).strip():
            base_rpr = copy.deepcopy(run.find(RPR))
            break
    for child in list(new):
        if child.tag != PPR:
            new.remove(child)
    parts = re.split(r"(\*\*[^*]+\*\*)", text) if bold_marks else [text]
    for part in parts:
        if not part:
            continue
        bold = bold_marks and part.startswith("**") and part.endswith("**") and len(part) > 4
        _add_run(new, part[2:-2] if bold else part, base_rpr, bold)
    return new


def _add_run(p_el, text: str, rpr=None, bold: bool = False, tiny: bool = False):
    run = OxmlElement("w:r")
    props = copy.deepcopy(rpr) if rpr is not None else OxmlElement("w:rPr")
    if bold and props.find(qn("w:b")) is None:
        props.append(OxmlElement("w:b"))
    if tiny:                                  # an invisible marker used to find the page a heading lands on
        for tag in ("w:sz", "w:szCs", "w:color"):
            for child in props.findall(qn(tag)):
                props.remove(child)
        for tag, val in (("w:color", "FFFFFF"), ("w:sz", "2"), ("w:szCs", "2")):
            node = OxmlElement(tag)
            node.set(qn("w:val"), val)
            props.append(node)
    if len(props):
        run.append(props)
    for i, piece in enumerate(text.split("\t")):
        if i:
            run.append(OxmlElement("w:tab"))
        node = OxmlElement("w:t")
        node.text = piece
        node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        run.append(node)
    p_el.append(run)
    return run


def _page_break_before(p_el) -> None:
    ppr = p_el.find(PPR)
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        p_el.insert(0, ppr)
    if ppr.find(qn("w:pageBreakBefore")) is None:
        node = OxmlElement("w:pageBreakBefore")
        style = ppr.find(qn("w:pStyle"))
        ppr.insert(1 if style is not None else 0, node)


def _replace_in_paragraph(p_el, old: str, new: str) -> int:
    """Replaces `old` wherever it appears in a paragraph, even when Word has
    split it across several runs. Formatting of the first run involved is kept."""
    count = 0
    while True:
        nodes = [t for t in p_el.iter(T)]
        full = "".join(t.text or "" for t in nodes)
        at = full.find(old)
        if at < 0 or count > 20:
            return count
        end, pos, first = at + len(old), 0, True
        for node in nodes:
            text = node.text or ""
            start, stop = pos, pos + len(text)
            pos = stop
            if stop <= at or start >= end:
                continue
            keep_before = text[: max(0, at - start)]
            keep_after = text[max(0, end - start):] if stop > end else ""
            node.text = keep_before + (new if first else "") + keep_after
            node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            first = False
        count += 1
        if old in new:
            return count


def _all_paragraphs(doc):
    """Every paragraph that can carry a field: body, tables, text boxes, headers and footers."""
    for el in doc.element.body.iter(P):
        yield el
    seen = set()
    for section in doc.sections:
        for part in (section.header, section.footer, section.first_page_header, section.first_page_footer, section.even_page_header, section.even_page_footer):
            try:
                root = part._element
            except Exception:
                continue
            if id(root) in seen:
                continue
            seen.add(id(root))
            for el in root.iter(P):
                yield el


def fill_fields(doc, field_map: list[dict], vals: dict) -> list[str]:
    """Writes the project's details over the template's field wording.
    Returns the fields the template asks for that the project has no value for."""
    unfilled: list[str] = []
    for entry in field_map:
        match, field = entry["match"], entry["field"]
        repeats = pf.FIELDS[field][1]
        for el in list(_all_paragraphs(doc)):
            full = text_of(el)
            if match not in full:
                continue
            alone = full.strip() == match.strip()
            row = el.getparent().getparent() if el.getparent() is not None and el.getparent().tag == qn("w:tc") else None
            if repeats and vals["students"] and (alone or (row is not None and _row_is_student_row(row, field_map))):
                if row is not None and _row_is_student_row(row, field_map):
                    _repeat_row(row, field_map, vals)
                    continue
                # a line of its own: one copy of the line per student
                parent, anchor, pattern = el.getparent(), el, copy.deepcopy(el)
                for i, student in enumerate(vals["students"]):
                    target = el if i == 0 else copy.deepcopy(pattern)
                    if i:
                        parent.insert(parent.index(anchor) + 1, target)
                        anchor = target
                    _replace_in_paragraph(target, match, pf._like(match, pf.student_text(field, student)))
                continue
            value = pf.inline_value(field, match, vals)
            if value is None:
                label = pf.FIELDS[field][0]
                if label not in unfilled:
                    unfilled.append(label)
                continue
            _replace_in_paragraph(el, match, value)
    return unfilled


def _row_is_student_row(row, field_map: list[dict]) -> bool:
    """A table row holding two or more per-student fields (name in one cell, USN in the next)."""
    text = text_of(row)
    return sum(1 for e in field_map if pf.FIELDS[e["field"]][1] and e["match"] in text) >= 2


def _repeat_row(row, field_map: list[dict], vals: dict) -> None:
    parent, anchor, pattern = row.getparent(), row, copy.deepcopy(row)
    for i, student in enumerate(vals["students"]):
        target = row if i == 0 else copy.deepcopy(pattern)
        if i:
            parent.insert(parent.index(anchor) + 1, target)
            anchor = target
        for entry in field_map:
            if pf.FIELDS[entry["field"]][1]:
                for el in target.iter(P):
                    _replace_in_paragraph(el, entry["match"], pf._like(entry["match"], pf.student_text(entry["field"], student)))


class Writer:
    """Builds the new content of a zone as copies of template paragraphs."""

    def __init__(self, doc, ex: dict, images: dict, markers: bool):
        self.doc, self.ex, self.images, self.markers = doc, ex, images, markers
        self.anchors: list[dict] = []          # {key, token} for the page finder
        self.toc: list[dict] = []              # {level, text, key}
        self.figures: list[dict] = []
        self.tables: list[dict] = []
        self.dropped: list[str] = []
        section = doc.sections[-1]
        self.text_width = section.page_width - section.left_margin - section.right_margin
        self.max_image_height = int(section.page_height * MAX_IMAGE_SHARE)

    # -- pieces
    def _base(self, key: str):
        el = self.ex.get(key)
        return el if el is not None else self.ex.get("body")

    def para(self, key: str, text: str, mark: Optional[str] = None, fallback_style: str = "Normal", bold_marks: bool = True):
        base = self._base(key)
        if base is not None:
            el = _clone(base, text, bold_marks)
        else:
            el = self.doc.add_paragraph(text, style=fallback_style)._p
            el.getparent().remove(el)
        if mark:
            token = f"qz{len(self.anchors):03d}zq"
            self.anchors.append({"key": mark, "token": token})
            if self.markers:
                _add_run(el, token, tiny=True)
        return el

    def chapter_heading(self, number: int, title: str, first: bool) -> list:
        ex, out = self.ex, []
        numeral = str(number) if ex["chapter_numeral"] == "arabic" else roman(number, ex["chapter_numeral"] == "ROMAN")
        sample = text_of(ex["chapter_number"]) if ex["chapter_number"] is not None else ""
        shown = title.upper() if (text_of(ex["chapter_title"]) if ex["chapter_title"] is not None else sample).isupper() else title
        key = f"chapter:{number}"
        if ex["chapter_number"] is None:
            head = self.para("chapter_number", f"{number}. {shown}", mark=key, fallback_style="Heading 1", bold_marks=False)
            out.append(head)
        elif ex["chapter_single"]:
            m = CHAPTER_RE.match(sample)
            plain = re.match(r"^(\s*)(\d+)([.)]?\s*)(.*)$", sample)
            if m and m.group(2):                      # "CHAPTER 1: INTRODUCTION"
                old_title = m.group(2)
                text = sample[: m.start(1)] + numeral + sample[m.end(1): m.start(2)] + (title.upper() if old_title.isupper() else title)
            elif plain:                               # "1. INTRODUCTION"
                text = f"{plain.group(1)}{number}{plain.group(3)}{title.upper() if plain.group(4).isupper() else title}"
            else:
                text = title.upper() if sample.isupper() else title
            out.append(self.para("chapter_number", text, mark=key, bold_marks=False))
        else:
            m = CHAPTER_RE.match(sample)
            label = sample[: m.start(1)] + numeral + sample[m.end(1):] if m else f"CHAPTER {numeral}"
            out.append(self.para("chapter_number", label.rstrip(), mark=key, bold_marks=False))
            out.append(self.para("chapter_title", shown, bold_marks=False))
        if not first:
            _page_break_before(out[0])
        _outline(out[-1] if not ex["chapter_single"] and len(out) > 1 else out[0], 0)
        with_word = ex["chapter_number"] is not None and CHAPTER_RE.match(sample)
        self.toc.append({"level": 1, "text": f"Chapter {number}: {title}" if with_word else f"{number}. {title}", "key": key, "number": str(number), "title": title})
        return out

    def figure(self, chapter: int, block: dict) -> list:
        data = self.images.get(block.get("image_id"))
        if not data:
            self.dropped.append(block.get("caption") or "a figure")
            return []
        n = sum(1 for f in self.figures if f["chapter"] == chapter) + 1
        label = f"{self.ex['fig_word']} {chapter}{self.ex['fig_sep']}{n}"
        key = f"figure:{chapter}.{n}"
        holder = self.para("figure_caption", "", bold_marks=False)
        _centre(holder)
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as im:
                w, h = im.size
            width = min(int(self.text_width * 0.9), int(self.max_image_height * w / max(h, 1)))
            run = Run(OxmlElement("w:r"), None)
            holder.append(run._r)
            run._r.add_drawing(self.doc.part.new_pic_inline(io.BytesIO(data), Emu(width), Emu(int(width * h / max(w, 1)))))
        except Exception:
            self.dropped.append(block.get("caption") or label)
            return []
        _keep_with_next(holder)
        caption_text = f"{label}{self.ex['fig_tail'] or ':'} {block.get('caption') or ''}".rstrip()
        caption = self.para("figure_caption", caption_text, mark=key, bold_marks=False)
        if self.ex.get("figure_caption") is None:
            _centre(caption)
        self.figures.append({"chapter": chapter, "label": label, "caption": block.get("caption") or "", "key": key})
        return [holder, caption]

    def table(self, chapter: int, block: dict) -> list:
        rows = [[str(c) for c in row] for row in (block.get("rows") or []) if row]
        if not rows:
            return []
        n = sum(1 for t in self.tables if t["chapter"] == chapter) + 1
        label = f"{self.ex['table_word']} {chapter}{self.ex['fig_sep']}{n}"
        key = f"table:{chapter}.{n}"
        columns = max(len(r) for r in rows)
        table = self.doc.add_table(rows=len(rows), cols=columns)
        tbl = table._tbl
        tbl.getparent().remove(tbl)
        sample = self.ex.get("table")
        if sample is not None and sample.find(qn("w:tblPr")) is not None:
            tbl.replace(tbl.find(qn("w:tblPr")), copy.deepcopy(sample.find(qn("w:tblPr"))))
        else:
            try:
                table.style = "Table Grid"
            except Exception:
                pass
        cell_base = next((p for p in sample.iter(P) if text_of(p).strip()), None) if sample is not None else None
        for r, row in enumerate(rows):
            for c in range(columns):
                cell = table.cell(r, c)
                value = row[c] if c < len(row) else ""
                first = cell.paragraphs[0]._p
                if cell_base is not None or self.ex.get("body") is not None:
                    new = _clone(cell_base if cell_base is not None else self.ex["body"], value, bold_marks=False)
                    if cell_base is None:
                        _plain_cell(new)
                    cell._tc.replace(first, new)
                else:
                    cell.text = value
                if r == 0:
                    for run in cell._tc.iter(R):
                        props = run.find(RPR)
                        if props is None:
                            props = OxmlElement("w:rPr")
                            run.insert(0, props)
                        if props.find(qn("w:b")) is None:
                            props.append(OxmlElement("w:b"))
        caption_text = f"{label}{self.ex['table_tail'] or ':'} {block.get('caption') or ''}".rstrip()
        caption = self.para("table_caption" if self.ex.get("table_caption") is not None else "figure_caption", caption_text, mark=key, bold_marks=False)
        if self.ex.get("table_caption") is None and self.ex.get("figure_caption") is None:
            _centre(caption)
        self.tables.append({"chapter": chapter, "label": label, "caption": block.get("caption") or "", "key": key})
        spacer = self.para("body", "", bold_marks=False)
        if self.ex["caption_above_table"]:
            _keep_with_next(caption)
            return [caption, tbl, spacer]
        return [tbl, caption, spacer]

    def blocks(self, chapter: int, blocks: list[dict]) -> list:
        out, sec, sub = [], 0, 0
        for block in blocks or []:
            kind = block.get("type")
            if kind == "heading":
                level = 3 if block.get("level", 2) >= 3 else 2
                if level == 2:
                    sec, sub = sec + 1, 0
                    number = f"{chapter}.{sec}"
                else:
                    sub += 1
                    number = f"{chapter}.{max(sec, 1)}.{sub}"
                text = re.sub(r"^\s*\d+(\.\d+)*\.?\s+", "", block.get("text") or "").strip()
                key = f"heading:{number}"
                el = self.para("section" if level == 2 else ("subsection" if self.ex.get("subsection") is not None else "section"),
                               f"{number} {text}", mark=key, fallback_style=f"Heading {level}", bold_marks=False)
                if self.ex.get("section") is None:
                    _bold_all(el)
                _outline(el, level - 1)
                _keep_with_next(el)
                out.append(el)
                self.toc.append({"level": level, "text": f"{number} {text}", "key": key, "number": number, "title": text})
            elif kind == "para" and (block.get("text") or "").strip():
                out.append(self.para("body", block["text"].strip()))
            elif kind == "bullets":
                for item in block.get("items") or []:
                    if not str(item).strip():
                        continue
                    if self.ex.get("bullet") is not None:
                        out.append(self.para("bullet", str(item).strip()))
                    else:
                        out.append(self.para("body", "•\t" + str(item).strip()))
            elif kind == "figure":
                out.extend(self.figure(chapter, block))
            elif kind == "table":
                out.extend(self.table(chapter, block))
        return out


def _outline(el, level: int) -> None:
    ppr = el.find(PPR)
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        el.insert(0, ppr)
    for old in ppr.findall(qn("w:outlineLvl")):
        ppr.remove(old)
    node = OxmlElement("w:outlineLvl")
    node.set(qn("w:val"), str(level))
    # schema order: outlineLvl sits after jc/textAlignment and before rPr/sectPr
    tail = [c for c in ppr if c.tag in (RPR, SECT, qn("w:pPrChange"))]
    if tail:
        tail[0].addprevious(node)
    else:
        ppr.append(node)


def _keep_with_next(el) -> None:
    ppr = el.find(PPR)
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        el.insert(0, ppr)
    if ppr.find(qn("w:keepNext")) is None:
        style = ppr.find(qn("w:pStyle"))
        ppr.insert(1 if style is not None else 0, OxmlElement("w:keepNext"))


def _centre(el) -> None:
    ppr = el.find(PPR)
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        el.insert(0, ppr)
    for old in ppr.findall(qn("w:jc")) + ppr.findall(qn("w:ind")):
        ppr.remove(old)
    node = OxmlElement("w:jc")
    node.set(qn("w:val"), "center")
    tail = [c for c in ppr if c.tag in (qn("w:outlineLvl"), RPR, SECT)]
    if tail:
        tail[0].addprevious(node)
    else:
        ppr.append(node)


def _plain_cell(el) -> None:
    """Body text copied into a table cell loses its first-line indent and extra spacing."""
    ppr = el.find(PPR)
    if ppr is not None:
        for tag in ("w:ind", "w:spacing"):
            for old in ppr.findall(qn(tag)):
                ppr.remove(old)


def _bold_all(el) -> None:
    for run in el.iter(R):
        props = run.find(RPR)
        if props is None:
            props = OxmlElement("w:rPr")
            run.insert(0, props)
        if props.find(qn("w:b")) is None:
            props.append(OxmlElement("w:b"))


def _is_page_break(el) -> bool:
    return el.tag == P and any(br.get(qn("w:type")) == "page" for br in el.iter(qn("w:br")))


def _strip_text(el) -> None:
    """Empties a paragraph of its words but keeps what it does to the layout
    (a page break, the end of a section)."""
    for run in list(el.iter(R)):
        if any(br.get(qn("w:type")) == "page" for br in run.iter(qn("w:br"))):
            for child in list(run):
                if child.tag in (T, qn("w:tab")):
                    run.remove(child)
        elif run.getparent() is not None:
            run.getparent().remove(run)


def _empty_zone(zone: dict, keep_breaks: bool = True) -> Optional[object]:
    """Removes a zone's sample content. Paragraphs that end a section or a
    page are kept (emptied of words), because the page numbering and the
    "next part starts on a new page" rule live in them.
    Returns the element new content should be inserted before, or None for
    "straight after the heading"."""
    stop = None
    for el in zone["items"]:
        if _has_sect(el) or (keep_breaks and _is_page_break(el)):
            _strip_text(el)
            stop = stop if stop is not None else el
        elif el.getparent() is not None:
            el.getparent().remove(el)
    return stop


def _insert(zone: dict, new: list, stop) -> None:
    if not new:
        return
    if stop is not None:
        for el in new:
            stop.addprevious(el)
        return
    anchor = zone["heading"]
    for el in new:
        anchor.addnext(el)
        anchor = el


def _toc_line(writer: Writer, base, text: str, page: str, level: int):
    el = _clone(base, f"{text}\t{page}", bold_marks=False)
    ppr = el.find(PPR)
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        el.insert(0, ppr)
    if ppr.find(qn("w:tabs")) is None:           # the sample had no leader tab: add the usual dotted one at the right margin
        tabs, tab = OxmlElement("w:tabs"), OxmlElement("w:tab")
        tab.set(qn("w:val"), "right")
        tab.set(qn("w:leader"), "dot")
        tab.set(qn("w:pos"), str(int(Emu(writer.text_width).twips)))
        tabs.append(tab)
        style = ppr.find(qn("w:pStyle"))
        ppr.insert(1 if style is not None else 0, tabs)
        if level > 1:
            for old in ppr.findall(qn("w:ind")):
                ppr.remove(old)
            ind = OxmlElement("w:ind")
            ind.set(qn("w:left"), str(360 * (level - 1)))
            tabs.addnext(ind)
    for old in ppr.findall(qn("w:outlineLvl")):
        ppr.remove(old)
    return el


def _toc_rows(table_el, entries: list[tuple[str, str, str]]) -> None:
    """A contents page laid out as a table: the first row is kept as the heading
    row, the next one is the pattern for every entry (number | title | page)."""
    rows = table_el.findall(qn("w:tr"))
    if len(rows) < 2:
        return
    pattern = copy.deepcopy(rows[1])
    for row in rows[1:]:
        table_el.remove(row)
    for number, title, page in entries:
        row = copy.deepcopy(pattern)
        cells = row.findall(qn("w:tc"))
        values = [number, title, page] if len(cells) >= 3 else [f"{number} {title}".strip(), page]
        for cell, value in zip(cells, values + [""] * len(cells)):
            paras = cell.findall(P)
            if paras:
                cell.replace(paras[0], _clone(paras[0], value, bold_marks=False))
                for extra in paras[1:]:
                    cell.remove(extra)
        table_el.append(row)


def build(template: bytes, field_map: list[dict], details: dict, content: dict, images: dict, pages: Optional[dict] = None, markers: bool = False) -> dict:
    """The finished report as .docx bytes, plus what was written.

    `pages` maps anchor keys to page labels once they are known (second pass);
    without it the contents lists carry no page numbers. `markers` adds the
    invisible tokens the page finder looks for (first pass only)."""
    doc = Document(io.BytesIO(template))
    zones = scan(doc)
    ex = exemplars(doc, zones)
    writer = Writer(doc, ex, images, markers)
    pages = pages or {}
    vals = pf.values(details)

    # the first block of every section, so the page finder can tell where each section starts
    section_marks: list = []

    by_kind: dict[str, list[dict]] = {}
    for zone in zones:
        by_kind.setdefault(zone["kind"], []).append(zone)

    # front-matter text zones
    front_entries: list[dict] = []
    for kind, paragraphs in (("acknowledgement", content.get("acknowledgement")), ("abstract", content.get("abstract"))):
        for zone in by_kind.get(kind, [])[:1]:
            key = f"front:{kind}"
            token = f"qf{len(writer.anchors):03d}fq"
            writer.anchors.append({"key": key, "token": token})
            if markers:
                _add_run(zone["heading"], token, tiny=True)
            front_entries.append({"level": 1, "text": ZONE_LABELS[kind], "key": key, "number": "", "title": ZONE_LABELS[kind], "order": zones.index(zone)})
            if paragraphs:
                stop = _empty_zone(zone)
                _insert(zone, [writer.para(kind, str(t).strip()) for t in paragraphs if str(t).strip()], stop)

    # chapters
    chapter_zones = by_kind.get("chapter", [])
    chapters = content.get("chapters") or []
    new_body: list = []
    for i, chapter in enumerate(chapters, start=1):
        new_body.extend(writer.chapter_heading(i, chapter.get("title") or f"Chapter {i}", first=(i == 1)))
        new_body.extend(writer.blocks(i, chapter.get("blocks") or []))
    if chapter_zones:
        first_zone = chapter_zones[0]
        starts_new_page = _starts_page(first_zone["heading"])
        stop = None
        for zone in chapter_zones:
            # each new chapter brings its own page break, so only the break that
            # closes the last sample chapter (before the references) is kept
            stop_here = _empty_zone(zone, keep_breaks=zone is chapter_zones[-1])
            stop = stop if stop is not None else stop_here
            if zone is not first_zone and zone["heading"].getparent() is not None:
                zone["heading"].getparent().remove(zone["heading"])
        anchor = first_zone["heading"]
        for el in new_body:
            anchor.addprevious(el)
        if starts_new_page and new_body:
            _page_break_before(new_body[0])
        anchor.getparent().remove(anchor)
        del stop
    elif new_body:
        body = doc.element.body
        last = body.find(SECT)
        _page_break_before(new_body[0])
        for el in new_body:
            (last.addprevious(el) if last is not None else body.append(el))

    # references
    refs = [str(r).strip() for r in (content.get("references") or []) if str(r).strip()]
    for zone in by_kind.get("references", [])[:1]:
        key = "front:references"
        token = f"qf{len(writer.anchors):03d}fq"
        writer.anchors.append({"key": key, "token": token})
        if markers:
            _add_run(zone["heading"], token, tiny=True)
        writer.toc.append({"level": 1, "text": "References", "key": key, "number": "", "title": "References"})
        stop = _empty_zone(zone)
        numbered = [f"[{n}] {REF_NUMBER_RE.sub('', r)}" for n, r in enumerate(refs, start=1)]
        _insert(zone, [writer.para("reference", line, bold_marks=False) for line in numbered], stop)

    # contents lists (after everything else, so they list what was actually written)
    toc_entries = sorted(front_entries, key=lambda e: e["order"]) + writer.toc
    page = lambda key: str(pages.get(key, "") or "")  # noqa: E731
    for zone in by_kind.get("contents", [])[:1]:
        table_el = ex.get("toc_table")
        if table_el is not None and ex.get("toc") is None:
            _toc_rows(table_el, [(e["number"], e["title"], page(e["key"])) for e in toc_entries if e["level"] <= 2])
        else:
            base = ex.get("toc") if ex.get("toc") is not None else ex.get("body")
            stop = _empty_zone(zone)
            lines = [_toc_line(writer, base, e["text"], page(e["key"]), e["level"]) for e in toc_entries] if base is not None else []
            _insert(zone, lines, stop)
    for kind, rows in (("figures", writer.figures), ("tables", writer.tables)):
        for zone in by_kind.get(kind, [])[:1]:
            texts = [e for e in zone["items"] if e.tag == P and text_of(e).strip() and not _has_sect(e)]
            base = texts[0] if texts else (ex.get("toc") if ex.get("toc") is not None else ex.get("body"))
            stop = _empty_zone(zone)
            lines = [_toc_line(writer, base, f"{r['label']} {r['caption']}".strip(), page(r["key"]), 1) for r in rows] if base is not None else []
            if not rows and base is not None:
                lines = [_clone(base, "None", bold_marks=False)]
            _insert(zone, lines, stop)

    unfilled = fill_fields(doc, field_map, vals)

    # mark where each section begins (first pass only)
    sections_info = _numbering(doc)
    if markers:
        index, need = 0, True
        for el in doc.element.body.iterchildren():
            if el.tag == P and need and text_of(el).strip():
                token = f"qs{index:03d}sq"
                _add_run(el, token, tiny=True)
                section_marks.append({"section": index, "token": token})
                need = False
            if el.tag == P and _has_sect(el):
                index, need = index + 1, True

    out = io.BytesIO()
    doc.save(out)
    return {"docx": out.getvalue(), "anchors": writer.anchors, "sections": sections_info, "section_marks": section_marks,
            "toc": toc_entries, "figures": writer.figures, "tables": writer.tables, "unfilled": unfilled, "dropped": writer.dropped,
            "has_contents": bool(by_kind.get("contents"))}


def leftovers(data: bytes, field_map: list[dict]) -> list[str]:
    """Template wording that should have been replaced but is still in the finished file."""
    doc = Document(io.BytesIO(data))
    found = []
    for el in _all_paragraphs(doc):
        text = text_of(el)
        for entry in field_map:
            if entry["match"] in text and entry["match"] not in found:
                found.append(entry["match"])
        for token in re.findall(r"qz\d{3}zq|qf\d{3}fq|qs\d{3}sq", text):
            if token not in found:
                found.append(token)
    return found
