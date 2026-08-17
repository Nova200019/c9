import { useState, useEffect, useRef, useCallback } from "react";
import "./ChatPage.scss";
import {
  streamChat, listThreads, deleteThread, getThread,
  getToolDownloadUrl,
  ChatThread, ChatMessage, ToolResult,
} from "../../api/chatAPI";
import axiosInstance from "../../axiosInterceptor";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

// ── Icon helpers ──────────────────────────────────────────────────────────────
const icons = {
  sparkle: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  attach: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
  folder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
  email: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  chat: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>,
};

// ── Markdown renderer (simple but functional) ─────────────────────────────────
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<div class="code-block-wrapper"><button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)">Copy</button><pre><code class="language-${lang}">${code.trim()}</code></pre></div>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^---+$/gm, "<hr>")
    .replace(/^\* (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^(?!<[hupbcdo])(.+)$/gm, (line) => line ? `<p>${line}</p>` : "")
    .replace(/<p><\/p>/g, "");
}

// ── Welcome prompts ───────────────────────────────────────────────────────────
const WELCOME_PILLS = [
  { icon: "📧", text: "Write a professional email" },
  { icon: "📊", text: "Extract data from receipt → CSV" },
  { icon: "🎨", text: "Generate an image of a cityscape" },
  { icon: "💼", text: "Review my CV and give score" },
  { icon: "📅", text: "Schedule a meeting next Tuesday" },
  { icon: "💻", text: "Write a React component" },
  { icon: "📚", text: "Quiz me on machine learning" },
  { icon: "📝", text: "Summarize these documents" },
  { icon: "🎯", text: "Create a 90-day project plan" },
  { icon: "🔍", text: "Research competitors for my product" },
];

// ── Tool icons map ────────────────────────────────────────────────────────────
function getToolIcon(toolName: string): { icon: string; cls: string } {
  if (toolName.includes("csv") || toolName.includes("extract")) return { icon: "📊", cls: "csv" };
  if (toolName.includes("image")) return { icon: "🎨", cls: "image" };
  if (toolName.includes("calendar")) return { icon: "📅", cls: "calendar" };
  if (toolName.includes("plan")) return { icon: "🎯", cls: "plan" };
  if (toolName.includes("email")) return { icon: "📧", cls: "email" };
  if (toolName.includes("coach") || toolName.includes("job")) return { icon: "💼", cls: "coach" };
  if (toolName.includes("tutor") || toolName.includes("quiz")) return { icon: "📚", cls: "plan" };
  return { icon: "✨", cls: "csv" };
}

// ── Tool Result Card ──────────────────────────────────────────────────────────
interface ToolCardProps {
  result: ToolResult;
  threadId: string;
  messageIndex: number;
  toolIndex: number;
}

