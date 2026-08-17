/**
 * email-connector.ts
 * Real email sending connector using nodemailer (already in project deps).
 * Supports Gmail, Outlook/Office365, and custom SMTP.
 */

import nodemailer from "nodemailer";
import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export interface EmailDraftResult {
  subject: string;
  body: string;
  to?: string;
  from?: string;
}

export interface EmailSendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
  preview?: string; // ethereal test URL
}

// Build transporter from env vars
function createTransporter() {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_ADDRESS;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_API_KEY;

  if (!host || !user || !pass) {
    throw new Error("Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

export async function draftEmail(
  request: string,
  fileContext: string
): Promise<EmailDraftResult> {
  const contextSection = fileContext ? `\n\nContext:\n${fileContext}` : "";

  const prompt = `You are a professional email writer.${contextSection}

Request: ${request}

Write a complete email. Return ONLY valid JSON with this exact shape:
{"subject":"...","body":"...","to":"email@example.com or empty","from":""}
No markdown. No explanation. Just the JSON.`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 60_000 }
  );

  let raw = (response.data?.response as string || "").trim();
  raw = raw.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      subject: parsed.subject || "No Subject",
      body: parsed.body || "",
      to: parsed.to || "",
      from: parsed.from || process.env.EMAIL_ADDRESS || "",
    };
  } catch {
    // Try to extract subject and body from plain text
    const subjectMatch = raw.match(/^Subject:\s*(.+)$/im);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Email Draft";
    return { subject, body: raw, to: "", from: "" };
  }
}

export async function sendEmail(draft: EmailDraftResult): Promise<EmailSendResult> {
  try {
    const transporter = createTransporter();

    const info = await transporter.sendMail({
      from: draft.from || process.env.EMAIL_ADDRESS,
      to: draft.to,
      subject: draft.subject,
      text: draft.body,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${draft.body}</pre>`,
    });

    const preview = nodemailer.getTestMessageUrl(info);

    return {
      sent: true,
      messageId: info.messageId,
      preview: preview || undefined,
    };
  } catch (err: any) {
    return {
      sent: false,
      error: err?.message || String(err),
    };
  }
}
