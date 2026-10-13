"""Stock photos for generated slides, and the colour themes a deck can be
exported in.

Two photo services are supported; whichever has a key set is used
(`PIXABAY_API_KEY`, or `PEXELS_API_KEY`). Photos are optional: without a key,
or when a search finds nothing or the service is slow, callers get `None`
and draw a designed panel instead. The key stays on the server; the browser
only ever receives image links."""
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urlparse

import httpx

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"
PIXABAY_SEARCH_URL = "https://pixabay.com/api/"
IMAGE_HOSTS = {"images.pexels.com", "pixabay.com", "cdn.pixabay.com"}
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
_cache: dict[tuple[str, int], Optional[dict]] = {}   # (service:query, position) -> photo


def theme(name: Optional[str]) -> dict:
    return THEMES.get((name or "").lower(), THEMES[DEFAULT_THEME])


_PIXABAY_KEY = re.compile(r"^\d{5,}-[0-9a-f]{20,}$")     # e.g. 12345678-0a1b2c...; Pexels keys have no dash
last_problem: Optional[str] = None                       # why the last search failed, for the admin to read; never contains the key


def provider() -> Optional[tuple[str, str]]:
    """(service name, key) for the photo service in use, or None. A key is
    recognised by its shape as well as by the variable it was saved under, so
    a Pixabay key saved as PEXELS_API_KEY still works."""
    for name, variable in (("Pixabay", "PIXABAY_API_KEY"), ("Pexels", "PEXELS_API_KEY")):
        key = os.getenv(variable, "").strip().strip('"').strip("'")
        if key:
            return ("Pixabay" if _PIXABAY_KEY.match(key) else name), key
    return None


def configured() -> bool:
    return provider() is not None


def _pexels(query: str, key: str) -> list[Optional[dict]]:
    r = httpx.get(PEXELS_SEARCH_URL, params={"query": query, "per_page": 15, "orientation": "landscape"}, headers={"Authorization": key}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for p in r.json().get("photos") or []:
        src = p.get("src") or {}
        url = src.get("large") or src.get("medium")
        out.append({"url": url, "thumb": src.get("medium") or src.get("small") or url, "credit": f"{p.get('photographer') or 'Pexels'} / Pexels",
                    "credit_url": p.get("photographer_url") or "https://www.pexels.com", "alt": p.get("alt") or query} if url else None)
    return out


def _pixabay(query: str, key: str) -> list[Optional[dict]]:
    r = httpx.get(PIXABAY_SEARCH_URL, params={"key": key, "q": query[:100], "image_type": "photo", "orientation": "horizontal",
                                              "safesearch": "true", "per_page": 15}, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for p in r.json().get("hits") or []:
        # Pixabay's own download links refuse requests from hosting providers
        # (HTTP 429), so the same photo is taken from its image network, whose
        # address is the small preview's with the size changed.
        preview = str(p.get("previewURL") or "")
        if preview.startswith("https://cdn.pixabay.com/") and "_150." in preview:
            url, thumb = preview.replace("_150.", "_1280."), preview.replace("_150.", "_640.")
        else:
            url, thumb = p.get("largeImageURL") or p.get("webformatURL"), p.get("webformatURL")
        out.append({"url": url, "thumb": thumb or url, "credit": f"{p.get('user') or 'Pixabay'} / Pixabay",
                    "credit_url": p.get("pageURL") or "https://pixabay.com", "alt": p.get("tags") or query} if url else None)
    return out


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
    service = provider()
    if not query or not service:
        return None
    name, key = service
    index = max(0, min(index, 14))
    cache_key = (f"{name}:{query.lower()}", index)
    if cache_key in _cache:
        return _cache[cache_key]
    global last_problem
    try:
        photos = (_pixabay if name == "Pixabay" else _pexels)(query, key)
        last_problem = None
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        last_problem = f"{name} refused the request (HTTP {code})" + (": the key was not accepted" if code in (400, 401, 403) else ": too many requests" if code == 429 else "")
        return None
    except Exception as exc:
        last_problem = f"{name} could not be reached ({type(exc).__name__})"
        return None                      # slow or unreachable: not cached, so a later try can succeed
    for i, photo in enumerate(photos):
        _cache[(cache_key[0], i)] = photo
    for i in range(len(photos), 15):
        _cache[(cache_key[0], i)] = None     # past the last result: remembered, so it isn't asked for again
    if len(_cache) > 2000:
        for stale in list(_cache)[:1000]:
            _cache.pop(stale, None)
    return _cache.get(cache_key)


def allowed_url(url: str) -> bool:
    """Only photos served by the photo services are ever downloaded by the server."""
    try:
        parsed = urlparse(url or "")
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname in IMAGE_HOSTS


last_fetch_problem: Optional[str] = None                 # why the last photo download failed; never contains a key


def fetch(url: str) -> Optional[bytes]:
    global last_fetch_problem
    if not allowed_url(url):
        last_fetch_problem = "the photo link is not from a photo service"
        return None
    try:
        r = _download(url)
        if r.status_code == 404 and "cdn.pixabay.com" in url and "_1280." in url:
            r = _download(url.replace("_1280.", "_640."))      # a few photos have no large version
        r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        last_fetch_problem = f"the photo service answered HTTP {exc.response.status_code} for the image"
        return None
    except Exception as exc:
        last_fetch_problem = f"the image could not be downloaded ({type(exc).__name__})"
        return None
    data = r.content
    kind = r.headers.get("content-type") or ""
    if not data or len(data) > MAX_IMAGE_BYTES or not kind.startswith("image/"):
        last_fetch_problem = f"the download was not a usable image (HTTP {r.status_code}, type {kind[:40] or 'unknown'}, {len(data)} bytes)"
        return None
    last_fetch_problem = None
    return data


def _download(url: str) -> httpx.Response:
    """One image request. A redirect is followed only while it stays on a photo service's own host."""
    response = None
    for _ in range(3):
        response = httpx.get(url, timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": "Mozilla/5.0 (compatible; AnvikshaSlides/1.0)", "Accept": "image/*"})
        target = str(response.headers.get("location") or "")
        if response.status_code in (301, 302, 303, 307, 308) and allowed_url(target):
            url = target
            continue
        break
    return response


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
            return i, ({"data": data, "credit": str(s.get("image_credit") or "Stock photo")[:80]} if data else None)
        found = search(query_for(s, topic)) if configured() else None
        data = fetch(found["url"]) if found else None
        return i, ({"data": data, "credit": found["credit"]} if data else None)

    if not wanted:
        return {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        return {i: image for i, image in pool.map(one, wanted) if image}
