import { useState, useRef, useEffect } from "react";

const CHUNKS = [
  { id: 0, page: 1, section: "Preamble", content_type: "slide", text: "[Visual slide on page 1 — image or diagram content not extracted]" },
  { id: 1, page: 2, section: "1. Introduction", content_type: "text", text: "This document provides a comprehensive synopsis of the proposed research project.\nThe project aims to develop a novel AI-driven pipeline for automated document\nanalysis and knowledge extraction from scientific literature.\nBackground and motivation are described in the following subsections. The primary\nobjective is to reduce manual review time by 70% while maintaining extraction\naccuracy above 95%. Secondary objectives include building a reusable toolkit that\ncan be adapted for multiple document domains including clinical trials, patent\nfilings, and regulatory submissions." },
  { id: 2, page: 2, section: "1.1 Motivation", content_type: "text", text: "Manual review of large document corpora is both time-consuming and error-prone.\nRecent advances in large language models have made it feasible to automate\nsignificant portions of this process. This project builds on those advances\nby providing structured extraction with human-in-the-loop validation.\nThe economic impact of such automation is estimated at 3-5 million EUR annually\nfor a mid-sized pharmaceutical organization." },
  { id: 3, page: 3, section: "1.1 Motivation", content_type: "slide", text: "[Visual slide on page 3 — image or diagram content not extracted]" },
  { id: 4, page: 4, section: "2. Methodology", content_type: "text", text: "The methodology is divided into three main phases: data ingestion, AI-assisted\nextraction, and human validation. Each phase is described below." },
  { id: 5, page: 4, section: "2.1 Data Ingestion", content_type: "text", text: "Source documents are ingested as PDFs. Pages are classified as text-heavy or\nvisual (slides/figures) using character-count heuristics on the raw extracted\ntext. Text pages undergo full extraction via pdfplumber; visual pages receive\na structured placeholder noting their position and type.\nSection headings following the pattern 'N. Title' or 'N.N Title' are detected\nusing regular expressions. Content is then chunked by section into segments\nof approximately 500 to 800 tokens to ensure compatibility with LLM context\nwindow constraints and maximize retrieval relevance in downstream RAG pipelines." },
  { id: 6, page: 4, section: "2.2 AI-Assisted Extraction", content_type: "text", text: "Each chunk is passed to an LLM with a structured extraction prompt requesting\nJSON output following a predefined schema. The schema captures entities such as\nobjectives, methods, datasets, metrics, and conclusions. Chain-of-thought\nprompting is used to improve precision on ambiguous passages." },
  { id: 7, page: 4, section: "2.3 Human Validation", content_type: "text", text: "Extracted data undergoes a two-stage review: automated consistency checks\nfollowed by domain-expert spot-checking. Discrepancies are flagged for\nresolution and fed back into the prompt tuning loop." },
  { id: 8, page: 5, section: "3. Expected Outcomes", content_type: "text", text: "The project is expected to deliver the following outcomes by Q4 2026:\n- A production-ready ingestion pipeline capable of handling PDFs up to 300 pages.\n- A structured extraction module with configurable output schemas.\n- A validation dashboard for human reviewers.\n- A benchmark dataset of 500 annotated synopses for future model evaluation." },
  { id: 9, page: 5, section: "3.1 Risk Assessment", content_type: "text", text: "Primary risks include variability in PDF formatting across document sources,\nhallucination in LLM outputs for ambiguous content, and delays in expert\navailability for validation phases. Mitigation strategies are described in\nthe project risk register (Appendix B)." },
];

const MODEL = "anthropic/claude-sonnet-4-5";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOKENS = 1024;
const API_KEY = "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";

const STARTERS = [
  "What is this about?",
  "What tools were used?",
  "What ethical issues are discussed?",
];

