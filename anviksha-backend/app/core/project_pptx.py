"""Reads a presentation format (.pptx) and writes a student's slides into it.

The uploaded deck is the base. Its master, layouts, header band, logo,
colours and fonts are untouched. The format's own title slide and closing
slide are kept and filled in; its sample content slides are the pattern for
every new slide and are then removed. Text is never shrunk to fit: when a
slide has more than its text box can hold, it continues on a further slide."""
import copy
import io
import math
import re
from typing import Optional

from pptx import Presentation
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.oxml.ns import qn
from pptx.util import Emu

from app.core import project_fields as pf

BODY_TYPES = (PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT)
TITLE_TYPES = (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE)
DEFAULT_BODY_PT = 24.0
MIN_LINES = 4
EMU_PER_PT = 12700
CLOSING_WORDS = ("thank", "queries", "questions", "q & a", "q&a")
R_EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"


def _text(shape) -> str:
    return shape.text_frame.text.strip() if getattr(shape, "has_text_frame", False) and shape.has_text_frame else ""


def _ph_type(shape):
    try:
        return shape.placeholder_format.type if shape.is_placeholder else None
    except Exception:
        return None


def _font_pt(shape) -> Optional[float]:
    """The size of the first sized run in a shape, if the shape sets one itself."""
    if not getattr(shape, "has_text_frame", False) or not shape.has_text_frame:
        return None
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            if run.font.size:
                return run.font.size.pt
    for node in shape._element.iter(qn("a:defRPr")):
        if node.get("sz"):
            return int(node.get("sz")) / 100
    return None


def _inherited_pt(slide, shape, kind: str) -> float:
    """Body or title size from the layout, then the master, when the slide's own shape does not set one."""
    own = _font_pt(shape)
    if own:
        return own
    layout = slide.slide_layout
    wanted = TITLE_TYPES if kind == "title" else BODY_TYPES
    for source in (layout, layout.slide_master):
        for ph in source.placeholders:
            if ph.placeholder_format.type in wanted:
                size = _font_pt(ph)
                if size:
                    return size
        style = source._element.find(".//" + qn("p:titleStyle" if kind == "title" else "p:bodyStyle"))
        if style is not None:
            first = style.find(qn("a:lvl1pPr"))
            node = first.find(qn("a:defRPr")) if first is not None else None
            if node is not None and node.get("sz"):
                return int(node.get("sz")) / 100
    return 40.0 if kind == "title" else DEFAULT_BODY_PT


def roles(slide) -> dict:
    """Which shape on a slide is its title and which holds its body text."""
    title = body = None
    for shape in slide.placeholders:
        kind = _ph_type(shape)
        if kind in TITLE_TYPES and title is None:
            title = shape
        elif kind in BODY_TYPES and body is None:
            body = shape
        elif kind == PP_PLACEHOLDER.SUBTITLE and body is None:
            body = shape
    if title is None or body is None:
        boxes = [s for s in slide.shapes if getattr(s, "has_text_frame", False) and s.has_text_frame and not s.is_placeholder and _text(s)]
        if title is None and boxes:
            title = min(boxes, key=lambda s: (s.top, -(_font_pt(s) or 0)))
        rest = [s for s in boxes if s is not title]
        if body is None and rest:
            body = max(rest, key=lambda s: s.width * s.height)
    return {"title": title, "body": body, "placeholders": bool(title is not None and title.is_placeholder and body is not None and body.is_placeholder)}


def _is_closing(slide) -> bool:
    words = " ".join(_text(s) for s in slide.shapes).lower()
    return any(w in words for w in CLOSING_WORDS) and len(words) < 80


