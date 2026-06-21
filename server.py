#!/usr/bin/env python3
"""FastAPI backend — PDF upload with vision-assisted slide description."""

import base64
import os
import tempfile

import fitz  # pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

from ingest import ingest

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
VISION_MODEL = "anthropic/claude-sonnet-4-5"

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
        raise HTTPException(500, detail="OPENROUTER_API_KEY not set on server")
    return OpenAI(api_key=key, base_url=OPENROUTER_BASE)


def _render_page_b64(pdf_path: str, page_idx: int) -> str:
    doc = fitz.open(pdf_path)
    pix = doc[page_idx].get_pixmap(matrix=fitz.Matrix(2, 2))
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    doc.close()
    return b64


def _describe_slide(pdf_path: str, page_idx: int) -> str:
    b64 = _render_page_b64(pdf_path, page_idx)
    resp = _client().chat.completions.create(
        model=VISION_MODEL,
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}"},
                },
                {
                    "type": "text",
                    "text": (
                        "This is a slide or figure page from a research synopsis PDF. "
                        "Describe all visible content thoroughly: headings, body text, "
                        "bullet points, chart data, diagram labels, table values, and "
                        "any numbers or metrics. Be factual and complete."
                    ),
                },
            ],
        }],
    )
    return resp.choices[0].message.content or "[No description generated]"


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, detail="Only PDF files are accepted")

    raw = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(raw)
        path = tmp.name

    try:
        chunks = ingest(path)
        slide_count = sum(1 for c in chunks if c["content_type"] == "slide")
        print(f"Ingested {len(chunks)} chunks, {slide_count} slide(s) to describe with vision")

        for chunk in chunks:
            if chunk["content_type"] == "slide":
                try:
                    print(f"  Describing slide on page {chunk['page']}…")
                    chunk["text"] = _describe_slide(path, chunk["page"] - 1)
                    chunk["content_type"] = "slide_described"
                except Exception as exc:
                    chunk["text"] = f"[Slide p.{chunk['page']} — vision failed: {exc}]"

        return chunks
    finally:
        os.unlink(path)
