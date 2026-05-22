#!/usr/bin/env python3
"""Generate a sample_synopsis.pdf for testing the ingest pipeline."""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

W, H = A4

def page_text(c, lines, fontsize=11, y_start=750):
    c.setFont("Helvetica", fontsize)
    y = y_start
    for line in lines:
        c.drawString(50, y, line)
        y -= fontsize + 4
    return y


def main():
    out = "sample_synopsis.pdf"
    c = canvas.Canvas(out, pagesize=A4)

    # Page 1 — cover / slide (sparse text)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(W / 2, H / 2 + 40, "Project Synopsis")
    c.setFont("Helvetica", 14)
    c.drawCentredString(W / 2, H / 2, "Confidential Draft — 2026")
    c.showPage()

    # Page 2 — section 1 (text)
    lines2 = [
        "1. Introduction",
        "",
        "This document provides a comprehensive synopsis of the proposed research project.",
        "The project aims to develop a novel AI-driven pipeline for automated document",
        "analysis and knowledge extraction from scientific literature.",
        "",
        "Background and motivation are described in the following subsections. The primary",
        "objective is to reduce manual review time by 70% while maintaining extraction",
        "accuracy above 95%. Secondary objectives include building a reusable toolkit that",
        "can be adapted for multiple document domains including clinical trials, patent",
        "filings, and regulatory submissions.",
        "",
        "1.1 Motivation",
        "",
        "Manual review of large document corpora is both time-consuming and error-prone.",
        "Recent advances in large language models have made it feasible to automate",
        "significant portions of this process. This project builds on those advances",
        "by providing structured extraction with human-in-the-loop validation.",
        "The economic impact of such automation is estimated at 3-5 million EUR annually",
        "for a mid-sized pharmaceutical organization.",
    ]
    page_text(c, lines2)
    c.showPage()

    # Page 3 — slide (diagram, very sparse text so char count < 50)
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(W / 2, H / 2, "Fig 1")
    c.showPage()

    # Page 4 — section 2 (text)
    lines4 = [
        "2. Methodology",
        "",
        "The methodology is divided into three main phases: data ingestion, AI-assisted",
        "extraction, and human validation. Each phase is described below.",
        "",
        "2.1 Data Ingestion",
        "",
        "Source documents are ingested as PDFs. Pages are classified as text-heavy or",
        "visual (slides/figures) using character-count heuristics on the raw extracted",
        "text. Text pages undergo full extraction via pdfplumber; visual pages receive",
        "a structured placeholder noting their position and type.",
        "",
        "Section headings following the pattern 'N. Title' or 'N.N Title' are detected",
        "using regular expressions. Content is then chunked by section into segments",
        "of approximately 500 to 800 tokens to ensure compatibility with LLM context",
        "window constraints and maximize retrieval relevance in downstream RAG pipelines.",
        "",
        "2.2 AI-Assisted Extraction",
        "",
        "Each chunk is passed to an LLM with a structured extraction prompt requesting",
        "JSON output following a predefined schema. The schema captures entities such as",
        "objectives, methods, datasets, metrics, and conclusions. Chain-of-thought",
        "prompting is used to improve precision on ambiguous passages.",
        "",
        "2.3 Human Validation",
        "",
        "Extracted data undergoes a two-stage review: automated consistency checks",
        "followed by domain-expert spot-checking. Discrepancies are flagged for",
        "resolution and fed back into the prompt tuning loop.",
    ]
    page_text(c, lines4)
    c.showPage()

    # Page 5 — section 3 (text)
    lines5 = [
        "3. Expected Outcomes",
        "",
        "The project is expected to deliver the following outcomes by Q4 2026:",
        "",
        "  - A production-ready ingestion pipeline capable of handling PDFs up to 300 pages.",
        "  - A structured extraction module with configurable output schemas.",
        "  - A validation dashboard for human reviewers.",
        "  - A benchmark dataset of 500 annotated synopses for future model evaluation.",
        "",
        "3.1 Risk Assessment",
        "",
        "Primary risks include variability in PDF formatting across document sources,",
        "hallucination in LLM outputs for ambiguous content, and delays in expert",
        "availability for validation phases. Mitigation strategies are described in",
        "the project risk register (Appendix B).",
    ]
    page_text(c, lines5)
    c.showPage()

    c.save()
    print(f"Written: {out}")


if __name__ == "__main__":
    main()