// Build system prompt with all chunks
function buildSystemPrompt() {
  const body = CHUNKS.map(
    (c) => `[Page ${c.page} | Section: ${c.section} | Type: ${c.content_type}]\n${c.text}`
  ).join("\n\n");
  return `You are a Synopsis Expert. Your sole knowledge base is the document excerpts provided below. Answer every question strictly using information from these excerpts.

Rules:
- Always cite the page number(s) your answer draws from, e.g. "(p. 2)".
- If the answer spans multiple pages, cite each one.
- If a passage comes from a visual/slide page (Type: slide), note that it is a visual element and no detailed text was extracted.
- If the document does not contain enough information to answer, say so explicitly — do not invent facts.
- Keep answers concise and factual.

--- DOCUMENT CONTENT ---

${body}

--- END OF DOCUMENT ---`;
}

// Extract unique page numbers cited in the reply, return matching chunks
function sourcesFromReply(text) {
  const matches = [...text.matchAll(/\(pp?\.\s*(\d+)(?:[–-](\d+))?\)/g)];
  const pages = new Set();
  for (const m of matches) {
    const start = parseInt(m[1]);
    const end = m[2] ? parseInt(m[2]) : start;
    for (let p = start; p <= end; p++) pages.add(p);
  }
  if (pages.size === 0) return [];
  // Deduplicate by section+page (one card per chunk)
  const seen = new Set();
  return CHUNKS.filter((c) => {
    if (!pages.has(c.page)) return false;
    const key = `${c.page}-${c.section}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Highlight (p. N) citations as badges inline
function renderWithCitations(text) {
  const parts = text.split(/(\(pp?\.\s*\d+(?:[–-]\d+)?\))/g);
  return parts.map((part, i) =>
    /^\(pp?\.\s*\d+/.test(part)
      ? <span key={i} style={s.badge}>{part}</span>
      : part
  );
}

// Collapsible sources panel shown beneath agent replies
function Sources({ chunks }) {
  const [open, setOpen] = useState(false);
  if (chunks.length === 0) return null;
  return (
    <div style={s.sourcesWrap}>
      <button style={s.sourcesToggle} onClick={() => setOpen((v) => !v)}>
        <span style={s.sourcesIcon}>{open ? "▾" : "▸"}</span>
        Sources ({chunks.length})
      </button>
      {open && (
        <div style={s.sourcesList}>
          {chunks.map((c) => (
            <div key={c.id} style={s.sourceCard}>
              <div style={s.sourceHeader}>
                <span style={s.sourcePage}>p. {c.page}</span>
                <span style={s.sourceSection}>{c.section}</span>
                {c.content_type === "slide" && (
                  <span style={s.sourceSlideTag}>slide</span>
                )}
              </div>
              <p style={s.sourceText}>
                {c.text.replace(/\n/g, " ").slice(0, 160)}
                {c.text.length > 160 ? "…" : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={s.spinnerWrap}>
      <div style={s.spinner} />
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  const sources = isUser ? [] : sourcesFromReply(msg.content);
  return (
    <div style={{ ...s.bubbleRow, justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && <div style={s.avatar}>AI</div>}
      <div style={s.bubbleCol}>
        <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : s.bubbleAgent) }}>
          {isUser ? msg.content : renderWithCitations(msg.content)}
        </div>
        {!isUser && <Sources chunks={sources} />}
      </div>
      {isUser && <div style={{ ...s.avatar, ...s.avatarUser }}>You</div>}
    </div>
  );
}

export default function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text) {
    const question = text.trim();
    if (!question || loading) return;
    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "system", content: buildSystemPrompt() }, ...nextMessages],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ?? "(no response)";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  return (
    <div style={s.app}>
      <header style={s.header}>
        <span style={s.headerTitle}>Synopsis Q&amp;A Agent</span>
      </header>

      <div style={s.chat}>
        {messages.length === 0 && (
          <div style={s.empty}>
            <p style={s.emptyTitle}>Ask anything about the synopsis</p>
            <div style={s.starters}>
              {STARTERS.map((q) => (
                <button key={q} style={s.starterBtn} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

        {loading && (
          <div style={{ ...s.bubbleRow, justifyContent: "flex-start" }}>
            <div style={s.avatar}>AI</div>
            <div style={{ ...s.bubble, ...s.bubbleAgent }}><Spinner /></div>
          </div>
        )}

        {error && <div style={s.error}>⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputBar}>
        <textarea
          style={s.textarea}
          placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button
          style={{ ...s.sendBtn, opacity: input.trim() && !loading ? 1 : 0.4, cursor: input.trim() && !loading ? "pointer" : "default" }}
          disabled={!input.trim() || loading}
          onClick={() => send(input)}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const s = {
  app: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", background: "#f5f5f5" },
  header: { display: "flex", alignItems: "center", padding: "0 20px", height: 56, background: "#1a1a2e", color: "#fff", flexShrink: 0 },
  headerTitle: { fontSize: 17, fontWeight: 600, letterSpacing: 0.2 },
  chat: { flex: 1, overflowY: "auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 16, background: "#fff" },
  bubbleRow: { display: "flex", alignItems: "flex-start", gap: 8 },
  bubbleCol: { display: "flex", flexDirection: "column", gap: 4, maxWidth: "72%" },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "#1a1a2e", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  avatarUser: { background: "#4f46e5", fontSize: 9 },
  bubble: { padding: "10px 14px", borderRadius: 16, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  bubbleUser: { background: "#4f46e5", color: "#fff", borderBottomRightRadius: 4 },
  bubbleAgent: { background: "#f0f0f5", color: "#1a1a2e", borderBottomLeftRadius: 4 },
  badge: { display: "inline-block", background: "#e0e7ff", color: "#3730a3", borderRadius: 4, padding: "1px 6px", fontSize: 12, fontWeight: 600, margin: "0 2px" },
  // Sources
  sourcesWrap: { display: "flex", flexDirection: "column", gap: 4 },
  sourcesToggle: { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#4b5563", cursor: "pointer", fontFamily: "inherit" },
  sourcesIcon: { fontSize: 10 },
  sourcesList: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 },
  sourceCard: { background: "#f8f8fc", border: "1px solid #e0e0f0", borderRadius: 8, padding: "8px 12px" },
  sourceHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 },
  sourcePage: { background: "#1a1a2e", color: "#fff", borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 700 },
  sourceSection: { fontSize: 12, fontWeight: 600, color: "#374151" },
  sourceSlideTag: { background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 600 },
  sourceText: { fontSize: 12, color: "#6b7280", lineHeight: 1.5, margin: 0 },
  // Spinner
  spinnerWrap: { display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 0" },
  spinner: { width: 18, height: 18, border: "2px solid #c7c7d4", borderTopColor: "#4f46e5", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  // Input
  inputBar: { display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #e5e5ea", background: "#fff", flexShrink: 0 },
  textarea: { flex: 1, resize: "none", border: "1px solid #d1d5db", borderRadius: 10, padding: "9px 12px", fontSize: 14, fontFamily: "inherit", outline: "none", lineHeight: 1.5 },
  sendBtn: { background: "#4f46e5", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 14, fontWeight: 600, transition: "opacity 0.15s", alignSelf: "flex-end" },
  error: { color: "#dc2626", fontSize: 13, padding: "6px 12px", background: "#fef2f2", borderRadius: 8, alignSelf: "center" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 40 },
  emptyTitle: { color: "#6b7280", fontSize: 15, margin: 0 },
  starters: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  starterBtn: { background: "#f0f0f5", border: "1px solid #d1d5db", borderRadius: 20, padding: "8px 16px", fontSize: 13, color: "#1a1a2e", cursor: "pointer" },
};

if (typeof document !== "undefined" && !document.getElementById("chat-spin-style")) {
  const el = document.createElement("style");
  el.id = "chat-spin-style";
  el.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(el);
}
