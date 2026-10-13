"""Writes the chapters and slides of a project from the student's own
material and answers.

The rule throughout: nothing is made up. The model is given only what the
student supplied and is told to write from that alone. On top of the
instruction there are checks that do not depend on the model behaving:

- a chapter with no material behind it is not written at all; the student is
  asked for what is missing;
- references are only ever the ones the student listed;
- table rows are copied from the student's files, never produced by the model;
- any sentence stating a percentage or a decimal figure that does not appear
  in the student's material is removed and reported."""
import io
import json
import logging
import os
import re
import time
from typing import Callable, Optional

log = logging.getLogger(__name__)

CHAPTERS: list[dict] = [
    {"key": "introduction", "title": "Introduction", "words": ["introduction", "overview", "background", "motivation", "problem", "objective", "scope", "existing system"],
     "questions": [("problem_statement", "Problem statement", "What problem does the project solve, and for whom?", True),
                   ("objectives", "Objectives", "List the objectives, one per line.", True),
                   ("scope", "Scope", "What is included, and what is deliberately left out?", False),
                   ("existing_system", "Existing system and its limitations", "How is this done today, and what is wrong with that?", False)]},
    {"key": "literature", "title": "Literature Survey", "words": ["literature", "survey", "related work", "review", "existing", "paper", "study", "proposed by", "et al"],
     "questions": [("literature", "Papers or systems you studied", "For each: authors and year, what they did, and what it lacked. Only works you actually read.", True)]},
    {"key": "requirements", "title": "System Requirements", "words": ["requirement", "hardware", "software", "functional", "non-functional", "specification", "srs"],
     "questions": [("software_requirements", "Software requirements", "Languages, frameworks, database, tools, operating system.", True),
                   ("hardware_requirements", "Hardware requirements", "Processor, memory, sensors, boards, cameras, and so on.", False),
                   ("functional_requirements", "Functional requirements", "What the system must do, one per line.", False)]},
    {"key": "design", "title": "System Design", "words": ["design", "architecture", "module", "diagram", "flow", "dfd", "uml", "database", "schema", "er diagram", "use case"],
     "questions": [("modules", "Modules", "One module per line: name - what it does.", True),
                   ("architecture", "How the modules work together", "Describe the flow of data from input to output.", False),
                   ("database", "Database or data design", "Tables or collections and what each stores.", False)]},
    {"key": "implementation", "title": "Implementation", "words": ["implementation", "implemented", "code", "algorithm", "function", "api", "framework", "library", "developed", "tech stack"],
     "questions": [("implementation", "How the main parts were built", "The key algorithms, screens or APIs and how each works.", True)]},
    {"key": "testing", "title": "Testing", "words": ["test", "testing", "test case", "validation", "unit", "integration", "expected", "actual"],
     "questions": [("test_cases", "Tests you ran", "One per line: what was tested, the input, expected and actual result. Only tests you really ran.", True)]},
    {"key": "results", "title": "Results and Discussion", "words": ["result", "output", "screenshot", "accuracy", "performance", "observed", "snapshot", "discussion", "comparison"],
     "questions": [("results", "Results you observed", "What the system produced and any figures you measured. Only real measurements.", True)]},
    {"key": "conclusion", "title": "Conclusion and Future Scope", "words": ["conclusion", "future", "enhancement", "summary", "limitation"],
     "questions": [("conclusion", "Conclusion", "What was achieved against the objectives.", True),
                   ("future_scope", "Future scope", "What could be added or improved next.", False)]},
]
BY_KEY = {c["key"]: c for c in CHAPTERS}
GLOBAL_QUESTIONS = [("references", "References", "One per line, complete (authors, title, where published, year). Only sources you actually used.", False)]
NUMBER_CLAIM = re.compile(r"\d+(?:\.\d+)?\s?%|\b\d+\.\d+\b")
EXCERPT_BUDGET = 9000
CHUNK = 1100


class NeedsModel(Exception):
    """The writing model could not be used (not configured, or busy for too long)."""


# ------------------------------------------------------------------ plan and readiness