def plan(prs) -> dict:
    """The format's slides sorted into: the title slide, the pattern for
    content slides, and the closing slide."""
    slides = list(prs.slides)
    if not slides:
        return {"title": None, "pattern": None, "closing": None, "samples": []}
    closing = slides[-1] if len(slides) > 1 and _is_closing(slides[-1]) else None
    middle = [s for s in slides[1:] if s is not closing]
    pattern = next((s for s in middle if roles(s)["title"] is not None and roles(s)["body"] is not None), None)
    return {"title": slides[0], "pattern": pattern, "closing": closing, "samples": middle}


def _all_text_shapes(prs):
    for master in prs.slide_masters:
        yield from (s for s in master.shapes if getattr(s, "has_text_frame", False) and s.has_text_frame)
        for layout in master.slide_layouts:
            yield from (s for s in layout.shapes if getattr(s, "has_text_frame", False) and s.has_text_frame and not s.is_placeholder)
    for slide in prs.slides:
        yield from (s for s in slide.shapes if getattr(s, "has_text_frame", False) and s.has_text_frame)


def analyse(data: bytes) -> dict:
    try:
        prs = Presentation(io.BytesIO(data))
    except Exception as exc:
        raise ValueError("This file could not be opened as a PowerPoint presentation. Save it again as .pptx and upload that.") from exc
    p = plan(prs)
    inch = lambda v: round(Emu(v).inches, 2)  # noqa: E731
    master = prs.slide_master
    band = [{"name": s.name, "text": _text(s), "left_in": inch(s.left), "top_in": inch(s.top), "width_in": inch(s.width), "height_in": inch(s.height),
             "kind": "picture" if s.shape_type == 13 else ("text" if _text(s) else "shape")}
            for s in master.shapes if not s.is_placeholder]
    warnings, styles, mode = [], {}, None
    if p["pattern"] is None:
        warnings.append("No sample content slide (a slide with a heading and a text area) was found after the title slide. Content slides will use the deck's \"Title and Content\" layout.")
        mode = "layout"
    else:
        r = roles(p["pattern"])
        mode = "the format's own layout" if r["placeholders"] else "a copy of the format's sample slide"
        styles = {"slide heading": {"size": _inherited_pt(p["pattern"], r["title"], "title")}, "slide text": {"size": _inherited_pt(p["pattern"], r["body"], "body")}}
        if styles["slide text"]["size"] < 16:
            warnings.append("The sample slide's text is smaller than 16 pt, which is hard to read when projected.")
    if p["closing"] is None:
        warnings.append("The format has no closing (\"Thank you\") slide, so none will be added.")
    texts = [_text(s) for s in _all_text_shapes(prs)]
    return {
        "kind": "ppt",
        "slide": {"width_in": inch(prs.slide_width), "height_in": inch(prs.slide_height),
                  "shape": "widescreen 16:9" if abs(prs.slide_width / prs.slide_height - 16 / 9) < 0.02 else ("standard 4:3" if abs(prs.slide_width / prs.slide_height - 4 / 3) < 0.02 else "custom")},
        "layouts": [l.name for l in master.slide_layouts],
        "on_every_slide": band,
        "sample_slides": [{"position": i + 1, "heading": _text(roles(s)["title"]) if roles(s)["title"] is not None else "", "layout": s.slide_layout.name} for i, s in enumerate(prs.slides)],
        "content_slides_use": mode,
        "styles": styles,
        "field_map": pf.guess_map(texts),
        "warnings": warnings,
    }


# ------------------------------------------------------------------ writing

def _replace_in_shape(shape, old: str, new: str) -> None:
    for paragraph in shape.text_frame.paragraphs:
        nodes = list(paragraph._p.iter(qn("a:t")))
        full = "".join(n.text or "" for n in nodes)
        guard = 0
        while old in full and guard < 10:
            at, end, pos, first = full.find(old), full.find(old) + len(old), 0, True
            for node in nodes:
                text = node.text or ""
                start, stop = pos, pos + len(text)
                pos = stop
                if stop <= at or start >= end:
                    continue
                node.text = text[: max(0, at - start)] + (new if first else "") + (text[max(0, end - start):] if stop > end else "")
                first = False
            full = "".join(n.text or "" for n in nodes)
            guard += 1
            if old in new:
                break


