"""
Real retrieval layer for the RAG pipeline — the "R" in RAG.

Uses TF-IDF (Term Frequency-Inverse Document Frequency) + cosine similarity
instead of neural embeddings. This is a deliberate, documented choice: this
sandbox has no network access to Hugging Face (where pretrained embedding
models are hosted), so a real neural embedding model can't be downloaded here.
TF-IDF is a legitimate, well-established information-retrieval technique —
it's how search engines worked for decades before neural embeddings existed —
and for a small, domain-specific corpus like a 309-chunk question bank, it
performs well and is fully explainable in a viva.

If real internet/HuggingFace access is available in the actual deployment
environment, this module's retrieve() function is a drop-in swap point:
replace the TF-IDF vectorizer with a real sentence-transformers embedding
model and a proper vector store (e.g. ChromaDB) without changing anything
that calls this module.
"""

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session
from app.models.models import QuestionBankChunk

_vectorizer = None
_matrix = None
_chunk_ids = None
_chunk_texts = None


def build_index(db: Session):
    """Fits the TF-IDF vectorizer on all real question bank chunks. Cheap
    enough (309 short text chunks) to rebuild on demand rather than persist —
    real production use with a larger corpus would cache this."""
    global _vectorizer, _matrix, _chunk_ids, _chunk_texts
    chunks = db.query(QuestionBankChunk).all()
    _chunk_ids = [c.id for c in chunks]
    _chunk_texts = [c.text for c in chunks]
    subject_folders = [c.subject_folder for c in chunks]

    _vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    _matrix = _vectorizer.fit_transform(_chunk_texts)
    return len(chunks), subject_folders


def retrieve(db: Session, query: str, top_k: int = 3, subject_folder: str = None):
    """Real retrieval: returns the top_k real chunks most relevant to the
    query, by TF-IDF cosine similarity — never invented, never a random pick."""
    global _vectorizer, _matrix, _chunk_ids, _chunk_texts
    if _vectorizer is None:
        build_index(db)

    query_vec = _vectorizer.transform([query])
    sims = cosine_similarity(query_vec, _matrix)[0]

    ranked = sorted(range(len(sims)), key=lambda i: sims[i], reverse=True)

    results = []
    for idx in ranked:
        if sims[idx] <= 0:
            continue
        chunk = db.query(QuestionBankChunk).filter(QuestionBankChunk.id == _chunk_ids[idx]).first()
        if not chunk:
            continue
        if subject_folder and chunk.subject_folder != subject_folder:
            continue
        results.append({
            "chunk_id": chunk.id, "subject_folder": chunk.subject_folder,
            "text": chunk.text, "relevance_score": round(float(sims[idx]), 4),
        })
        if len(results) >= top_k:
            break
    return results