def chapter_plan(template_titles: Optional[list[str]] = None) -> list[dict]:
    """The chapters of the report. A format that lays out four or more
    chapters decides the chapter list; otherwise the usual eight are used."""
    titles = [t.strip() for t in (template_titles or []) if t and t.strip()]
    if len(titles) < 4:
        return [{"key": c["key"], "title": c["title"]} for c in CHAPTERS]
    plan, used = [], set()
    for title in titles:
        lowered = title.lower()
        match = next((c for c in CHAPTERS if c["key"] not in used and (any(w in lowered for w in c["title"].lower().split() if len(w) > 4) or any(w in lowered for w in c["words"][:3]))), None)
        if match:
            used.add(match["key"])
            plan.append({"key": match["key"], "title": title})
        else:
            plan.append({"key": "other:" + re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")[:40], "title": title})
    return plan


def questions_for(key: str, title: str) -> list[tuple]:
    if key in BY_KEY:
        return BY_KEY[key]["questions"]
    return [(key, title, f"What should the chapter \"{title}\" say? Write the points in your own words.", True)]


def _words_for(key: str, title: str) -> list[str]:
    return BY_KEY[key]["words"] if key in BY_KEY else [w for w in re.findall(r"[a-z]{4,}", title.lower())]


def _chunks(text: str) -> list[str]:
    paragraphs, out, current = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()], [], ""
    for p in paragraphs:
        if len(current) + len(p) > CHUNK and current:
            out.append(current)
            current = ""
        current = (current + "\n" + p).strip()
        while len(current) > CHUNK * 2:
            out.append(current[: CHUNK * 2])
            current = current[CHUNK * 2:]
    if current:
        out.append(current)
    return out


def excerpts(materials: list[dict], words: list[str], extra: str = "", budget: int = EXCERPT_BUDGET) -> str:
    """The parts of the student's material most related to a chapter."""
    terms = [w.lower() for w in words] + [w for w in re.findall(r"[a-z]{5,}", (extra or "").lower())][:25]
    scored = []
    for m in materials:
        for chunk in _chunks(m.get("text") or ""):
            low = chunk.lower()
            score = sum(low.count(t) for t in terms)
            if score:
                scored.append((score / (1 + len(chunk) / 2000), m.get("filename") or "file", chunk))
    scored.sort(key=lambda s: -s[0])
    out, used = [], 0
    for _, name, chunk in scored:
        if used + len(chunk) > budget:
            continue
        out.append(f"[from {name}]\n{chunk}")
        used += len(chunk)
    return "\n\n".join(out)


def readiness(plan: list[dict], answers: dict, materials: list[dict]) -> list[dict]:
    """For each chapter: is there enough of the student's own material to write it?"""
    out = []
    for chapter in plan:
        qs = questions_for(chapter["key"], chapter["title"])
        own = {q[0]: str(answers.get(q[0]) or "").strip() for q in qs}
        support = len(excerpts(materials, _words_for(chapter["key"], chapter["title"]), budget=4000))
        required_missing = [q[1] for q in qs if q[3] and len(own[q[0]]) < 25]
        answered = sum(len(v) for v in own.values())
        if not required_missing or support >= 700:
            status = "ready"
        elif answered >= 40 or support >= 200:
            status = "thin"
        else:
            status = "missing"
        out.append({"key": chapter["key"], "title": chapter["title"], "status": status, "missing": required_missing if status != "ready" else [],
                    "material_found": support >= 200,
                    "questions": [{"id": q[0], "label": q[1], "hint": q[2], "required": q[3], "answered": len(own[q[0]]) >= 25} for q in qs]})
    return out


# ------------------------------------------------------------------ the model

def _default_complete(prompt: str, max_tokens: int = 3500) -> str:
    try:
        from groq import Groq
    except ImportError as exc:
        raise NeedsModel("The writing model is not installed on this server.") from exc
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise NeedsModel("The writing model is not configured on this server.")
    from app.core.llm_client import MODEL_CANDIDATES
    client = Groq(api_key=key, timeout=90, max_retries=0)
    last = None
    for wait in (0, 20, 45, 75):                  # the free tier limits requests per minute: wait and try again
        if wait:
            time.sleep(wait)
        for model in MODEL_CANDIDATES:
            try:
                r = client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}], max_tokens=max_tokens, temperature=0.3)
                return r.choices[0].message.content or ""
            except Exception as exc:              # noqa: BLE001
                last = exc
                text = str(exc).lower()
                if not any(t in text for t in ("429", "rate", "503", "overloaded", "timeout", "timed out", "404", "decommissioned", "not_found")):
                    raise NeedsModel("The writing model returned an error. Please try again.") from exc
    raise NeedsModel("The writing model is busy right now. Please try again in a few minutes.") from last


