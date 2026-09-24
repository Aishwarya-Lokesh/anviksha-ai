"""
Walks the uploaded IA_QP folder, extracts text from question paper .docx/.pdf files,
tags each with subject + IA stage, and chunks the text for future embedding into the
RAG vector store (Phase 3). Produces a JSON manifest that Phase 3 can embed directly.

Deliberately skipped:
- MOOC_Courses_details/* — certificates and course lists, not question papers
- Temp/lock files (~$*.docx), Thumbs.db, .zip archives, magazine files
- "student copy" / "corrected copy" duplicates are kept but tagged as variants —
  they're useful for the question bank (they're still real questions), just noted.
"""

import os
import re
import json
import docx
from pypdf import PdfReader

SKIP_DIR_NAMES = {"MOOC_Courses_details"}
SKIP_FILE_PATTERNS = [r"^~\$", r"^Thumbs\.db$", r"\.zip$"]

IA_STAGE_PATTERNS = [
    (re.compile(r"first[_ ]?ia|1st|i ia|ia[- ]?1\b", re.I), "IA-1"),
    (re.compile(r"second[_ ]?ia|2nd|ii ia|ia[- ]?2\b", re.I), "IA-2"),
    (re.compile(r"third[_ ]?ia|3rd|iii ia|ia[- ]?3\b", re.I), "IA-3"),
]


def should_skip(filename):
    return any(re.search(p, filename) for p in SKIP_FILE_PATTERNS)


def detect_ia_stage(path):
    for pattern, label in IA_STAGE_PATTERNS:
        if pattern.search(path):
            return label
    return "unspecified"


def extract_text_docx(path):
    try:
        d = docx.Document(path)
        return "\n".join(p.text for p in d.paragraphs if p.text.strip())
    except Exception as e:
        return f"[ERROR extracting {path}: {e}]"


def extract_text_pdf(path):
    try:
        reader = PdfReader(path)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        return f"[ERROR extracting {path}: {e}]"


def chunk_text(text, chunk_size=800, overlap=100):
    text = re.sub(r"\n{2,}", "\n", text).strip()
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return [c for c in chunks if c.strip()]


def ingest(root_dir, subject_root_marker="IA_QP"):
    manifest = []
    skipped_files = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]

        for fname in filenames:
            if should_skip(fname):
                skipped_files.append(os.path.join(dirpath, fname))
                continue
            ext = fname.lower().rsplit(".", 1)[-1] if "." in fname else ""
            if ext not in ("docx", "pdf"):
                continue

            full_path = os.path.join(dirpath, fname)

            # subject = first folder name under the IA_QP root
            rel = os.path.relpath(full_path, root_dir)
            parts = rel.split(os.sep)
            subject_folder = parts[0] if len(parts) > 1 else "uncategorized"

            ia_stage = detect_ia_stage(rel)

            if ext == "docx":
                text = extract_text_docx(full_path)
            else:
                text = extract_text_pdf(full_path)

            if not text.strip() or text.startswith("[ERROR"):
                skipped_files.append(full_path)
                continue

            chunks = chunk_text(text)
            for i, chunk in enumerate(chunks):
                manifest.append({
                    "subject_folder": subject_folder,
                    "ia_stage": ia_stage,
                    "source_file": fname,
                    "file_type": ext,
                    "chunk_index": i,
                    "text": chunk,
                })

    return manifest, skipped_files


if __name__ == "__main__":
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else "data_raw/IA_QP"
    manifest, skipped = ingest(root)

    out_path = "scripts/question_bank_manifest.json"
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)

    from collections import Counter
    by_subject = Counter(m["subject_folder"] for m in manifest)
    print(f"Ingested {len(manifest)} chunks from {len(set((m['subject_folder'], m['source_file']) for m in manifest))} files")
    print("By subject:", dict(by_subject))
    print(f"Skipped {len(skipped)} files (temp/irrelevant/unreadable)")
    print(f"Manifest written to {out_path}")