def fill_fields(prs, field_map: list[dict], vals: dict) -> list[str]:
    unfilled: list[str] = []
    for entry in field_map:
        match, field = entry["match"], entry["field"]
        for shape in list(_all_text_shapes(prs)):
            if match not in shape.text_frame.text:
                continue
            value = pf.inline_value(field, match, vals)
            if value is None:
                label = pf.FIELDS[field][0]
                if label not in unfilled:
                    unfilled.append(label)
                continue
            _replace_in_shape(shape, match, value)
    return unfilled


def _set_lines(shape, lines: list[str]) -> None:
    """Puts one paragraph per line into a text shape, each a copy of the
    shape's first paragraph so bullets, indent, font and colour carry over."""
    body = shape.text_frame._txBody
    paragraphs = body.findall(qn("a:p"))
    pattern = copy.deepcopy(paragraphs[0]) if paragraphs else None
    for p in paragraphs:
        body.remove(p)
    for line in lines or [""]:
        if pattern is None:
            shape.text_frame.add_paragraph().text = line
            continue
        p = copy.deepcopy(pattern)
        runs = p.findall(qn("a:r"))
        for extra in runs[1:] + p.findall(qn("a:br")) + p.findall(qn("a:fld")):
            p.remove(extra)
        if runs:
            runs[0].find(qn("a:t")).text = line
        else:
            run = p.makeelement(qn("a:r"), {})
            node = run.makeelement(qn("a:t"), {})
            node.text = line
            run.append(node)
            end = p.find(qn("a:endParaRPr"))
            (end.addprevious(run) if end is not None else p.append(run))
        body.append(p)


def capacity(width: int, height: int, font_pt: float) -> tuple[int, int]:
    """(lines, characters per line) a text box of this size holds at this font size."""
    usable_w, usable_h = max(width - 2 * 91440, 1), max(height - 2 * 45720, 1)
    # measured against LibreOffice and PowerPoint renderings of common fonts: a line is about
    # 1.25 x the font size tall and an average character about 0.45 x the font size wide
    lines = int(usable_h / (font_pt * 1.25 * EMU_PER_PT))
    chars = int(usable_w / (font_pt * 0.45 * EMU_PER_PT)) - 2            # room for the bullet and its indent
    return max(lines, MIN_LINES), max(chars, 12)


def _lines_needed(text: str, chars: int) -> int:
    return max(1, math.ceil(len(text) / chars))


