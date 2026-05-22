#!/usr/bin/env python3
"""
Runs 10 test questions through the Synopsis Expert agent and saves results
to test_results.json. Pass/fail is determined by: non-empty answer AND
contains at least one page citation matching "(p. N)" or "(pp. N".
"""

import json
import os
import re
import sys
import time

from openai import OpenAI

from agent import (
    CHUNKS_FILE,
    MAX_TOKENS,
    MODEL,
    OPENROUTER_BASE_URL,
    build_system_prompt,
    load_chunks,
)

QUESTIONS = [
    "What is the project about?",
    "What tools does the Asklepios agent use?",
    "What were the findings of the PESTEL analysis?",
    "What ethical concerns are discussed in the synopsis?",
    "What model powers the Asklepios agent?",
    "What was the biggest challenge the team faced?",
    "How did the architecture change between Prototype I and II?",
    "What is the hallucination rate mentioned in the results?",
    "Who is the primary persona?",
    "What does the author recommend in the conclusion?",
]

CITATION_RE = re.compile(r"\(p+\.\s*\d+", re.IGNORECASE)
REFUSAL_RE = re.compile(
    r"do(es)? not contain|not (found|present|included|mentioned|discussed|available|described)"
    r"|no (information|details?|mention|section|content|data)"
    r"|cannot (find|answer|determine)|not (in|part of) (the )?(document|excerpt|synopsis)",
    re.IGNORECASE,
)


def has_citation(text: str) -> bool:
    return bool(CITATION_RE.search(text))


def is_grounded_refusal(text: str) -> bool:
    return bool(REFUSAL_RE.search(text))


def ask(client: OpenAI, system_prompt: str, question: str) -> tuple[str, float]:
    start = time.perf_counter()
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ],
    )
    elapsed = round(time.perf_counter() - start, 2)
    answer = response.choices[0].message.content or ""
    return answer, elapsed


def main():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Error: OPENROUTER_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    chunks = load_chunks(CHUNKS_FILE)
    system_prompt = build_system_prompt(chunks)
    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    results = []
    print(f"Running {len(QUESTIONS)} test questions...\n")

    for i, question in enumerate(QUESTIONS, 1):
        print(f"[{i:02d}/{len(QUESTIONS)}] {question}")
        answer, elapsed = ask(client, system_prompt, question)
        non_empty = bool(answer.strip())
        cited = has_citation(answer)
        refusal = non_empty and not cited and is_grounded_refusal(answer)
        passed = non_empty and (cited or refusal)
        outcome = "GROUNDED_REFUSAL" if refusal else ("PASS" if passed else "FAIL")
        print(f"       {outcome} ({elapsed}s)\n")

        results.append(
            {
                "id": i,
                "question": question,
                "answer": answer,
                "response_time_seconds": elapsed,
                "outcome": outcome,
                "pass": passed,
            }
        )

    with open("test_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    # Summary
    n = len(results)
    n_pass = sum(1 for r in results if r["outcome"] == "PASS")
    n_refusal = sum(1 for r in results if r["outcome"] == "GROUNDED_REFUSAL")
    n_fail = sum(1 for r in results if r["outcome"] == "FAIL")
    avg_time = round(sum(r["response_time_seconds"] for r in results) / n, 2)

    print("=" * 50)
    print(f"Results saved to test_results.json")
    print(f"PASS: {n_pass}/{n}   GROUNDED_REFUSAL: {n_refusal}/{n}   FAIL: {n_fail}/{n}")
    print(f"Avg response time: {avg_time}s")
    print("=" * 50)

    if n_fail:
        print("\nFailed questions:")
        for r in results:
            if r["outcome"] == "FAIL":
                reason = "empty answer" if not r["answer"].strip() else "no page citation, no refusal phrase"
                print(f"  [{r['id']:02d}] {r['question']}")
                print(f"       Reason: {reason}")


if __name__ == "__main__":
    main()
