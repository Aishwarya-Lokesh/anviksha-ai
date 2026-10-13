"""Stock photos for generated slides (Pexels), and the colour themes a deck can
be exported in.

Photos are optional: without `PEXELS_API_KEY`, or when a search finds nothing
or the service is slow, callers get `None` and draw a designed panel instead.
The key stays on the server; the browser only ever receives image links."""
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urlparse

import httpx

SEARCH_URL = "https://api.pexels.com/v1/search"
IMAGE_HOST = "images.pexels.com"
TIMEOUT = httpx.Timeout(6.0, connect=4.0)
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_IMAGES_PER_DECK = 16

# brand, dark, light (tint), all as RGB triples
THEMES: dict[str, dict] = {
    "violet": {"label": "Violet", "brand": (0x5B, 0x3F, 0xD9), "dark": (0x45, 0x30, 0xB0), "light": (0xED, 0xEB, 0xF9)},
    "ocean": {"label": "Ocean", "brand": (0x0E, 0x74, 0x90), "dark": (0x15, 0x5E, 0x75), "light": (0xE0, 0xF2, 0xF7)},
    "forest": {"label": "Forest", "brand": (0x1F, 0x7A, 0x4D), "dark": (0x16, 0x5C, 0x3A), "light": (0xE3, 0xF3, 0xEA)},
    "sunset": {"label": "Sunset", "brand": (0xC2, 0x4A, 0x1C), "dark": (0x9A, 0x3A, 0x12), "light": (0xFC, 0xEB, 0xE2)},
    "slate": {"label": "Slate", "brand": (0x33, 0x41, 0x55), "dark": (0x1E, 0x29, 0x3B), "light": (0xE8, 0xEC, 0xF1)},
}
DEFAULT_THEME = "violet"

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "introduction", "is", "it", "its", "of", "on", "or", "overview",
    "the", "to", "what", "why", "how", "with", "vs", "versus", "types", "type", "summary", "recap", "revision", "questions", "key", "concepts",
    "part", "module", "unit", "chapter", "basics", "using", "about",
}
_cache: dict[tuple[str, int], Optional[dict]] = {}


def theme(name: Optional[str]) -> dict:
    return THEMES.get((name or "").lower(), THEMES[DEFAULT_THEME])


def configured() -> bool:
    return bool(os.getenv("PEXELS_API_KEY", "").strip())


def query_for(slide: dict, topic: str = "") -> str:
    """A short search phrase for a slide: its own image hint if it has one,
    otherwise the meaningful words of its title."""
    hint = str(slide.get("image_query") or "").strip()
    if hint:
        return hint[:80]
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z\-]{2,}", str(slide.get("title") or "")) if w.lower() not in _STOPWORDS]
    if len(words) < 2:
        words += [w for w in re.findall(r"[A-Za-z][A-Za-z\-]{2,}", topic or "") if w.lower() not in _STOPWORDS][:3]
    return " ".join(words[:5])


def search(query: str, index: int = 0) -> Optional[dict]:
    """The `index`-th landscape photo for a phrase, or None."""
    query = (query or "").strip()
    key = os.getenv("PEXELS_API_KEY", "").strip()
    if not query or not key:
        return None
    index = max(0, min(index, 14))
    cache_key = (query.lower(), index)
    if cache_key in _cache:
        return _cache[cache_key]
    try:
        r = httpx.get(SEARCH_URL, params={"query": query, "per_page": 15, "orientation": "landscape"}, headers={"Authorization": key}, timeout=TIMEOUT)
        r.raise_for_status()
        photos = r.json().get("photos") or []
    except Exception:
        return None                      # slow or unreachable: not cached, so a later try can succeed
    for i, p in enumerate(photos):
        src = p.get("src") or {}
        _cache[(query.lower(), i)] = {
            "url": src.get("large") or src.get("medium"), "thumb": src.get("medium") or src.get("small"),
            "credit": p.get("photographer") or "Pexels", "credit_url": p.get("photographer_url") or "https://www.pexels.com",
            "alt": p.get("alt") or query,
        } if (src.get("large") or src.get("medium")) else None
    if len(_cache) > 2000:
        for stale in list(_cache)[:1000]:
            _cache.pop(stale, None)
    return _cache.get(cache_key)


def allowed_url(url: str) -> bool:
    """Only photos served by Pexels are ever downloaded by the server."""
    try:
        parsed = urlparse(url or "")
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == IMAGE_HOST


def fetch(url: str) -> Optional[bytes]:
    if not allowed_url(url):
        return None
    try:
        r = httpx.get(url, timeout=TIMEOUT, follow_redirects=False)
        r.raise_for_status()
    except Exception:
        return None
    data = r.content
    if not data or len(data) > MAX_IMAGE_BYTES or not (r.headers.get("content-type") or "").startswith("image/"):
        return None
    return data


def images_for(slides: list[dict], topic: str = "") -> dict[int, dict]:
    """Photo bytes and credit for the slides that should carry one, keyed by
    slide position. Slides that already have a figure, a process flow or a
    comparison are left alone, as are slides whose image was removed."""
    wanted: list[tuple[int, dict]] = []
    for i, s in enumerate(slides):
        if s.get("textbook_image_base64") or s.get("process_steps") or s.get("comparison_points") or s.get("no_image"):
            continue
        wanted.append((i, s))
    wanted = wanted[:MAX_IMAGES_PER_DECK]

    def one(item: tuple[int, dict]):
        i, s = item
        chosen = str(s.get("image_url") or "")
        if chosen and allowed_url(chosen):
            data = fetch(chosen)
            return i, ({"data": data, "credit": str(s.get("image_credit") or "Pexels")[:80]} if data else None)
        found = search(query_for(s, topic)) if configured() else None
        data = fetch(found["url"]) if found else None
        return i, ({"data": data, "credit": found["credit"]} if data else None)

    if not wanted:
        return {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        return {i: image for i, image in pool.map(one, wanted) if image}
