"""Groq-backed academic assistant and source-grounded content generation."""
import json
import logging
import os
import time

try:
    from groq import Groq
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False

logger = logging.getLogger(__name__)
MODEL_CANDIDATES = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]

# Bump whenever SLIDE_SYSTEM_PROMPT's requested schema changes, so a saved
# generation's reuse fingerprint (see teacher.py) is invalidated and a fresh
# AI call is made instead of silently replaying a deck built under the old
# schema (e.g. missing a newly-added field like comparison_points).
SLIDE_PROMPT_VERSION = 2


def _call_with_fallback(client, messages, max_tokens=None):
    last_error = None
    for model_name in MODEL_CANDIDATES:
        for attempt in range(2):
            try:
                kwargs = {"max_tokens": max_tokens} if max_tokens else {}
                return client.chat.completions.create(model=model_name, messages=messages, **kwargs)
            except Exception as error:
                last_error = error
                message = str(error).lower()
                if any(token in message for token in ("429", "rate_limit", "503", "overloaded")) and attempt == 0:
                    time.sleep(2)
                    continue
                if any(token in message for token in ("404", "not_found", "decommissioned", "429", "rate_limit", "503", "overloaded")):
                    break
                raise
    raise last_error


SYSTEM_PROMPT_TEMPLATE = """You are Anviksha AI, an academic assistant for {role} users at GSSS Institute of Engineering and Technology for Women (GSSSIETW), Information Science and Engineering department.
Use ONLY the real data in CONTEXT. Answer only institution-specific academic questions that are genuinely about this institution's academics, students, faculty, or the real data in CONTEXT. Be concise and useful.

If the question is unrelated to academics at this institution (e.g. general trivia, entertainment, personal opinions, coding help unrelated to the context, or anything not answerable from the real context), respond with EXACTLY this single token and nothing else, no punctuation, no explanation: OFF_TOPIC

CONTEXT:
{context}"""

OFF_TOPIC_MESSAGE = "I can only help with academic queries related to Anviksha AI — I'm not able to answer that."

SLIDE_SYSTEM_PROMPT = """You are a university professor and pedagogical designer. Create exactly {num_slides} student-friendly lecture slides from the SOURCE EXCERPT below.

The source is the primary authority. Explain its actual ideas in conceptual order; do not make a slide containing only a filename, chapter title, or heading. Convert difficult language to simple but technically accurate explanations. Explain HOW and WHY complex ideas work. Preserve definitions, formulas, algorithms, tables, technical terms, and worked examples found in the excerpt.

Do not automatically add advantages, disadvantages, applications, challenges, future scope, case studies, or conclusions. Include them only if they are in or naturally required by the source. Use an everyday analogy only for genuinely abstract concepts. Every slide must have 2-5 explanatory points, not labels such as 'Definition' or 'Advantages'.

{instructions}
Audience: {audience}. Tone: {tone}. Topic/section: {topic}.

In each bullet of "content", wrap the 1-3 most important terms or values in **double asterisks** (e.g. "**Mutual exclusion** means only one process may hold the resource at a time") so they can be rendered in bold - mark only genuinely key terms, never whole sentences.

If "step_by_step_example" describes a real ordered process (not just a worked numeric example), also return "process_steps": a JSON array of 3-6 short strings (2-6 words each), one per real step in that process, in order - so it can be rendered as an actual step diagram. Return an empty array if the slide has no real sequential process.

If the slide is fundamentally contrasting two things (e.g. "X vs Y", old approach vs new approach, two algorithms/models), also return "comparison_left_label" and "comparison_right_label" (1-3 words each, the two things being contrasted) and "comparison_points": a JSON array of 2-5 objects {{"left": "...", "right": "..."}}, each a short (3-8 word) real contrasting fact from the source for that one dimension - so it can be rendered as an actual side-by-side comparison diagram. Return an empty array (and omit the labels) if the slide is not a real comparison.

Respond ONLY with valid JSON: an array of exactly {num_slides} objects. Each object must retain "title" and "content" (2-5 newline-separated bullets), and also include "slide_number", "slide_type", "core_takeaway", "source_topics", "simple_analogy", "step_by_step_example", "process_steps", "comparison_left_label", "comparison_right_label", "comparison_points", "diagram_description", "image_prompt", and "speaker_notes". image_prompt requests a clean labeled educational vector/infographic on a white/light background with accurate relationships, minimal clutter, no stock imagery, and no garbled text. speaker_notes must be 120-180 words, teach rather than repeat bullets, and may connect to the previous slide.

SOURCE EXCERPT (actual extracted content; do not treat its heading alone as content):
{context}
"""