def _json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        return json.loads(text[start: end + 1])
    except json.JSONDecodeError:
        try:
            return json.loads(re.sub(r",\s*([}\]])", r"\1", text[start: end + 1]))
        except json.JSONDecodeError:
            return {}


RULES = """Rules you must follow without exception:
- Use ONLY the facts in STUDENT'S ANSWERS and STUDENT'S MATERIAL below. Do not add facts from your own knowledge about this project.
- Never invent results, accuracy figures, measurements, test cases, dataset sizes, team members, tools that are not mentioned, or references.
- Do not cite sources. Do not write citation marks like [1]. Do not name papers or authors that are not in the student's text.
- If the material does not support something the chapter normally contains, leave it out and add a short question for the student to "missing".
- Formal academic English for an engineering project report, third person, no first-person "I". Use the project's own terms consistently.
- Do not repeat the chapter title as a heading. Do not number headings."""


def write_chapter(chapter: dict, details: dict, answers: dict, materials: list[dict], images: list[dict], tables: list[dict],
                  complete: Callable[..., str], instruction: str = "", previous: Optional[list[dict]] = None) -> dict:
    """One chapter as blocks, written from the student's material only."""
    key, title = chapter["key"], chapter["title"]
    qs = questions_for(key, title)
    own = "\n".join(f"{q[1]}:\n{str(answers.get(q[0]) or '').strip()}" for q in qs if str(answers.get(q[0]) or "").strip())
    support = excerpts(materials, _words_for(key, title), own)
    if len(own) < 25 and len(support) < 200:
        return {"blocks": [], "missing": [q[1] for q in qs if q[3]], "removed": [], "skipped": True}
    image_lines = "\n".join(f"IMG{i['id']}: {i.get('caption') or i.get('name')}" for i in images) or "(none)"
    table_lines = "\n".join(f"TBL{n}: {t.get('caption') or 'table'} | columns: {', '.join(t['rows'][0][:6])}" for n, t in enumerate(tables, start=1)) or "(none)"
    prompt = f"""You are helping an engineering student write the chapter "{title}" of their project report.

{RULES}

PROJECT: {details.get('title') or ''}
DOMAIN: {details.get('domain') or 'not stated'} | TECHNOLOGY: {details.get('tech_stack') or 'not stated'}

STUDENT'S ANSWERS:
{own or '(none for this chapter)'}

STUDENT'S MATERIAL (excerpts):
{support or '(none found for this chapter)'}

PICTURES THE STUDENT SUPPLIED (place one only where this chapter discusses what it shows):
{image_lines}

TABLES FROM THE STUDENT'S FILES (place one only if it belongs in this chapter; its rows are copied in for you):
{table_lines}
{('CURRENT TEXT OF THE CHAPTER (revise it as instructed, keeping what is correct):' + chr(10) + _plain(previous)) if previous else ''}
{('THE STUDENT ASKS: ' + instruction.strip()[:500]) if instruction.strip() else ''}

Return ONLY a JSON object:
{{"blocks": [
  {{"type": "heading", "level": 2, "text": "Section heading"}},
  {{"type": "para", "text": "A paragraph. Mark at most a few key terms like **this**."}},
  {{"type": "bullets", "items": ["short item", "short item"]}},
  {{"type": "figure", "image": "IMG3", "caption": "What the picture shows"}},
  {{"type": "table", "table": "TBL1", "caption": "What the table shows"}}
], "missing": ["A question for the student about something this chapter needs but the material does not give"]}}
Write 2 to 5 sections with paragraphs of 60 to 140 words each, as far as the material allows. Shorter and true is better than longer and padded."""
    data = _json(complete(prompt))
    corpus = " ".join([own, support, json.dumps(details)] + [m.get("text") or "" for m in materials])
    blocks, removed = clean_blocks(data.get("blocks") or [], corpus, images, tables)
    return {"blocks": blocks, "missing": [str(m).strip() for m in (data.get("missing") or []) if str(m).strip()][:6], "removed": removed, "skipped": False}