function ToolResultCard({ result, threadId, messageIndex, toolIndex }: ToolCardProps) {
  const { icon, cls } = getToolIcon(result.toolName);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const data = result.data as Record<string, any>;

  const downloadUrl = result.downloadable
    ? getToolDownloadUrl(threadId, messageIndex, toolIndex)
    : null;

  return (
    <div className="tool-result-card">
      <div className="tool-result-card__header">
        <div className="tool-name">
          <div className={`tool-icon ${cls}`}>{icon}</div>
          {result.label || result.toolName}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {result.status === "success" ? "✓" : "✗"}
        </span>
      </div>

      <div className="tool-result-card__body">
        {/* CSV Preview */}
        {(result.toolName === "extract_structured") && data.headers && (
          <div className="csv-preview">
            <table>
              <thead>
                <tr>{data.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {(data.rows || []).slice(0, 8).map((row: string[], ri: number) => (
                  <tr key={ri}>{row.map((cell: string, ci: number) => <td key={ci}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {data.rows?.length > 8 && (
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                +{data.rows.length - 8} more rows (download for full data)
              </p>
            )}
          </div>
        )}

        {/* Plan Steps */}
        {result.toolName === "planner" && Array.isArray(data.steps) && data.steps.length > 0 && (
          <div className="plan-steps">
            {data.steps.map((step: any, i: number) => (
              <div className="plan-step" key={i}>
                <div className="step-num">{step.step || i + 1}</div>
                <div className="step-body">
                  <div className="step-title">{step.title}</div>
                  <div className="step-desc">{step.description}</div>
                  <div className="step-meta">
                    {step.duration && <span className="step-tag">{step.duration}</span>}
                    {step.priority && (
                      <span className={`step-tag step-priority ${step.priority}`}>{step.priority}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quiz */}
        {result.toolName === "tutor_quiz" && Array.isArray(data.questions) && (
          <div>
            {data.questions.map((q: any, qi: number) => (
              <div className="quiz-question" key={qi}>
                <div className="question-text">{qi + 1}. {q.question}</div>
                {q.options && (
                  <div className="question-options">
                    {q.options.map((opt: string, oi: number) => {
                      const letter = String.fromCharCode(65 + oi);
                      const answered = quizAnswers[qi];
                      const isCorrect = answered && q.answer?.startsWith(letter);
                      const isWrong = answered === letter && !isCorrect;
                      return (
                        <div
                          key={oi}
                          className={`question-option${answered ? (isCorrect ? " correct" : isWrong ? " wrong" : "") : ""}`}
                          onClick={() => !answered && setQuizAnswers(prev => ({ ...prev, [qi]: letter }))}
                        >
                          {letter}. {opt.replace(/^[A-D]\.\s*/, "")}
                        </div>
                      );
                    })}
                  </div>
                )}
                {quizAnswers[qi] && q.explanation && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    💡 {q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Image */}
        {result.toolName === "image_gen" && (
          <div className="image-preview">
            {data.imageBase64 ? (
              <img src={`data:image/png;base64,${data.imageBase64}`} alt="Generated" />
            ) : data.svgPlaceholder ? (
              <div className="svg-container" dangerouslySetInnerHTML={{ __html: data.svgPlaceholder }} />
            ) : null}
            {data.description && (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
                {data.description}
              </p>
            )}
            <p className="image-backend">
              Backend: {data.method || "description"} · Prompt: {(data.prompt || "").slice(0, 80)}
            </p>
          </div>
        )}

        {/* Job coach score */}
        {result.toolName === "job_coach" && data.score && (
          <div className={`score-badge ${data.score >= 8 ? "score-high" : data.score >= 5 ? "score-med" : "score-low"}`}>
            📊 CV Score: {data.score}/10 — {data.scoreLabel}
          </div>
        )}

        {/* Action items */}
        {Array.isArray(data.actionItems) && data.actionItems.length > 0 && (
          <div className="action-items">
            {data.actionItems.map((item: string, i: number) => (
              <div className="action-item" key={i}>{item}</div>
            ))}
          </div>
        )}

        {/* Calendar events */}
        {result.toolName === "calendar" && Array.isArray(data.events) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.events.map((ev: any, i: number) => (
              <div key={i} style={{ padding: "8px 10px", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neon-cyan)" }}>{ev.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {ev.startDate ? dayjs(ev.startDate).format("ddd D MMM, h:mm A") : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Email draft preview */}
        {result.toolName === "drafter_email" && data.subject && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Subject: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{data.subject}</span>
            </div>
            <pre style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap", margin: 0 }}>
              {String(data.body || "").slice(0, 300)}{String(data.body || "").length > 300 ? "..." : ""}
            </pre>
          </div>
        )}

        {/* Email send result */}
        {result.toolName === "email_send" && (
          <div style={{ fontSize: 13, color: data.error ? "#ef4444" : "var(--neon-green)" }}>
            {data.error ? `❌ ${data.error}` : `✅ Sent · ID: ${data.messageId}`}
          </div>
        )}
      </div>

      {(downloadUrl || (result.toolName === "drafter_email" && data.canSend)) && (
        <div className="tool-result-card__footer">
          {downloadUrl && (
            <a href={downloadUrl} download className="download-btn">
              {icons.download} Download {result.outputType?.toUpperCase() || "File"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Attachment Picker ─────────────────────────────────────────────────────────
interface AttachPickerProps {
  onClose: () => void;
  onConfirm: (selection: { fileIds: string[]; folderIds: string[]; labels: string[] }) => void;
}

function AttachmentPicker({ onClose, onConfirm }: AttachPickerProps) {
  const [files, setFiles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    axiosInstance.get("/file-service/list", { params: { parent: "/", limit: 100 } })
      .then((res: any) => setFiles(res.data?.fileList || []))
      .catch(() => {});
    axiosInstance.get("/folder-service/list", { params: { parent: "/", limit: 100 } })
      .then((res: any) => setFolders(res.data?.folderList || []))
      .catch(() => {});
  }, []);

  const filteredFiles = files.filter((f) => f.filename?.toLowerCase().includes(search.toLowerCase()));
  const filteredFolders = folders.filter((f) => f.name?.toLowerCase().includes(search.toLowerCase()));

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleFolder = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getMimeIcon = (mime: string) => {
    if (mime?.includes("pdf")) return "📄";
    if (mime?.includes("image")) return "🖼️";
    if (mime?.includes("video")) return "🎬";
    if (mime?.includes("audio")) return "🎵";
    if (mime?.includes("spreadsheet") || mime?.includes("csv")) return "📊";
    if (mime?.includes("word") || mime?.includes("document")) return "📝";
    if (mime?.includes("zip") || mime?.includes("rar")) return "📦";
    return "📁";
  };

  const totalSelected = selectedFileIds.size + selectedFolderIds.size;

  const handleConfirm = () => {
    const fileLabels = [...selectedFileIds].map((id) => files.find((f) => f._id === id)?.filename || id);
    const folderLabels = [...selectedFolderIds].map((id) => `📁 ${folders.find((f) => f._id === id)?.name || id}`);
    onConfirm({
      fileIds: [...selectedFileIds],
      folderIds: [...selectedFolderIds],
      labels: [...fileLabels, ...folderLabels],
    });
  };

  return (
    <div className="attachment-picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="attachment-picker">
        <div className="attachment-picker__header">
          <h3>📎 Attach Files from Cloud9</h3>
          <button className="close-picker" onClick={onClose}>{icons.close}</button>
        </div>

        <div className="attachment-picker__search">
          <input
            type="text"
            placeholder="Search files and folders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="attachment-picker__list">
          {filteredFolders.length > 0 && (
            <>
              <div className="thread-section-label">📁 Folders</div>
              {filteredFolders.map((folder) => (
                <div
                  key={folder._id}
                  className={`attachment-picker__item ${selectedFolderIds.has(folder._id) ? "selected" : ""}`}
                  onClick={() => toggleFolder(folder._id)}
                >
                  <div className="item-icon">📁</div>
                  <div className="item-info">
                    <div className="item-name">{folder.name}</div>
                    <div className="item-meta">Folder · all files included</div>
                  </div>
                  <div className={`item-check ${selectedFolderIds.has(folder._id) ? "checked" : ""}`}>
                    {selectedFolderIds.has(folder._id) && "✓"}
                  </div>
                </div>
              ))}
            </>
          )}

          {filteredFiles.length > 0 && (
            <>
              <div className="thread-section-label">📄 Files</div>
              {filteredFiles.map((file) => (
                <div
                  key={file._id}
                  className={`attachment-picker__item ${selectedFileIds.has(file._id) ? "selected" : ""}`}
                  onClick={() => toggleFile(file._id)}
                >
                  <div className="item-icon">{getMimeIcon(file.metadata?.mimetype)}</div>
                  <div className="item-info">
                    <div className="item-name">{file.filename}</div>
                    <div className="item-meta">
                      {file.metadata?.mimetype?.split("/")[1]?.toUpperCase() || "File"} ·{" "}
                      {file.metadata?.size ? `${(file.metadata.size / 1024).toFixed(1)} KB` : ""}
                    </div>
                  </div>
                  <div className={`item-check ${selectedFileIds.has(file._id) ? "checked" : ""}`}>
                    {selectedFileIds.has(file._id) && "✓"}
                  </div>
                </div>
              ))}
            </>
          )}

          {filteredFiles.length === 0 && filteredFolders.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div>No files found</div>
            </div>
          )}
        </div>

        <div className="attachment-picker__footer">
          <div className="selected-count">
            <span>{totalSelected}</span> item{totalSelected !== 1 ? "s" : ""} selected
          </div>
          <button className="attach-confirm-btn" onClick={handleConfirm} disabled={totalSelected === 0}>
            Attach Selected
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ChatPage Component ───────────────────────────────────────────────────
interface ChatPageProps {
  onClose: () => void;
}

export default function ChatPage({ onClose }: ChatPageProps) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ fileIds: string[]; folderIds: string[]; labels: string[] }>({ fileIds: [], folderIds: [], labels: [] });
  const [showPicker, setShowPicker] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load threads ──────────────────────────────────────────────────────────
  useEffect(() => {
    listThreads().then(setThreads).catch(() => {});
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    if (windowRef.current) {
      windowRef.current.scrollTop = windowRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamingContent, scrollToBottom]);

  // ── Select thread ─────────────────────────────────────────────────────────
  const selectThread = useCallback(async (thread: ChatThread) => {
    try {
      const full = await getThread(thread._id);
      setActiveThread(full);
      setMessages(full.messages || []);
      setStreamingContent("");
      setSidebarOpen(false);
    } catch { /* ignore */ }
  }, []);

  // ── New chat ──────────────────────────────────────────────────────────────
  const startNewChat = useCallback(async () => {
    setActiveThread(null);
    setMessages([]);
    setStreamingContent("");
    setAttachedFiles({ fileIds: [], folderIds: [], labels: [] });
    setSidebarOpen(false);
  }, []);

  // ── Delete thread ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    await deleteThread(threadId).catch(() => {});
    setThreads((prev) => prev.filter((t) => t._id !== threadId));
    if (activeThread?._id === threadId) startNewChat();
  }, [activeThread, startNewChat]);

  // ── Textarea auto-resize ──────────────────────────────────────────────────
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  // ── Submit message ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (overrideMessage?: string) => {
    const message = (overrideMessage || inputValue).trim();
    if (!message || isStreaming) return;

    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsStreaming(true);
    setStreamingContent("");
    setToolResults([]);
    setStatusText("Thinking...");

    const userMsg: ChatMessage = {
      role: "user",
      content: message,
      attachments: attachedFiles.labels.map((label, i) => ({
        fileId: attachedFiles.fileIds[i],
        folderId: attachedFiles.folderIds[i - attachedFiles.fileIds.length],
        filename: label,
      })),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    const filesSnapshot = { ...attachedFiles };
    setAttachedFiles({ fileIds: [], folderIds: [], labels: [] });

    abortRef.current = new AbortController();
    let finalContent = "";
    let pendingToolResults: ToolResult[] = [];
    let newThreadId: string | null = null;

    try {
      await streamChat(
        {
          message,
          threadId: activeThread?._id,
          fileIds: filesSnapshot.fileIds,
          folderIds: filesSnapshot.folderIds,
        },
        {
          onStatus: (ev) => setStatusText(ev.message),
          onIntent: (ev) => console.log("[Chat] Intent:", ev.intent),
          onToken: (token) => {
            finalContent += token;
            setStreamingContent((prev) => prev + token);
          },
          onToolResults: (results) => {
            pendingToolResults = results;
            setToolResults(results);
          },
          onThread: (ev) => {
            newThreadId = ev.threadId;
            listThreads().then(setThreads).catch(() => {});
          },
          onDone: () => {
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: finalContent,
              toolResults: pendingToolResults,
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingContent("");
            setToolResults([]);
            setStatusText("");
            setIsStreaming(false);

            if (newThreadId && !activeThread) {
              getThread(newThreadId).then((t) => setActiveThread(t)).catch(() => {});
            }
          },
          onError: (err) => {
            setStreamingContent(`❌ Error: ${err}`);
            setIsStreaming(false);
            setStatusText("");
          },
        },
        abortRef.current.signal
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setStreamingContent("❌ Request failed");
      }
      setIsStreaming(false);
      setStatusText("");
    }
  }, [inputValue, isStreaming, activeThread, attachedFiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStatusText("");
  };

  // ── Thread time grouping ──────────────────────────────────────────────────
  const todayThreads = threads.filter((t) => dayjs(t.updatedAt).isAfter(dayjs().startOf("day")));
  const olderThreads = threads.filter((t) => !dayjs(t.updatedAt).isAfter(dayjs().startOf("day")));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="chat-page">
      {/* Sidebar */}
      <div className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="chat-sidebar__header">
          <div className="sidebar-logo">
            <div className="logo-icon">✨</div>
            <span className="logo-text">Cloud9 AI</span>
          </div>
          <button className="new-chat-btn" onClick={startNewChat}>
            {icons.plus} New Chat
          </button>
        </div>

        <div className="chat-sidebar__threads">
          {todayThreads.length > 0 && (
            <>
              <div className="thread-section-label">Today</div>
              {todayThreads.map((t) => (
                <div
                  key={t._id}
                  className={`thread-item ${activeThread?._id === t._id ? "active" : ""}`}
                  onClick={() => selectThread(t)}
                >
                  <span className="thread-item__icon">💬</span>
                  <span className="thread-item__title">{t.title}</span>
                  <span className="thread-item__time">{dayjs(t.updatedAt).fromNow(true)}</span>
                  <button className="thread-item__delete" onClick={(e) => handleDelete(e, t._id)}>
                    {icons.trash}
                  </button>
                </div>
              ))}
            </>
          )}

          {olderThreads.length > 0 && (
            <>
              <div className="thread-section-label">Older</div>
              {olderThreads.map((t) => (
                <div
                  key={t._id}
                  className={`thread-item ${activeThread?._id === t._id ? "active" : ""}`}
                  onClick={() => selectThread(t)}
                >
                  <span className="thread-item__icon">💬</span>
                  <span className="thread-item__title">{t.title}</span>
                  <span className="thread-item__time">{dayjs(t.updatedAt).format("D MMM")}</span>
                  <button className="thread-item__delete" onClick={(e) => handleDelete(e, t._id)}>
                    {icons.trash}
                  </button>
                </div>
              ))}
            </>
          )}

          {threads.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>
              Start your first conversation
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="chat-main">
        {/* Top bar */}
        <div className="chat-topbar">
          <button className="chat-topbar__menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {icons.menu}
          </button>
          <div className="chat-topbar__title">
            {activeThread ? activeThread.title : "Cloud9 AI"}
          </div>
          <div className="chat-topbar__model">
            <div className="model-dot" />
            {activeThread?.model || "qwen2.5:14b"}
          </div>
          <button className="chat-topbar__close" onClick={onClose} title="Close chat">
            {icons.close}
          </button>
        </div>

        {/* Message window */}
        <div className="chat-window" ref={windowRef}>
          {messages.length === 0 && !streamingContent ? (
            <div className="chat-welcome">
              <div className="welcome-orb">✨</div>
              <h2>What can I help you with today?</h2>
              <p>
                I can write emails, analyze receipts, generate images, coach your career,
                plan projects, tutor you for exams, write code, and everything Claude or ChatGPT can do — and more.
              </p>
              <div className="welcome-pills">
                {WELCOME_PILLS.map((pill, i) => (
                  <div
                    key={i}
                    className="welcome-pill"
                    onClick={() => handleSubmit(pill.text)}
                  >
                    <span className="pill-icon">{pill.icon}</span>
                    {pill.text}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, mi) => (
                <div key={mi} className={`message-group ${msg.role}`}>
                  {msg.role === "assistant" && (
                    <div className="bubble-header">
                      <div className="bubble-avatar">✨</div>
                    </div>
                  )}
                  <div className={`message-bubble ${msg.role}`}>
                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="bubble-attachments">
                        {msg.attachments.map((att, ai) => (
                          <div key={ai} className="attachment-chip">
                            {icons.file} {att.filename}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Content */}
                    <div className="bubble-content">
                      {msg.role === "assistant" ? (
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                      ) : (
                        <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                      )}
                    </div>

                    <div className="bubble-meta">
                      {dayjs(msg.createdAt).format("h:mm A")}
                    </div>

                    {/* Tool results */}
                    {msg.toolResults?.map((tr, ti) => (
                      <ToolResultCard
                        key={ti}
                        result={tr}
                        threadId={activeThread?._id || ""}
                        messageIndex={mi}
                        toolIndex={ti}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {(isStreaming || streamingContent) && (
                <div className="message-group assistant">
                  <div className="bubble-header">
                    <div className="bubble-avatar" style={{ animation: "orb-pulse 1.5s ease-in-out infinite" }}>✨</div>
                  </div>
                  <div className="message-bubble assistant">
                    <div className="bubble-content">
                      {streamingContent ? (
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} />
                      ) : (
                        <div className="thinking-indicator" style={{ padding: 0 }}>
                          <div className="thinking-dots">
                            <span /><span /><span />
                          </div>
                          <span className="thinking-text">{statusText}</span>
                        </div>
                      )}
                    </div>
                    {/* Live tool results during streaming */}
                    {toolResults.map((tr, ti) => (
                      <ToolResultCard
                        key={ti}
                        result={tr}
                        threadId={activeThread?._id || ""}
                        messageIndex={messages.length}
                        toolIndex={ti}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Input area */}
        <div className="chat-input-area">
          <div className="chat-input-box">
            {attachedFiles.labels.length > 0 && (
              <div className="chat-input-attachments">
                {attachedFiles.labels.map((label, i) => (
                  <div key={i} className="attachment-preview">
                    📎 {label}
                    <button
                      className="remove-att"
                      onClick={() => setAttachedFiles((prev) => ({
                        fileIds: prev.fileIds.filter((_, fi) => fi !== i),
                        folderIds: prev.folderIds.filter((_, fi) => fi !== i - prev.fileIds.length),
                        labels: prev.labels.filter((_, li) => li !== i),
                      }))}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-input-row">
              <button
                className="chat-input-btn"
                onClick={() => setShowPicker(true)}
                title="Attach files from Cloud9"
              >
                {icons.attach}
              </button>

              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="Message Cloud9 AI — ask anything, attach files, or request images..."
                rows={1}
                disabled={isStreaming}
              />

              {isStreaming ? (
                <button className="stop-btn" onClick={handleStop} title="Stop">
                  {icons.stop}
                </button>
              ) : (
                <button
                  className="send-btn"
                  onClick={() => handleSubmit()}
                  disabled={!inputValue.trim() && attachedFiles.labels.length === 0}
                  title="Send"
                >
                  {icons.send}
                </button>
              )}
            </div>
          </div>

          <div className="chat-input-footer">
            Cloud9 AI can make mistakes — verify important information · Shift+Enter for new line
          </div>
        </div>
      </div>

      {/* Attachment picker modal */}
      {showPicker && (
        <AttachmentPicker
          onClose={() => setShowPicker(false)}
          onConfirm={(sel) => {
            setAttachedFiles(sel);
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}