NOTES_SYSTEM_PROMPT = """Write clear, structured lecture notes on "{topic}" from the REAL COURSE CONTENT. Use the source as authority, do not invent facts, and respond directly with notes. {style_instructions}

REAL COURSE CONTENT:
{context}"""

QUESTION_SYSTEM_PROMPT = """You are an exam paper setter. Write ONE exam question at Bloom's Taxonomy level "{bloom_level}" worth {marks} marks, addressing "{co}", strictly grounded in the SOURCE NOTES below. Do not invent facts outside the source. Respond with ONLY the question text - no numbering, no marks annotation, no preamble, no quotation marks.

SOURCE NOTES:
{context}"""

PARAPHRASE_SYSTEM_PROMPT = """You are an exam paper setter reusing a real question across two exam sets (Set A and Set B). Reword the REAL QUESTION below so it tests the exact same underlying concept in genuinely different phrasing - do not change what is being tested, do not add or remove information, do not change its scope or difficulty. Respond with ONLY the reworded question text - no numbering, no preamble, no quotation marks.

REAL QUESTION:
{question}"""

INSIGHT_SYSTEM_PROMPT = """You are Anviksha AI, writing a short academic intelligence summary for a {role} at GSSS Institute of Engineering and Technology for Women, ISE department. Using ONLY the REAL DATA below, write 3-5 sentences covering exactly this structure: what is going well, what needs attention, and one concrete, specific recommendation grounded in the real numbers given. Never invent a number that isn't in the data. Be direct and specific (name real subjects/students/values from the data when present), not generic. Do not use headings or bullet points - plain prose only.

REAL DATA:
{context}"""


def is_configured() -> bool:
    return _SDK_AVAILABLE and bool(os.environ.get("GROQ_API_KEY"))


def ask(question: str, context: str, role: str = "student") -> dict:
    if not is_configured():
        return {"answer": "The AI assistant isn't connected yet — no API key has been configured.", "connected": False}
    try:
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
        prompt = SYSTEM_PROMPT_TEMPLATE.format(role=role, context=context or "(no relevant real data found)")
        response = _call_with_fallback(client, [{"role": "system", "content": prompt}, {"role": "user", "content": f"Question: {question}"}])
        raw = response.choices[0].message.content
        if raw.strip().strip(".").upper() == "OFF_TOPIC":
            return {"answer": OFF_TOPIC_MESSAGE, "connected": True}
        return {"answer": raw, "connected": True}
    except Exception as error:
        return {"answer": f"AI request failed: {error}", "connected": True, "error": True}


def _extract_json_array(raw: str) -> list:
    """Pull the JSON slide array out of a real LLM response, tolerating the
    ways these models routinely deviate from 'respond with ONLY JSON' -
    markdown code fences, a leading/trailing sentence of prose, or (for a
    response cut off by the token limit) a dangling trailing object. Raises
    json.JSONDecodeError only when no usable array can be recovered at all."""
    text = raw.strip()
    if text.startswith("```"):
        # Strip a leading ```json / ``` fence and a trailing ``` if present,
        # without assuming exactly three backtick-delimited parts exist.
        text = text[3:]
        if text.lower().startswith("json"):
            text = text[4:]
        closing = text.rfind("```")
        if closing != -1:
            text = text[:closing]
        text = text.strip()
    start = text.find("[")
    if start == -1:
        raise json.JSONDecodeError("No JSON array found in AI response", text, 0)
    end = text.rfind("]")
    candidate = text[start:end + 1] if end > start else text[start:]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # Truncated mid-array (hit the model's output token limit): salvage every
    # complete top-level object before the cut, rather than discarding the
    # whole response and forcing a full retry.
    depth, obj_start, objects = 0, None, []
    for i, ch in enumerate(candidate):
        if ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start is not None:
                objects.append(candidate[obj_start:i + 1])
                obj_start = None
    parsed = []
    for obj_text in objects:
        try:
            parsed.append(json.loads(obj_text))
        except json.JSONDecodeError:
            continue
    if not parsed:
        raise json.JSONDecodeError("Could not recover any complete slide object", candidate, 0)
    return parsed