def _plain(blocks: Optional[list[dict]]) -> str:
    out = []
    for b in blocks or []:
        if b.get("type") == "heading":
            out.append(f"## {b.get('text')}")
        elif b.get("type") == "para":
            out.append(b.get("text") or "")
        elif b.get("type") == "bullets":
            out.extend(f"- {i}" for i in b.get("items") or [])
        elif b.get("type") in ("figure", "table"):
            out.append(f"[{b['type']}: {b.get('caption')}]")
    return "\n".join(out)[:7000]


def _digits(text: str) -> set[str]:
    return {re.sub(r"\s", "", n).rstrip("%").rstrip("0").rstrip(".") or "0" for n in re.findall(r"\d+(?:\.\d+)?", text or "")}


def strip_unsupported(text: str, known: set[str]) -> tuple[str, list[str]]:
    """Removes sentences that state a percentage or decimal figure the student never gave."""
    kept, removed = [], []
    for sentence in re.split(r"(?<=[.!?])\s+", text or ""):
        claims = [re.sub(r"\s", "", c).rstrip("%").rstrip("0").rstrip(".") or "0" for c in NUMBER_CLAIM.findall(sentence)]
        cited = re.search(r"\[\d+\]|\bet al\b", sentence)
        if any(c not in known for c in claims) or cited:
            removed.append(sentence.strip())
        else:
            kept.append(sentence)
    return " ".join(kept).strip(), removed


def clean_blocks(raw: list, corpus: str, images: list[dict], tables: list[dict]) -> tuple[list[dict], list[str]]:
    known, removed, out = _digits(corpus), [], []
    image_ids = {f"IMG{i['id']}": i for i in images}
    for b in raw:
        if not isinstance(b, dict):
            continue
        kind = b.get("type")
        if kind == "heading" and str(b.get("text") or "").strip():
            out.append({"type": "heading", "level": 3 if b.get("level") == 3 else 2, "text": re.sub(r"^\s*\d+(\.\d+)*\.?\s+", "", str(b["text"])).strip()[:120]})
        elif kind == "para":
            text, gone = strip_unsupported(str(b.get("text") or ""), known)
            removed.extend(gone)
            if len(text) > 20:
                out.append({"type": "para", "text": text})
        elif kind == "bullets":
            items = []
            for item in b.get("items") or []:
                text, gone = strip_unsupported(str(item), known)
                removed.extend(gone)
                if text:
                    items.append(text)
            if items:
                out.append({"type": "bullets", "items": items[:12]})
        elif kind == "figure" and str(b.get("image") or "").upper() in image_ids:
            image = image_ids[str(b["image"]).upper()]
            caption = (image.get("caption") or str(b.get("caption") or "") or image.get("name") or "").strip()
            out.append({"type": "figure", "image_id": image["id"], "caption": caption[:140]})
        elif kind == "table":
            m = re.match(r"TBL(\d+)$", str(b.get("table") or "").upper())
            if m and 1 <= int(m.group(1)) <= len(tables):
                source = tables[int(m.group(1)) - 1]
                out.append({"type": "table", "caption": (source.get("caption") or str(b.get("caption") or "")).strip()[:140], "rows": source["rows"]})
    while out and out[-1]["type"] == "heading":          # a heading with nothing under it
        out.pop()
    return out, removed


