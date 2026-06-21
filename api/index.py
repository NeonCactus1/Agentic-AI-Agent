"""
Vercel Python serverless function — PDF upload with vision slide description.
Self-contained: ingest logic is inlined here so no relative imports are needed.
"""

import base64
import os
import re
import tempfile

import fitz  # pymupdf
import pdfplumber
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

# ─── Config ────────────────────────────────────────────────────────────────────
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
VISION_MODEL    = "anthropic/claude-sonnet-4-5"
SLIDE_CHAR_THRESHOLD = 50
TARGET_TOKENS_MIN    = 500
TARGET_TOKENS_MAX    = 800
HEADING_RE = re.compile(r"^\d+(\.\d+)*\.?\s+\S")


# ─── Ingest helpers (inlined — no subprocess/pdftotext needed) ─────────────────
def _count_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _classify_pages(pdf_path: str) -> list[str]:
    """Use pdfplumber only — no external binaries needed on Vercel."""
    types = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = (page.extract_text() or "").strip()
            types.append("slide" if len(text) < SLIDE_CHAR_THRESHOLD else "text")
    return types


def _detect_heading(line: str) -> bool:
    return bool(HEADING_RE.match(line.strip()))


def _chunk_section(heading, lines, content_type, chunk_id_start):
    chunks = []
    chunk_id = chunk_id_start
    cur_lines, cur_pages, cur_tokens = [], [], 0

    def flush(ls, ps):
        nonlocal chunk_id
        text = "\n".join(ls).strip()
        if not text:
            return
        chunks.append({
            "id": chunk_id, "page": min(ps), "section": heading,
            "content_type": content_type, "text": text,
            "tokens": _count_tokens(text),
        })
        chunk_id += 1

    for page_num, line in lines:
        t = _count_tokens(line)
        if cur_tokens + t > TARGET_TOKENS_MAX and cur_lines:
            flush(cur_lines, cur_pages)
            cur_lines, cur_pages, cur_tokens = [], [], 0
        cur_lines.append(line)
        cur_pages.append(page_num)
        cur_tokens += t
        if cur_tokens >= TARGET_TOKENS_MIN:
            flush(cur_lines, cur_pages)
            cur_lines, cur_pages, cur_tokens = [], [], 0

    flush(cur_lines, cur_pages)
    return chunks


def _ingest(pdf_path: str) -> list[dict]:
    page_types = _classify_pages(pdf_path)
    sections = []
    current_heading = "Preamble"
    current_lines: list[tuple[int, str]] = []
    current_type = "text"

    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        for i, ptype in enumerate(page_types[:num_pages]):
            page_num = i + 1
            if ptype == "slide":
                if current_lines:
                    sections.append((current_heading, current_lines, current_type))
                    current_lines = []
                desc = f"[Visual slide on page {page_num} — image or diagram content not extracted]"
                sections.append((current_heading, [(page_num, desc)], "slide"))
            else:
                text = (pdf.pages[i].extract_text() or "").strip()
                if not text:
                    continue
                for line in text.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    if _detect_heading(stripped):
                        if current_lines:
                            sections.append((current_heading, current_lines, current_type))
                        current_heading = stripped
                        current_lines = []
                        current_type = "text"
                    else:
                        current_lines.append((page_num, stripped))

        if current_lines:
            sections.append((current_heading, current_lines, current_type))

    chunks: list[dict] = []
    chunk_id = 0
    for heading, lines, ctype in sections:
        new = _chunk_section(heading, lines, ctype, chunk_id)
        chunk_id += len(new)
        chunks.extend(new)
    return chunks


# ─── Vision helper ─────────────────────────────────────────────────────────────
def _describe_slide(pdf_path: str, page_idx: int, client: OpenAI) -> str:
    doc = fitz.open(pdf_path)
    pix = doc[page_idx].get_pixmap(matrix=fitz.Matrix(2, 2))
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    doc.close()

    resp = client.chat.completions.create(
        model=VISION_MODEL,
        max_tokens=400,
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": (
                "This is a slide or figure page from a research synopsis PDF. "
                "Describe all visible content: headings, text, bullet points, "
                "chart data, diagram labels, table values, and numbers."
            )},
        ]}],
    )
    return resp.choices[0].message.content or "[No description generated]"


# ─── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client() -> OpenAI:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise HTTPException(500, detail="OPENROUTER_API_KEY not set")
    return OpenAI(api_key=key, base_url=OPENROUTER_BASE)


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, detail="Only PDF files are accepted")

    raw = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(raw)
        path = tmp.name

    try:
        client = _client()
        chunks = _ingest(path)
        for chunk in chunks:
            if chunk["content_type"] == "slide":
                try:
                    chunk["text"] = _describe_slide(path, chunk["page"] - 1, client)
                    chunk["content_type"] = "slide_described"
                except Exception as exc:
                    chunk["text"] = f"[Slide p.{chunk['page']} — vision failed: {exc}]"
        return chunks
    finally:
        os.unlink(path)