def generate_slides(topic: str, num_slides: int, audience: str, tone: str, instructions: str, context: str = "") -> dict:
    if not is_configured():
        return {"slides": [], "connected": False, "message": "The AI PPT Generator isn't connected yet — no API key has been configured."}
    try:
        prompt = SLIDE_SYSTEM_PROMPT.format(num_slides=num_slides, topic=topic, audience=audience, tone=tone, instructions=instructions or "Keep it clear and exam-relevant.", context=context or "(no source content provided)")
        response = _call_with_fallback(Groq(api_key=os.environ["GROQ_API_KEY"]), [{"role": "user", "content": prompt}], max_tokens=max(4096, num_slides * 900))
        raw = response.choices[0].message.content.strip()
        slides = _extract_json_array(raw)
        if not isinstance(slides, list) or not slides:
            raise ValueError("The AI did not return any usable slides")
        if len(slides) != num_slides:
            logger.warning("PPT slide generation for '%s': requested %d slides, AI returned %d (likely truncated by the model's output limit) — using what was returned", topic, num_slides, len(slides))
        return {"slides": slides, "connected": True}
    except json.JSONDecodeError:
        return {"slides": [], "connected": True, "error": True, "message": "The AI returned invalid slide data — try again."}
    except Exception as error:
        return {"slides": [], "connected": True, "error": True, "message": f"AI request failed: {error}"}


_WORDS_PER_AUTO_SLIDE = 130  # real observed density: ~130 source words covers one lecture slide's worth of content


def plan_slide_allocation(chunks: list[dict], num_slides: int, automatic: bool) -> list[int]:
    """How many slides each real chunk gets. Automatic mode sizes each
    chunk's allocation to its own real word count (longer real sections get
    more slides, short ones get fewer) instead of blindly dividing a fixed
    total evenly across chunks of very different length. Manual mode keeps
    the requested total but still distributes it in proportion to each
    chunk's real content instead of a flat even split."""
    usable = [c for c in chunks if c.get("text", "").strip()]
    if not usable:
        return []
    word_counts = [max(1, len(c["text"].split())) for c in usable]
    if automatic:
        return [max(2, min(10, round(wc / _WORDS_PER_AUTO_SLIDE))) for wc in word_counts]
    total_slides = max(max(1, num_slides), len(usable))
    total_words = sum(word_counts)
    allocation = [max(1, round(total_slides * wc / total_words)) for wc in word_counts]
    # Rounding can drift the sum away from total_slides by a couple slides;
    # correct the drift on the largest chunk(s) rather than silently
    # returning a count that doesn't match what was requested.
    drift = total_slides - sum(allocation)
    order = sorted(range(len(allocation)), key=lambda i: word_counts[i], reverse=True)
    i = 0
    while drift != 0 and order:
        idx = order[i % len(order)]
        if drift > 0:
            allocation[idx] += 1
            drift -= 1
        elif allocation[idx] > 1:
            allocation[idx] -= 1
            drift += 1
        i += 1
        if i > len(order) * 4:  # safety valve against pathological inputs
            break
    return allocation


def generate_slides_from_chunks(topic: str, num_slides: int, audience: str, tone: str, instructions: str, chunks: list[dict], automatic_slide_count: bool = False) -> dict:
    """Send every ordered extracted chunk intact; never substitute headings."""
    usable = [chunk for chunk in chunks if chunk.get("text", "").strip()]
    if not usable:
        return {"slides": [], "connected": True, "error": True, "message": "No extracted source content was available for slide generation."}
    allocations = plan_slide_allocation(usable, num_slides, automatic_slide_count)
    total_slides = sum(allocations)
    slides = []
    logger.info("PPT generation '%s': %d source chunks sent to LLM, target %d slides (automatic=%s)", topic, len(usable), total_slides, automatic_slide_count)
    for index, chunk in enumerate(usable):
        allocation = allocations[index]
        context = f"SOURCE SECTION: {chunk.get('title', topic)}\nSOURCE PAGES: {chunk.get('source_pages', [])}\n\n{chunk['text']}"
        result = generate_slides(chunk.get("title", topic), allocation, audience, tone, instructions, context)
        if not result.get("connected") or result.get("error"):
            return result
        for slide_index, slide in enumerate(result["slides"]):
            slide.setdefault("source_topics", [chunk.get("title", topic)])
            slide.setdefault("source_pages", chunk.get("source_pages", []))
            # Real textbook figure (if one was found on this chunk's real
            # pages) goes on the first slide generated from this chunk only -
            # not repeated across every slide of the same chapter.
            if slide_index == 0 and chunk.get("textbook_image_base64"):
                slide["textbook_image_base64"] = chunk["textbook_image_base64"]
                slide["textbook_image_ext"] = chunk["textbook_image_ext"]
        slides.extend(result["slides"])
    for number, slide in enumerate(slides, start=1):
        slide["slide_number"] = number
    logger.info("PPT generation '%s': %d slides generated", topic, len(slides))
    return {"slides": slides, "connected": True}


