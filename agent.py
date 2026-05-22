#!/usr/bin/env python3
"""
Synopsis Expert agent: loads chunks.json, stuffs all chunks into the system
prompt, and answers a user question grounded in the document.

Uses OpenRouter (OpenAI-compatible endpoint). Set OPENROUTER_API_KEY in env.
"""

import argparse
import json
import os
import sys

from openai import OpenAI

CHUNKS_FILE = "chunks.json"
# OpenRouter model ID for Claude Sonnet 4
MODEL = "anthropic/claude-sonnet-4-5"
MAX_TOKENS = 1024
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def load_chunks(path: str) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {path} not found. Run ingest.py first.", file=sys.stderr)
        sys.exit(1)


def format_chunks(chunks: list[dict]) -> str:
    parts = []
    for c in chunks:
        header = f"[Page {c['page']} | Section: {c['section']} | Type: {c['content_type']}]"
        parts.append(f"{header}\n{c['text']}")
    return "\n\n".join(parts)


def build_system_prompt(chunks: list[dict]) -> str:
    formatted = format_chunks(chunks)
    return f"""\
You are a Synopsis Expert. Your sole knowledge base is the document excerpts \
provided below. Answer every question strictly using information from these excerpts.

Rules:
- Always cite the page number(s) your answer draws from, e.g. "(p. 2)".
- If the answer spans multiple pages, cite each one.
- If a passage comes from a visual/slide page (Type: slide), note that it is a \
visual element and that no detailed text was extracted from it.
- If the document does not contain enough information to answer, say so explicitly \
— do not invent facts or speculate beyond what is written.
- Keep answers concise and factual.

--- DOCUMENT CONTENT ---

{formatted}

--- END OF DOCUMENT ---"""


def main():
    parser = argparse.ArgumentParser(description="Ask a question about the synopsis")
    parser.add_argument("question", help="Question to ask the Synopsis Expert")
    parser.add_argument(
        "--chunks", default=CHUNKS_FILE, help="Path to chunks.json"
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Error: OPENROUTER_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    chunks = load_chunks(args.chunks)
    system_prompt = build_system_prompt(chunks)

    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": args.question},
        ],
    )

    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
