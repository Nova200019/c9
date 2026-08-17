import axios from "axios";

const BASE = "/ai-service";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  fileId?: string;
  folderId?: string;
  filename: string;
  mimeType?: string;
}

export interface ToolResult {
  toolName: string;
  status: "success" | "error";
  data: Record<string, unknown>;
  outputType?: "csv" | "json" | "image" | "text" | "plan";
  downloadable?: boolean;
  label?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  toolResults?: ToolResult[];
  imageUrl?: string;
  createdAt: string;
}

export interface ChatThread {
  _id: string;
  tenantId: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── SSE Stream types ───────────────────────────────────────────────────────

export type SseEventType = "status" | "intent" | "token" | "tool_results" | "thread" | "done" | "error";

export interface SseStatusEvent { status: string; message: string }
export interface SseIntentEvent { intent: string }
export interface SseTokenEvent { token: string }
export interface SseToolResultsEvent { results: ToolResult[] }
export interface SseThreadEvent { threadId: string; title: string }

export interface StreamChatCallbacks {
  onStatus?: (event: SseStatusEvent) => void;
  onIntent?: (event: SseIntentEvent) => void;
  onToken?: (token: string) => void;
  onToolResults?: (results: ToolResult[]) => void;
  onThread?: (event: SseThreadEvent) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

// ── Streaming chat ─────────────────────────────────────────────────────────

export async function streamChat(
  params: {
    message: string;
    threadId?: string;
    fileIds?: string[];
    folderIds?: string[];
    sendEmail?: boolean;
    outputFormat?: "csv" | "json";
  },
  callbacks: StreamChatCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${BASE}/chat-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    callbacks.onError?.(`Request failed: ${response.status} ${errorText}`);
    return;
  }

  if (!response.body) {
    callbacks.onError?.("No response body");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("event: ")) {
          // Named event — next data line will handle it
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          const rawData = trimmed.slice(6);
          try {
            const parsed = JSON.parse(rawData);

            // Route based on parsed fields
            if (parsed.token !== undefined) {
              callbacks.onToken?.(parsed.token);
            } else if (parsed.status !== undefined) {
              callbacks.onStatus?.(parsed as SseStatusEvent);
            } else if (parsed.intent !== undefined) {
              callbacks.onIntent?.(parsed as SseIntentEvent);
            } else if (parsed.results !== undefined) {
              callbacks.onToolResults?.(parsed.results);
            } else if (parsed.threadId !== undefined) {
              callbacks.onThread?.(parsed as SseThreadEvent);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
    callbacks.onDone?.();
  }
}

// ── Thread CRUD ────────────────────────────────────────────────────────────

export async function listThreads(limit = 50): Promise<ChatThread[]> {
  const res = await axios.get(`${BASE}/threads`, { params: { limit } });
  return res.data.threads || [];
}

export async function getThread(id: string): Promise<ChatThread> {
  const res = await axios.get(`${BASE}/threads/${id}`);
  return res.data.thread;
}

export async function createThread(title = "New Chat"): Promise<ChatThread> {
  const res = await axios.post(`${BASE}/threads`, { title });
  return res.data.thread;
}

export async function deleteThread(id: string): Promise<void> {
  await axios.delete(`${BASE}/threads/${id}`);
}

export async function renameThread(id: string, title: string): Promise<ChatThread> {
  const res = await axios.patch(`${BASE}/threads/${id}`, { title });
  return res.data.thread;
}

// ── Download tool output ───────────────────────────────────────────────────

export function getToolDownloadUrl(
  threadId: string,
  messageIndex: number,
  toolIndex: number
): string {
  return `${BASE}/threads/${threadId}/messages/${messageIndex}/tools/${toolIndex}/download`;
}