def generate_paper_question(bloom_level: str, marks: int, co: str, context: str = "") -> dict:
    """Completes a single question-paper slot when the teacher's own
    uploaded Important Questions file has no real candidate left for it.
    Grounded in the teacher's own uploaded notes/important-questions text,
    never fabricated from nothing. Fails closed (returns question=None)
    when the AI assistant isn't connected, rather than inventing content."""
    if not is_configured():
        return {"question": None, "connected": False}
    try:
        level = bloom_level if bloom_level and bloom_level != "Any" else "Understand"
        prompt = QUESTION_SYSTEM_PROMPT.format(bloom_level=level, marks=marks, co=co or "the subject", context=context or "(no source notes provided)")
        response = _call_with_fallback(Groq(api_key=os.environ["GROQ_API_KEY"]), [{"role": "user", "content": prompt}])
        text = response.choices[0].message.content.strip().strip('"')
        return {"question": text or None, "connected": True}
    except Exception as error:
        return {"question": None, "connected": True, "error": True, "message": f"AI request failed: {error}"}


def paraphrase_question(question: str) -> dict:
    """Reword a REAL question being reused across Set A/Set B so the two
    sets don't show identical text for the same underlying real concept.
    The tested concept always traces back to the real source question -
    only the phrasing changes. Fails closed (returns question=None) when
    the AI isn't connected, so the caller can fall back to the verbatim
    real question rather than silently losing content."""
    if not is_configured():
        return {"question": None, "connected": False}
    try:
        prompt = PARAPHRASE_SYSTEM_PROMPT.format(question=question)
        response = _call_with_fallback(Groq(api_key=os.environ["GROQ_API_KEY"]), [{"role": "user", "content": prompt}])
        text = response.choices[0].message.content.strip().strip('"')
        return {"question": text or None, "connected": True}
    except Exception as error:
        return {"question": None, "connected": True, "error": True, "message": f"AI request failed: {error}"}


def generate_dashboard_insight(context: str, role: str = "student") -> dict:
    """Understand -> Diagnose -> Recommend, in one short paragraph, grounded
    only in the real, already-computed dashboard numbers passed in as
    context. Fails closed with connected=False when the AI isn't
    configured, exactly like every other AI feature here - never a
    fabricated insight standing in for a real one."""
    if not is_configured():
        return {"insight": None, "connected": False}
    try:
        prompt = INSIGHT_SYSTEM_PROMPT.format(role=role, context=context or "(no data available)")
        response = _call_with_fallback(Groq(api_key=os.environ["GROQ_API_KEY"]), [{"role": "user", "content": prompt}])
        return {"insight": response.choices[0].message.content.strip(), "connected": True}
    except Exception as error:
        return {"insight": None, "connected": True, "error": True, "message": f"AI request failed: {error}"}


def generate_notes(topic: str, style_instructions: str, context: str = "") -> dict:
    if not is_configured():
        return {"notes": "", "connected": False, "message": "The AI Notes Generator isn't connected yet — no API key has been configured."}
    try:
        prompt = NOTES_SYSTEM_PROMPT.format(topic=topic, style_instructions=style_instructions or "Keep it clear and well organized.", context=context or "(no source content provided)")
        response = _call_with_fallback(Groq(api_key=os.environ["GROQ_API_KEY"]), [{"role": "user", "content": prompt}])
        return {"notes": response.choices[0].message.content.strip(), "connected": True}
    except Exception as error:
        return {"notes": "", "connected": True, "error": True, "message": f"AI request failed: {error}"}
