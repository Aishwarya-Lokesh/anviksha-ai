"""Time-limited links to stored files.

Browsers open a certificate or a PDF in a new tab or an <iframe>, where the
sign-in token cannot be sent. So instead of leaving file addresses open to
anyone who can guess a file name, every API response that hands out a file
address signs it: the link carries an expiry time and a signature that only
this server can produce. A link is therefore only ever obtained by someone
the API has already checked may see that file, and it stops working later.
"""
import hashlib
import hmac
import time
from typing import Optional
from urllib.parse import quote, urlsplit

from app.core.config import settings

LINK_LIFETIME_SECONDS = 6 * 60 * 60

# Profile photos stay openly readable: they are shown inside <img> tags all
# over the interface and carry nothing a classmate cannot already see.
PUBLIC_PREFIXES = ("/profile-photos/",)


def _signature(path: str, expires: int) -> str:
    message = f"{path}|{expires}".encode("utf-8")
    return hmac.new(settings.JWT_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()[:40]


def signed(url: Optional[str], lifetime: int = LINK_LIFETIME_SECONDS) -> Optional[str]:
    """`/certificates/a b.pdf` -> `/certificates/a%20b.pdf?exp=...&sig=...`.
    Safe to call on a link that is already encoded or already signed."""
    if not url:
        return url
    path = urlsplit(url).path
    if path.startswith(PUBLIC_PREFIXES):
        return url
    from urllib.parse import unquote
    plain = unquote(path)
    expires = int(time.time()) + lifetime
    # The link ends with the file's own extension. Pages decide "PDF or image"
    # from how a link ends, and an older copy of the app still open in someone's
    # browser does so on the whole link, query string included.
    extension = plain.rsplit(".", 1)[-1].lower() if "." in plain.rsplit("/", 1)[-1] else ""
    tail = f"&type=.{extension}" if extension else ""
    return f"{quote(plain)}?exp={expires}&sig={_signature(plain, expires)}{tail}"


def is_valid(path: str, expires: Optional[int], signature: Optional[str]) -> bool:
    """`path` is the decoded request path, e.g. `/certificates/a b.pdf`."""
    if path.startswith(PUBLIC_PREFIXES):
        return True
    if not expires or not signature or expires < time.time():
        return False
    return hmac.compare_digest(_signature(path, int(expires)), signature)
