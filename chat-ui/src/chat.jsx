import { useState, useRef, useEffect, useCallback, useMemo } from "react";

// ─── Sample document (fallback when nothing is uploaded) ───────────────────────
const SAMPLE_CHUNKS = [
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
const SAMPLE_DOC_NAME = "sample_synopsis.pdf";

// ─── Config ────────────────────────────────────────────────────────────────────
const CHAT_URL = "/api/chat";

const STARTERS = [
  "What is this project about?",
  "What methods were used?",
  "What are the expected outcomes?",
  "What risks are mentioned?",
];

const THINKING = [
  "Squinting at your PDF…",
  "Bribing the neural networks…",
  "Definitely not making this up…",
  "Having a small existential crisis…",
  "Consulting my imaginary colleague…",
  "Speed-reading 47 pages at once…",
  "Asking the document nicely…",
  "Cross-referencing with vibes…",
  "Summoning document demons…",
  "Pretending I understood that…",
  "Re-reading it 3 more times…",
  "Overthinking it, brb…",
  "Channeling my inner librarian…",
  "Whispering sweet nothings to the tokens…",
  "Reorganizing my entire worldview…",
  "Arguing with myself about this…",
  "Absolutely not panicking…",
  "Almost there. Probably…",
  "Running it through the vibe-o-meter…",
  "Checking if the answer is 42…",
  "Asking my rubber duck…",
  "Diplomatically ignoring my uncertainty…",
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function buildSystemPrompt(chunks) {
  const body = chunks
    .map((c) => `[Page ${c.page} | Section: ${c.section} | Type: ${c.content_type}]\n${c.text}`)
    .join("\n\n");
  return `You are a Synopsis Expert. Your sole knowledge base is the document excerpts provided below. Answer every question strictly using information from these excerpts.

Rules:
- Always cite the page number(s) your answer draws from, e.g. "(p. 2)".
- If the answer spans multiple pages, cite each one.
- If a passage comes from a visual/slide page (Type: slide or slide_described), say it is from a visual element.
- If the document does not contain enough information to answer, say so explicitly — do not invent facts.
- Keep answers concise and factual.

--- DOCUMENT CONTENT ---

${body}

--- END OF DOCUMENT ---`;
}

function sourcesFromReply(text, chunks) {
  const matches = [...text.matchAll(/\(pp?\.\s*(\d+)(?:[–-](\d+))?\)/g)];
  const pages = new Set();
  for (const m of matches) {
    const start = parseInt(m[1]);
    const end = m[2] ? parseInt(m[2]) : start;
    for (let p = start; p <= end; p++) pages.add(p);
  }
  if (pages.size === 0) return [];
  const seen = new Set();
  return chunks.filter((c) => {
    if (!pages.has(c.page)) return false;
    const key = `${c.page}-${c.section}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderWithCitations(text) {
  const parts = text.split(/(\(pp?\.\s*\d+(?:[–-]\d+)?\))/g);
  return parts.map((part, i) =>
    /^\(pp?\.\s*\d+/.test(part)
      ? <span key={i} style={s.badge}>{part}</span>
      : part
  );
}

// ─── Thinking bubble ───────────────────────────────────────────────────────────
function ThinkingBubble() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * THINKING.length));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx((i) => (i + 1) % THINKING.length); setVisible(true); }, 350);
    }, 2200);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={s.thinkingWrap}>
      <div style={s.dots}>
        <span style={{ ...s.dot, animationDelay: "0s" }} />
        <span style={{ ...s.dot, animationDelay: "0.18s" }} />
        <span style={{ ...s.dot, animationDelay: "0.36s" }} />
      </div>
      <span style={{ ...s.thinkingText, opacity: visible ? 1 : 0 }}>{THINKING[idx]}</span>
    </div>
  );
}

// ─── Sources panel ─────────────────────────────────────────────────────────────
function Sources({ text, chunks }) {
  const [open, setOpen] = useState(false);
  const srcs = useMemo(() => sourcesFromReply(text, chunks), [text, chunks]);
  if (srcs.length === 0) return null;
  return (
    <div style={s.sourcesWrap}>
      <button style={s.sourcesToggle} onClick={() => setOpen((v) => !v)}>
        <span style={s.chevron}>{open ? "▾" : "▸"}</span>
        Sources ({srcs.length})
      </button>
      {open && (
        <div style={s.sourcesList}>
          {srcs.map((c) => (
            <div key={c.id} style={s.sourceCard}>
              <div style={s.sourceHeader}>
                <span style={s.sourcePage}>p. {c.page}</span>
                <span style={s.sourceSection}>{c.section}</span>
                {(c.content_type === "slide" || c.content_type === "slide_described") && (
                  <span style={s.slideTag}>
                    {c.content_type === "slide_described" ? "slide (AI described)" : "slide"}
                  </span>
                )}
              </div>
              <p style={s.sourceText}>
                {c.text.replace(/\n/g, " ").slice(0, 180)}{c.text.length > 180 ? "…" : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, chunks }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ ...s.bubbleRow, justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && (
        <div style={s.avatar}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
          </svg>
        </div>
      )}
      <div style={s.bubbleCol}>
        <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : s.bubbleAgent) }}>
          {isUser ? msg.content : renderWithCitations(msg.content)}
        </div>
        {!isUser && msg.content && <Sources text={msg.content} chunks={chunks} />}
      </div>
      {isUser && (
        <div style={{ ...s.avatar, ...s.avatarUser }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Upload area ───────────────────────────────────────────────────────────────
function UploadArea({ onChunks, onDocName, compact }) {
  const fileRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | uploading | done | error
  const [errMsg, setErrMsg] = useState("");
  const [dragging, setDragging] = useState(false);

  async function processFile(file) {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("error");
      setErrMsg("Please select a PDF file");
      return;
    }
    setStatus("uploading");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }
      const chunks = await res.json();
      onChunks(chunks);
      onDocName(file.name);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrMsg(e.message.includes("fetch") ? "Backend not running — start server.py first" : e.message);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }

  if (compact) {
    return (
      <div style={s.uploadCompact}>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => processFile(e.target.files?.[0])} />
        <button
          style={{ ...s.uploadCompactBtn, ...(status === "uploading" ? s.uploadCompactBtnBusy : {}) }}
          onClick={() => { setStatus("idle"); fileRef.current?.click(); }}
          disabled={status === "uploading"}
          title="Upload a PDF synopsis"
        >
          {status === "uploading"
            ? <><Spin size={12} /> Analyzing…</>
            : status === "done"
            ? <><CheckIcon /> Loaded</>
            : <><UploadIcon /> Upload PDF</>}
        </button>
        {status === "error" && <span style={s.uploadErrInline}>{errMsg}</span>}
      </div>
    );
  }

  return (
    <div
      style={{ ...s.dropZone, ...(dragging ? s.dropZoneDrag : {}) }}
      onClick={() => { setStatus("idle"); fileRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => processFile(e.target.files?.[0])} />
      {status === "uploading" ? (
        <>
          <Spin size={28} color="#6366f1" />
          <span style={s.dropTitle}>Analyzing slides with AI vision…</span>
          <span style={s.dropSub}>This may take a moment for image-heavy PDFs</span>
        </>
      ) : status === "done" ? (
        <>
          <CheckIcon size={28} color="#4ade80" />
          <span style={{ ...s.dropTitle, color: "#4ade80" }}>Document loaded</span>
          <span style={s.dropSub}>Click to swap to a different PDF</span>
        </>
      ) : status === "error" ? (
        <>
          <span style={{ fontSize: 28 }}>⚠</span>
          <span style={{ ...s.dropTitle, color: "#f87171" }}>{errMsg}</span>
          <span style={s.dropSub}>Click to try again</span>
        </>
      ) : (
        <>
          <CloudIcon />
          <span style={s.dropTitle}>Drop your synopsis PDF here</span>
          <span style={s.dropSub}>or click to browse · slides will be described by AI</span>
        </>
      )}
    </div>
  );
}

// ─── Voice hook ────────────────────────────────────────────────────────────────
function useSpeech(onResult) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef(null);
  const cbRef = useRef(onResult);
  useEffect(() => { cbRef.current = onResult; });

  const supported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (recording) { recRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => cbRef.current(e.results[0][0].transcript);
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }, [recording, supported]);

  return { recording, toggle, supported };
}

// ─── Small icon components ─────────────────────────────────────────────────────
function Spin({ size = 16, color = "#8888aa" }) {
  return (
    <span style={{ display: "inline-block", width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
  );
}
function CloudIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function CheckIcon({ size = 13, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Main app ──────────────────────────────────────────────────────────────────
export default function ChatApp() {
  const [chunks, setChunks] = useState(SAMPLE_CHUNKS);
  const [docName, setDocName] = useState(SAMPLE_DOC_NAME);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);   // awaiting first token
  const [streaming, setStreaming] = useState(false); // tokens arriving
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const systemPrompt = useMemo(() => buildSystemPrompt(chunks), [chunks]);
  const busy = pending || streaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const send = useCallback(async (text) => {
    const q = text.trim();
    if (!q || busy) return;

    const nextMessages = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError("");

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, system: systemPrompt }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      // First byte arrived — switch from "pending" to "streaming"
      setPending(false);
      setStreaming(true);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { reader.cancel(); break outer; }
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: full };
                return copy;
              });
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch (e) {
      setPending(false);
      setError(e.message);
      // Remove any empty assistant bubble from a failed stream
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last?.role === "assistant" && !last.content ? prev.slice(0, -1) : prev;
      });
    } finally {
      setPending(false);
      setStreaming(false);
    }
  }, [messages, busy, systemPrompt]);

  function handleNewDoc(newChunks) {
    setChunks(newChunks);
    setMessages([]);
    setError("");
  }

  const onVoiceResult = useCallback((text) => {
    setInput(text);
    setTimeout(() => send(text), 400);
  }, [send]);

  const { recording, toggle: toggleMic, supported: micSupported } = useSpeech(onVoiceResult);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  return (
    <div style={s.app}>
      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.headerLeft}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
          </svg>
          <span style={s.headerTitle}>Synopsis Expert</span>
          {docName && (
            <span style={s.docPill} title={docName}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
              </svg>
              {docName.length > 28 ? docName.slice(0, 25) + "…" : docName}
            </span>
          )}
        </div>
        <UploadArea compact onChunks={handleNewDoc} onDocName={setDocName} />
      </header>

      {/* ── Chat ── */}
      <div style={s.chat}>
        {messages.length === 0 && !pending && (
          <div style={s.empty}>
            <div style={s.emptyIcon}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
              </svg>
            </div>
            <p style={s.emptyTitle}>Ask me anything about the synopsis</p>
            <p style={s.emptySub}>Type or speak below · or upload your own PDF first</p>
            <UploadArea onChunks={handleNewDoc} onDocName={setDocName} />
            <div style={s.starterRow}>
              {STARTERS.map((q) => (
                <button key={q} style={s.starterBtn} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Bubble key={i} msg={msg} chunks={chunks} />
        ))}

        {pending && (
          <div style={{ ...s.bubbleRow, justifyContent: "flex-start" }}>
            <div style={s.avatar}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
              </svg>
            </div>
            <div style={{ ...s.bubble, ...s.bubbleAgent, padding: "12px 16px" }}>
              <ThinkingBubble />
            </div>
          </div>
        )}

        {error && <div style={s.error}>⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div style={s.inputBar}>
        <div style={s.inputWrap}>
          <textarea
            ref={textareaRef}
            style={s.textarea}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={busy}
          />
          <div style={s.inputActions}>
            {micSupported && (
              <button
                style={{ ...s.iconBtn, ...(recording ? s.iconBtnRec : {}) }}
                onClick={toggleMic}
                title={recording ? "Stop recording" : "Speak your question"}
                disabled={busy && !recording}
              >
                {recording
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                }
              </button>
            )}
            <button
              style={{ ...s.sendBtn, opacity: input.trim() && !busy ? 1 : 0.3 }}
              disabled={!input.trim() || busy}
              onClick={() => send(input)}
              title="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
        {recording && (
          <div style={s.recBanner}>
            <span style={s.recDot} /> Listening… speak your question
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = {
  app: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", background: "#0f0f1a" },

  header: { flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", height: 54, borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(15,15,26,0.97)", backdropFilter: "blur(8px)" },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#e8e8f0", letterSpacing: 0.2 },
  docPill: { display: "flex", alignItems: "center", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 12, padding: "2px 9px", fontSize: 11, color: "#a5b4fc", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  chat: { flex: 1, overflowY: "auto", padding: "28px 16px 16px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 800, width: "100%", margin: "0 auto", alignSelf: "center", boxSizing: "border-box" },

  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, paddingBottom: 40, textAlign: "center" },
  emptyIcon: { width: 70, height: 70, borderRadius: "50%", background: "rgba(99,102,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#c8c8e0", fontSize: 18, fontWeight: 600, margin: 0 },
  emptySub: { color: "#4a4a6a", fontSize: 13, margin: 0 },
  starterRow: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4 },
  starterBtn: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "7px 15px", fontSize: 13, color: "#9090b8", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" },

  dropZone: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, border: "1.5px dashed rgba(99,102,241,0.35)", borderRadius: 14, padding: "22px 32px", cursor: "pointer", background: "rgba(99,102,241,0.04)", transition: "all 0.2s", maxWidth: 380, width: "100%" },
  dropZoneDrag: { borderColor: "#6366f1", background: "rgba(99,102,241,0.1)" },
  dropTitle: { fontSize: 14, fontWeight: 600, color: "#b0b0d0", margin: 0 },
  dropSub: { fontSize: 12, color: "#4a4a6a", margin: 0 },

  uploadCompact: { display: "flex", alignItems: "center", gap: 8 },
  uploadCompactBtn: { display: "flex", alignItems: "center", gap: 6, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "5px 12px", fontSize: 12, color: "#a5b4fc", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" },
  uploadCompactBtnBusy: { opacity: 0.6 },
  uploadErrInline: { fontSize: 11, color: "#f87171", maxWidth: 200 },

  bubbleRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  bubbleCol: { display: "flex", flexDirection: "column", gap: 6, maxWidth: "78%" },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: "#1e1e38", color: "#a5b4fc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, border: "1px solid rgba(165,180,252,0.18)" },
  avatarUser: { background: "#312e81", color: "#c7d2fe", border: "1px solid rgba(199,210,254,0.18)" },
  bubble: { padding: "11px 15px", borderRadius: 18, fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  bubbleUser: { background: "#4338ca", color: "#eef2ff", borderBottomRightRadius: 4 },
  bubbleAgent: { background: "#16162a", color: "#dcdcf0", borderBottomLeftRadius: 4, border: "1px solid rgba(255,255,255,0.06)" },
  badge: { display: "inline-block", background: "rgba(99,102,241,0.22)", color: "#a5b4fc", borderRadius: 4, padding: "1px 7px", fontSize: 12, fontWeight: 600, margin: "0 2px" },

  thinkingWrap: { display: "flex", alignItems: "center", gap: 10, minWidth: 200 },
  dots: { display: "flex", gap: 4, flexShrink: 0 },
  dot: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#6366f1", animation: "bounce 1s infinite ease-in-out" },
  thinkingText: { fontSize: 13, color: "#7070a0", fontStyle: "italic", transition: "opacity 0.35s ease", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 },

  sourcesWrap: { display: "flex", flexDirection: "column", gap: 4 },
  sourcesToggle: { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#5a5a8a", cursor: "pointer", fontFamily: "inherit" },
  chevron: { fontSize: 9 },
  sourcesList: { display: "flex", flexDirection: "column", gap: 6 },
  sourceCard: { background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 12px" },
  sourceHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" },
  sourcePage: { background: "#312e81", color: "#c7d2fe", borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 700 },
  sourceSection: { fontSize: 12, fontWeight: 600, color: "#8080a8" },
  slideTag: { background: "rgba(251,191,36,0.12)", color: "#fbbf24", borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 600 },
  sourceText: { fontSize: 12, color: "#55557a", lineHeight: 1.5, margin: 0 },

  inputBar: { flexShrink: 0, padding: "10px 16px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0f0f1a", maxWidth: 800, width: "100%", margin: "0 auto", alignSelf: "center", boxSizing: "border-box" },
  inputWrap: { display: "flex", alignItems: "flex-end", gap: 8, background: "#191930", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: "8px 10px 8px 14px" },
  textarea: { flex: 1, resize: "none", border: "none", background: "transparent", padding: 0, fontSize: 14, fontFamily: "inherit", outline: "none", lineHeight: 1.55, color: "#e8e8f0", maxHeight: 160, overflowY: "auto" },
  inputActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingBottom: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", color: "#7070a0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", flexShrink: 0 },
  iconBtnRec: { background: "rgba(239,68,68,0.18)", borderColor: "rgba(239,68,68,0.5)", color: "#f87171" },
  sendBtn: { width: 34, height: 34, borderRadius: "50%", border: "none", background: "#4338ca", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "opacity 0.15s" },
  recBanner: { display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 12, color: "#f87171" },
  recDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" },

  error: { color: "#f87171", fontSize: 13, padding: "8px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)", alignSelf: "center", maxWidth: 480, textAlign: "center" },
};

if (typeof document !== "undefined" && !document.getElementById("chat-kf")) {
  const el = document.createElement("style");
  el.id = "chat-kf";
  el.textContent = `
    @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.3} 40%{transform:translateY(-6px);opacity:1} }
    @keyframes pulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.7)} }
    @keyframes spin   { to{transform:rotate(360deg)} }
    textarea::placeholder { color:#35355a }
    button:hover:not(:disabled) { filter:brightness(1.18) }
    ::-webkit-scrollbar { width:5px } ::-webkit-scrollbar-track { background:transparent } ::-webkit-scrollbar-thumb { background:#2a2a4a; border-radius:3px }
  `;
  document.head.appendChild(el);
}