def acknowledgement(details: dict) -> list[str]:
    """Fixed wording with the real names filled in. Lines for people not named are left out."""
    who = lambda label, name: f"{label}, {name}," if name else ""  # noqa: E731
    lines = []
    college = details.get("college") or "our institution"
    lines.append(f"The satisfaction of completing this project is incomplete without acknowledging the people who made it possible. We are grateful to {college} for providing the facilities and the environment to carry out this work.")
    if details.get("principal_name"):
        lines.append(f"We express our sincere thanks to {who('our Principal', details['principal_name'])} for the support and encouragement.")
    if details.get("hod_name"):
        lines.append(f"We are thankful to {details['hod_name']}, Head of the Department{(' of ' + details['department']) if details.get('department') else ''}, for the guidance and for the facilities extended to us.")
    if details.get("guide_name"):
        lines.append(f"We are deeply indebted to our guide, {details['guide_name']}{(', ' + details['guide_designation']) if details.get('guide_designation') else ''}, for the constant guidance, valuable suggestions and encouragement throughout the project.")
    lines.append("We also thank the teaching and non-teaching staff of the department, our parents and our friends for their help and support.")
    return lines


def write_abstract(details: dict, chapters: list[dict], corpus: str, complete: Callable[..., str]) -> tuple[list[str], list[str]]:
    body = "\n\n".join(f"# {c['title']}\n{_plain(c.get('blocks'))}" for c in chapters if c.get("blocks"))[:9000]
    if len(body) < 300:
        return [], []
    prompt = f"""Write the abstract of an engineering project report titled "{details.get('title') or ''}".
Use ONLY what is in the REPORT TEXT below. Do not add any fact, figure or claim that is not there. No citations.
One paragraph of 150 to 220 words: the problem, the approach, what was built, and the outcome as the report states it.
Return ONLY JSON: {{"abstract": "..."}}

REPORT TEXT:
{body}"""
    text, removed = strip_unsupported(str(_json(complete(prompt, max_tokens=700)).get("abstract") or ""), _digits(corpus + " " + body))
    return ([text] if len(text) > 80 else []), removed


def clean_references(raw) -> list[str]:
    """The student's own reference list, tidied. Nothing is added to it."""
    lines = raw if isinstance(raw, list) else str(raw or "").splitlines()
    out = []
    for line in lines:
        text = re.sub(r"^\s*(\[\d+\]|\d+[.)])\s*", "", str(line)).strip()
        if len(text) >= 12 and text not in out:
            out.append(text)
    return out[:80]


# ------------------------------------------------------------------ slides

def _short(text: str, words: int = 16) -> str:
    text = re.sub(r"\*\*", "", re.sub(r"\s+", " ", text)).strip()
    parts = text.split(" ")
    return text if len(parts) <= words else " ".join(parts[:words]).rstrip(",;:") + "…"


def fallback_slides(chapter: dict) -> list[dict]:
    """Slides taken straight from a chapter's own sentences, used when the model is not available."""
    slides, current = [], None
    for b in chapter.get("blocks") or []:
        if b["type"] == "heading" and b.get("level", 2) == 2:
            current = {"title": b["text"], "bullets": [], "notes": ""}
            slides.append(current)
            continue
        if current is None:
            current = {"title": chapter["title"], "bullets": [], "notes": ""}
            slides.append(current)
        if b["type"] == "para":
            first = re.split(r"(?<=[.!?])\s+", b["text"])[0]
            current["bullets"].append(_short(first))
            current["notes"] = (current["notes"] + " " + b["text"]).strip()[:900]
        elif b["type"] == "bullets":
            current["bullets"].extend(_short(i) for i in b["items"])
        elif b["type"] == "figure" and "image_id" not in current:
            current["image_id"] = b["image_id"]
    merged = [s for s in slides if s["bullets"] or s.get("image_id") is not None]
    return merged[:3] if merged else []