def split_bullets(bullets: list[str], lines: int, chars: int) -> list[list[str]]:
    """Bullets shared out over as many slides as they need. A single bullet
    too long for one slide is cut at sentence ends."""
    prepared: list[str] = []
    for bullet in bullets:
        text = re.sub(r"\s+", " ", str(bullet)).strip()
        if not text:
            continue
        if _lines_needed(text, chars) > lines:
            piece = ""
            for sentence in re.split(r"(?<=[.;:!?])\s+", text):
                if piece and _lines_needed(piece + " " + sentence, chars) > max(2, lines // 2):
                    prepared.append(piece)
                    piece = sentence
                else:
                    piece = (piece + " " + sentence).strip()
            if piece:
                prepared.append(piece)
        else:
            prepared.append(text)
    pages, current, used = [], [], 0
    for text in prepared:
        need = _lines_needed(text, chars)
        if current and used + need > lines:
            pages.append(current)
            current, used = [], 0
        current.append(text)
        used += need
    if current or not pages:
        pages.append(current)
    return pages


def _clone_slide(prs, source):
    """A new slide that is a copy of `source`, pictures included."""
    new = prs.slides.add_slide(source.slide_layout)
    for shape in list(new.shapes):
        shape._element.getparent().remove(shape._element)
    for element in source.shapes._spTree:
        if element.tag.endswith("}nvGrpSpPr") or element.tag.endswith("}grpSpPr"):
            continue
        copied = copy.deepcopy(element)
        for blip in copied.iter(qn("a:blip")):
            rid = blip.get(R_EMBED)
            if rid and rid in source.part.rels:
                blip.set(R_EMBED, new.part.relate_to(source.part.rels[rid].target_part, source.part.rels[rid].reltype))
        new.shapes._spTree.append(copied)
    return new


def _move_to(prs, slide, position: int) -> None:
    ids = prs.slides._sldIdLst
    node = next(s for s in ids if prs.part.related_part(s.rId) is slide.part)
    ids.remove(node)
    ids.insert(position, node)


def _delete(prs, slide) -> None:
    ids = prs.slides._sldIdLst
    node = next(s for s in ids if prs.part.related_part(s.rId) is slide.part)
    prs.part.drop_rel(node.rId)
    ids.remove(node)


def _content_layout(prs):
    for name in ("Title and Content", "Title, Content"):
        for layout in prs.slide_layouts:
            if layout.name == name:
                return layout
    for layout in prs.slide_layouts:
        kinds = [ph.placeholder_format.type for ph in layout.placeholders]
        if any(k in TITLE_TYPES for k in kinds) and any(k in BODY_TYPES for k in kinds):
            return layout
    return prs.slide_layouts[min(1, len(prs.slide_layouts) - 1)]


def build(template: bytes, field_map: list[dict], details: dict, slides: list[dict], images: dict) -> dict:
    """The finished deck as .pptx bytes, plus what was written.

    `slides` is a list of {"title", "bullets", "image_id"?, "notes"?}. The
    format's title slide comes first and its closing slide last."""
    prs = Presentation(io.BytesIO(template))
    p = plan(prs)
    pattern = p["pattern"]
    use_clone = pattern is not None and not roles(pattern)["placeholders"]
    layout = pattern.slide_layout if pattern is not None and not use_clone else _content_layout(prs)
    written, dropped, continued = [], [], 0
    position = 1 if p["title"] is not None else 0

    for item in slides:
        heading = re.sub(r"\s+", " ", str(item.get("title") or "")).strip() or "Untitled"
        picture = images.get(item.get("image_id")) if item.get("image_id") is not None else None
        if item.get("image_id") is not None and not picture:
            dropped.append(heading)
        probe = _clone_slide(prs, pattern) if use_clone else prs.slides.add_slide(layout)
        r = roles(probe)
        body = r["body"]
        full_left, full_top, full_width, full_height = _box(prs, body)
        text_width = int(full_width * 0.54) if picture else full_width
        font_pt = _inherited_pt(probe, body, "body") if body is not None else DEFAULT_BODY_PT
        lines, chars = capacity(text_width, full_height, font_pt)
        pages = split_bullets(item.get("bullets") or [], lines, chars)
        for n, page in enumerate(pages):
            slide = probe if n == 0 else (_clone_slide(prs, pattern) if use_clone else prs.slides.add_slide(layout))
            rr = roles(slide)
            shown = heading if n == 0 else f"{heading} (contd.)"
            if rr["title"] is not None:
                _set_lines(rr["title"], [shown])
            if rr["body"] is not None:
                _set_lines(rr["body"], page)
                if picture and n == 0:
                    # all four are set together: a placeholder that states only part of its position loses the rest
                    rr["body"].left, rr["body"].top, rr["body"].width, rr["body"].height = full_left, full_top, text_width, full_height
            if picture and n == 0:
                _place_picture(slide, picture, full_left + text_width + int(full_width * 0.03), full_top, full_width - text_width - int(full_width * 0.03), full_height)
            notes = str(item.get("notes") or "").strip()
            if notes and n == 0:
                slide.notes_slide.notes_text_frame.text = notes
            _move_to(prs, slide, position)
            position += 1
            continued += 1 if n else 0
            written.append({"title": shown, "bullets": page, "has_image": bool(picture and n == 0), "lines_available": lines, "characters_per_line": chars,
                            "lines_used": sum(_lines_needed(b, chars) for b in page), "font_pt": font_pt})

    for sample in p["samples"]:
        _delete(prs, sample)
    unfilled = fill_fields(prs, field_map, pf.values(details))
    # The format's own title and closing slides cannot be continued on another
    # slide, so if the filled-in names no longer fit, that one text box is
    # reduced just enough (never below 60%), and the fact is reported.
    reduced, too_long = [], []
    for kept in (p["title"], p["closing"]):
        if kept is None:
            continue
        for shape in kept.shapes:
            if not getattr(shape, "has_text_frame", False) or not shape.has_text_frame or not shape.text_frame.text.strip():
                continue
            if not shape.width or not shape.height:
                continue
            if _ph_type(shape) in TITLE_TYPES:
                continue                      # a heading grows from its anchor and is not clipped
            kind = "body"
            size = _inherited_pt(kept, shape, kind)
            lines, chars = capacity(shape.width, shape.height, size)
            lines = max(1, int(max(shape.height - 2 * 45720, 1) / (size * 1.25 * EMU_PER_PT)))
            used = sum(_lines_needed(para.text, chars + 3) for para in shape.text_frame.paragraphs if para.text.strip())
            if used > lines:
                scale = max(0.6, lines / used)
                body_pr = shape.text_frame._txBody.find(qn("a:bodyPr"))
                for old in list(body_pr):
                    if old.tag in (qn("a:normAutofit"), qn("a:noAutofit"), qn("a:spAutoFit")):
                        body_pr.remove(old)
                fit = body_pr.makeelement(qn("a:normAutofit"), {"fontScale": str(int(scale * 100000)), "lnSpcReduction": "10000"})
                body_pr.append(fit)
                reduced.append(shape.text_frame.text.strip().splitlines()[0][:50])
                if lines / used < 0.5:
                    too_long.append(shape.text_frame.text.strip().splitlines()[0][:50])
    out = io.BytesIO()
    prs.save(out)
    return {"pptx": out.getvalue(), "slides": written, "slide_count": len(prs.slides), "continued": continued, "dropped": dropped, "unfilled": unfilled,
            "reduced": reduced, "overflow": [s["title"] for s in written if s["lines_used"] > s["lines_available"]] + too_long}


def _box(prs, body) -> tuple[int, int, int, int]:
    """Where a slide's text area is. Falls back to the usual area under the
    heading when the format's shape does not say."""
    if body is not None and body.width and body.height:
        return body.left or 0, body.top or 0, body.width, body.height
    return int(prs.slide_width * 0.05), int(prs.slide_height * 0.27), int(prs.slide_width * 0.9), int(prs.slide_height * 0.6)


def _place_picture(slide, data: bytes, left: int, top: int, width: int, height: int) -> None:
    """Fits a picture inside a box, keeping its proportions, centred."""
    from PIL import Image
    try:
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
    except Exception:
        return
    if width <= 0 or height <= 0 or w <= 0 or h <= 0:
        return
    scale = min(width / w, height / h)
    pw, ph = max(1, int(w * scale)), max(1, int(h * scale))
    slide.shapes.add_picture(io.BytesIO(data), left + (width - pw) // 2, top + (height - ph) // 2, width=pw, height=ph)


def leftovers(data: bytes, field_map: list[dict], sample_texts: Optional[list[str]] = None) -> list[str]:
    """Format wording still present in a finished deck."""
    prs = Presentation(io.BytesIO(data))
    found = []
    for shape in _all_text_shapes(prs):
        text = shape.text_frame.text
        for wording in [e["match"] for e in field_map] + list(sample_texts or []):
            if wording and wording in text and wording not in found:
                found.append(wording)
    return found
