/**
 * drafter.ts
 * AI drafting tool — emails, letters, reports, summaries, cover letters, etc.
 * Produces professional, context-aware written content.
 */

import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export type DraftType =
  | "email"
  | "letter"
  | "report"
  | "summary"
  | "cover_letter"
  | "proposal"
  | "announcement"
  | "general";

export interface DraftResult {
  draftType: DraftType;
  subject?: string;
  content: string;
  wordCount: number;
}

const DRAFTER_SYSTEM = `You are a professional writer and communication expert. 
You produce polished, clear, and context-appropriate written content.
You adapt your tone based on the request — formal, casual, persuasive, empathetic, or direct.
When drafting emails, always include a Subject line at the top.
When drafting reports or summaries, use clear headings and bullet points where appropriate.
You have access to any attached file content as context — use it to make the draft highly specific and relevant.`;

function detectDraftType(message: string): DraftType {
  const lower = message.toLowerCase();
  if (lower.includes("email") || lower.includes("e-mail")) return "email";
  if (lower.includes("cover letter")) return "cover_letter";
  if (lower.includes("letter")) return "letter";
  if (lower.includes("report")) return "report";
  if (lower.includes("summary") || lower.includes("summarize") || lower.includes("summarise")) return "summary";
  if (lower.includes("proposal")) return "proposal";
  if (lower.includes("announcement")) return "announcement";
  return "general";
}

export async function runDrafterTool(
  request: string,
  fileContext: string,
  conversationHistory: string
): Promise<DraftResult> {
  const draftType = detectDraftType(request);

  const contextSection = fileContext
    ? `\n\nContext from attached files:\n${fileContext}`
    : "";

  const historySection = conversationHistory
    ? `\n\nPrevious conversation context:\n${conversationHistory}`
    : "";

  const prompt = `${DRAFTER_SYSTEM}${contextSection}${historySection}

User request: ${request}

Please draft the requested content. Be thorough, professional, and use any file context provided to make it specific and relevant. Output the draft directly.`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 120_000 }
  );

  const content = (response.data?.response as string || "").trim();

  // Extract subject line from email drafts
  let subject: string | undefined;
  if (draftType === "email") {
    const subjectMatch = content.match(/^Subject:\s*(.+)$/im);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
    }
  }

  return {
    draftType,
    subject,
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
  };
}
