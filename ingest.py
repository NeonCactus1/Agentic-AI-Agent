#!/usr/bin/env python3
"""
PDF ingestion pipeline: classifies pages, extracts text, detects sections,
chunks by section (~500-800 tokens), and writes chunks.json.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import pdfplumber

SLIDE_CHAR_THRESHOLD = 50
TARGET_TOKENS_MIN = 500
TARGET_TOKENS_MAX = 800

# Matches "1. Title", "1.1 Title", "1.1.1 Title" at line start
HEADING_RE = re.compile(r"^\d+(\.\d+)*\.?\s+\S")


def count_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token."""
    return max(1, len(text) // 4)


def get_page_char_counts(pdf_path: str) -> list[int]:
    """Use pdftotext (poppler) to extract raw text per page and count chars."""
    result = subprocess.run(
        ["pdftotext", "-layout", pdf_path, "-"],
        capture_output=True,
        text=True,
    )
    raw = result.stdout
    # pdftotext separates pages with form-feed \x0c
    pages = raw.split("\x0c")
    # Last element is often empty after the final \x0c
    if pages and pages[-1].strip() == "":
        pages = pages[:-1]
    return [len(p.strip()) for p in pages]


def classify_pages(pdf_path: str) -> list[str]:
    """Return 'text' or 'slide' for each page."""
    char_counts = get_page_char_counts(pdf_path)
    return ["slide" if c < SLIDE_CHAR_THRESHOLD else "text" for c in char_counts]


def extract_text_page(pdf: pdfplumber.PDF, page_index: int) -> str:
    """Extract and clean text from a pdfplumber page."""
    page = pdf.pages[page_index]
    text = page.extract_text() or ""
    return text.strip()


def detect_heading(line: str) -> bool:
    return bool(HEADING_RE.match(line.strip()))


def parse_heading_label(line: str) -> str:
    """Return the full heading line stripped."""
    return line.strip()


def chunk_section(
    section_heading: str,
    section_lines: list[tuple[int, str]],  # (page_number, line)
    content_type: str,
    chunk_id_start: int,
) -> list[dict]:
    """Split a section's lines into chunks of ~500-800 tokens."""
    chunks = []
    chunk_id = chunk_id_start

    current_lines: list[str] = []
    current_pages: list[int] = []
    current_tokens = 0

    def flush(lines, pages):
        nonlocal chunk_id
        if not lines:
            return
        text = "\n".join(lines).strip()
        if not text:
            return
        tokens = count_tokens(text)
        chunks.append(
            {
                "id": chunk_id,
                "page": min(pages),
                "section": section_heading,
                "content_type": content_type,
                "text": text,
                "tokens": tokens,
            }
        )
        chunk_id += 1

    for page_num, line in section_lines:
        line_tokens = count_tokens(line)
        if current_tokens + line_tokens > TARGET_TOKENS_MAX and current_lines:
            flush(current_lines, current_pages)
            current_lines = []
            current_pages = []
            current_tokens = 0
        current_lines.append(line)
        current_pages.append(page_num)
        current_tokens += line_tokens

        # Flush when we've hit the comfortable target minimum
        if current_tokens >= TARGET_TOKENS_MIN:
            flush(current_lines, current_pages)
            current_lines = []
            current_pages = []
            current_tokens = 0

    flush(current_lines, current_pages)
    return chunks


def ingest(pdf_path: str) -> list[dict]:
    page_types = classify_pages(pdf_path)
    chunks: list[dict] = []
    chunk_id = 0

    # Accumulate sections: list of (heading, [(page, line), ...], content_type)
    sections: list[tuple[str, list[tuple[int, str]], str]] = []
    current_heading = "Preamble"
    current_lines: list[tuple[int, str]] = []
    current_type = "text"

    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        for i, page_type in enumerate(page_types[:num_pages]):
            page_num = i + 1  # 1-indexed

            if page_type == "slide":
                # Flush any accumulated text section first
                if current_lines:
                    sections.append((current_heading, current_lines, current_type))
                    current_lines = []
                description = (
                    f"[Visual slide on page {page_num} — "
                    "image or diagram content not extracted]"
                )
                sections.append((current_heading, [(page_num, description)], "slide"))
            else:
                text = extract_text_page(pdf, i)
                if not text:
                    continue
                for line in text.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    if detect_heading(stripped):
                        # Save previous section
                        if current_lines:
                            sections.append(
                                (current_heading, current_lines, current_type)
                            )
                        current_heading = parse_heading_label(stripped)
                        current_lines = []
                        current_type = "text"
                    else:
                        current_lines.append((page_num, stripped))

        # Flush last section
        if current_lines:
            sections.append((current_heading, current_lines, current_type))

    # Convert sections to chunks
    for heading, lines, ctype in sections:
        new_chunks = chunk_section(heading, lines, ctype, chunk_id)
        chunk_id += len(new_chunks)
        chunks.extend(new_chunks)

    return chunks


def main():
    parser = argparse.ArgumentParser(description="Ingest a PDF into chunks.json")
    parser.add_argument("pdf", help="Path to the PDF file")
    parser.add_argument(
        "-o", "--output", default="chunks.json", help="Output JSON file"
    )
    args = parser.parse_args()

    pdf_path = args.pdf
    if not Path(pdf_path).exists():
        print(f"Error: {pdf_path} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Ingesting {pdf_path}...")
    chunks = ingest(pdf_path)
    out_path = args.output
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(chunks, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(chunks)} chunks to {out_path}")

    # Summary
    by_type = {}
    for c in chunks:
        by_type.setdefault(c["content_type"], 0)
        by_type[c["content_type"]] += 1
    for ctype, count in by_type.items():
        print(f"  {ctype}: {count} chunks")


if __name__ == "__main__":
    main()