def write_slides(chapters: list[dict], details: dict, references: list[str], complete: Optional[Callable[..., str]], corpus: str = "") -> tuple[list[dict], list[str]]:
    """The deck's content slides, derived from the report so both say the same thing."""
    slides: list[dict] = []
    removed: list[str] = []
    written = [c for c in chapters if c.get("blocks")]
    if written:
        slides.append({"title": "Agenda", "bullets": [c["title"] for c in written], "notes": "Outline of the presentation.", "source": "agenda"})
    for chapter in written:
        made = []
        if complete is not None:
            prompt = f"""Turn this chapter of a project report into 1 to 3 presentation slides.
Use ONLY the chapter text. Do not add facts, figures or claims. No citations.
Each slide: a short title, 3 to 5 bullets of at most 14 words each (phrases, not sentences), and speaker notes of 2 to 4 sentences taken from the chapter.
Return ONLY JSON: {{"slides": [{{"title": "...", "bullets": ["..."], "notes": "..."}}]}}

CHAPTER: {chapter['title']}
{_plain(chapter['blocks'])}"""
            try:
                known = _digits(corpus + " " + _plain(chapter["blocks"]))
                for s in (_json(complete(prompt, max_tokens=1200)).get("slides") or [])[:3]:
                    bullets = []
                    for item in (s.get("bullets") or [])[:6]:
                        text, gone = strip_unsupported(str(item), known)
                        removed.extend(gone)
                        if text:
                            bullets.append(_short(text, 18))
                    notes, gone = strip_unsupported(str(s.get("notes") or ""), known)
                    removed.extend(gone)
                    if bullets and str(s.get("title") or "").strip():
                        made.append({"title": str(s["title"]).strip()[:80], "bullets": bullets, "notes": notes[:900]})
            except NeedsModel:
                made = []
        if not made:
            made = fallback_slides(chapter)
        figure = next((b for b in chapter["blocks"] if b["type"] == "figure"), None)
        if figure and made and not any("image_id" in s for s in made):
            made[-1]["image_id"] = figure["image_id"]
        for s in made:
            s["source"] = chapter["key"]
        slides.extend(made)
    if references:
        slides.append({"title": "References", "bullets": [_short(r, 30) for r in references[:12]], "notes": "", "source": "references"})
    return slides, removed


# ------------------------------------------------------------------ a diagram from the listed modules

def parse_modules(text: str) -> list[str]:
    names = []
    for line in str(text or "").splitlines():
        line = re.sub(r"^\s*(\d+[.)]|[-*•])\s*", "", line).strip()
        name = re.split(r"\s[-–—:]\s|:\s", line, maxsplit=1)[0].strip()
        if 2 <= len(name) <= 48 and name not in names:
            names.append(name)
    return names[:8]


def module_diagram(modules: list[str]) -> Optional[bytes]:
    """A plain block diagram of the modules in the order the student listed
    them. It shows only the names the student gave; it claims nothing else."""
    if len(modules) < 2:
        return None
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 26)
    except OSError:
        try:
            font = ImageFont.truetype("arial.ttf", 26)
        except OSError:
            font = ImageFont.load_default()
    box_w, box_h, gap, pad = 520, 84, 46, 40
    width, height = box_w + 2 * pad, len(modules) * box_h + (len(modules) - 1) * gap + 2 * pad
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for i, name in enumerate(modules):
        top = pad + i * (box_h + gap)
        draw.rounded_rectangle([pad, top, pad + box_w, top + box_h], radius=14, outline=(40, 60, 110), width=3, fill=(236, 241, 252))
        box = draw.textbbox((0, 0), name, font=font)
        draw.text((pad + (box_w - (box[2] - box[0])) / 2, top + (box_h - (box[3] - box[1])) / 2 - box[1]), name, fill=(20, 30, 60), font=font)
        if i < len(modules) - 1:
            x, y = pad + box_w // 2, top + box_h
            draw.line([x, y, x, y + gap - 10], fill=(40, 60, 110), width=3)
            draw.polygon([(x - 9, y + gap - 14), (x + 9, y + gap - 14), (x, y + gap)], fill=(40, 60, 110))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
