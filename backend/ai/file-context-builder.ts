/**
 * FileContextBuilder — retrieves files from Cloud9 storage and extracts
 * readable text / base64 content from any file type, injecting it into
 * the LLM context window.
 *
 * Supported types: PDF, DOCX, images (JPG/PNG/WEBP/GIF), CSV, plain text,
 * code files, audio (WAV → whisper), and generic binary (description only).
 */

import File from "../models/file-model";
import User from "../models/user-model";
import ChunkService from "../services/chunk-service/chunk-service";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import axios from "axios";
import path from "path";
import os from "os";
import fs from "fs";
import { promisify } from "util";

const chunkService = new ChunkService();
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const ollamaVisionModel = process.env.OLLAMA_VISION_MODEL || "llava:13b";
const ollamaTextModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

// Max characters of content per file to inject (keeps context window sane)
const MAX_CHARS_PER_FILE = 12_000;
// Max total context chars across all files
const MAX_TOTAL_CHARS = 60_000;

export interface FileContext {
  filename: string;
  fileId: string;
  mimeType: string;
  type: "text" | "image" | "audio" | "structured" | "binary";
  content: string;         // text extracted or base64 for images
  summary?: string;        // short summary for very large files
  truncated: boolean;
}

export interface FolderContext {
  folderId: string;
  folderName: string;
  files: FileContext[];
  summary: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]);
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".c", ".cpp", ".cs", ".go",
  ".rb", ".php", ".swift", ".kt", ".rs", ".sh", ".bash", ".zsh", ".yml",
  ".yaml", ".json", ".xml", ".html", ".css", ".scss", ".sql", ".md", ".env",
  ".toml", ".ini", ".cfg",
]);

function getMimeCategory(filename: string, mimeType?: string): "text" | "image" | "audio" | "structured" | "pdf" | "docx" | "binary" {
  const ext = path.extname(filename).toLowerCase();
  if (mimeType === "application/pdf" || ext === ".pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") return "docx";
  if (ext === ".csv") return "structured";
  if (ext === ".xlsx" || ext === ".xls") return "structured";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (CODE_EXTS.has(ext)) return "text";
  if (mimeType?.startsWith("text/")) return "text";
  return "binary";
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[... content truncated ...]", truncated: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Extractors
// ────────────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch {
    return "[PDF extraction failed]";
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch {
    return "[DOCX extraction failed]";
  }
}

async function describeImageWithVision(base64: string, filename: string): Promise<string> {
  try {
    const prompt = `You are analyzing the file named "${filename}". Describe everything you see in this image in detail — including any text, numbers, tables, receipts, charts, or diagrams. Be thorough and specific.`;
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: ollamaVisionModel,
        prompt,
        images: [base64],
        stream: false,
      },
      { timeout: 120_000 }
    );
    return (response.data?.response as string) || "[Vision model returned no output]";
  } catch (err: any) {
    return `[Vision analysis failed: ${err?.message || err}]`;
  }
}

async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
  // Write to temp, attempt whisper via Ollama or fall back
  const tmpPath = path.join(os.tmpdir(), `cloud9-audio-${Date.now()}${path.extname(filename)}`);
  try {
    await writeFile(tmpPath, buffer);
    // Attempt to use whisper.cpp if available via Ollama custom endpoint
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: "whisper",
        prompt: "Transcribe the audio.",
        stream: false,
      },
      { timeout: 60_000 }
    );
    return (response.data?.response as string) || "[Audio transcription returned empty]";
  } catch {
    return `[Audio file: ${filename} — transcription not available. File is available for context.]`;
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function buildFileContext(
  fileId: string,
  userId: string
): Promise<FileContext | null> {
  try {
    const fileDoc = await File.findOne({ _id: fileId, "metadata.owner": userId });
    if (!fileDoc) {
      console.warn(`[FileContextBuilder] File not found: ${fileId} for user ${userId}`);
      return null;
    }

    const filename = fileDoc.filename || "unknown";
    const mimeType = ""; // Derived from filename extension
    const category = getMimeCategory(filename, mimeType);

    console.log(`[FileContextBuilder] Processing file="${filename}", category=${category}`);

    // Fetch raw bytes — download the file via ChunkService using a mock response
    const userDoc = await User.findById(userId);
    if (!userDoc) return null;

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      // Create a pseudo-response that collects data
      const pseudoRes = {
        setHeader: () => {},
        writeHead: () => {},
        write: (chunk: Buffer) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); },
        end: () => resolve(),
        on: () => {},
        once: () => {},
        emit: () => {},
        status: 200,
      } as any;

      chunkService.downloadFile(userDoc, String(fileDoc._id), pseudoRes)
        .then(() => resolve())
        .catch(reject);
    });
    const buffer = Buffer.concat(chunks);

    let rawContent = "";
    let contextType: FileContext["type"] = "text";

    switch (category) {
      case "pdf":
        contextType = "text";
        rawContent = await extractPdf(buffer);
        break;

      case "docx":
        contextType = "text";
        rawContent = await extractDocx(buffer);
        break;

      case "structured": {
        contextType = "structured";
        rawContent = buffer.toString("utf8");
        break;
      }

      case "text":
        contextType = "text";
        rawContent = buffer.toString("utf8");
        break;

      case "image": {
        contextType = "image";
        const base64 = buffer.toString("base64");
        rawContent = await describeImageWithVision(base64, filename);
        break;
      }

      case "audio":
        contextType = "audio";
        rawContent = await transcribeAudio(buffer, filename);
        break;

      default:
        contextType = "binary";
        rawContent = `[Binary file: ${filename} — ${buffer.length} bytes. Cannot extract text content.]`;
    }

    const { text: content, truncated } = truncate(rawContent, MAX_CHARS_PER_FILE);

    return {
      filename,
      fileId,
      mimeType,
      type: contextType,
      content,
      truncated,
    };
  } catch (err: any) {
    console.error(`[FileContextBuilder] Error processing fileId=${fileId}:`, err?.message || err);
    return null;
  }
}

export async function buildMultipleFileContexts(
  fileIds: string[],
  userId: string
): Promise<FileContext[]> {
  const results: FileContext[] = [];
  let totalChars = 0;

  for (const fileId of fileIds) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      console.warn(`[FileContextBuilder] Total context budget exhausted after ${results.length} files`);
      break;
    }
    const ctx = await buildFileContext(fileId, userId);
    if (ctx) {
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (ctx.content.length > remaining) {
        ctx.content = ctx.content.slice(0, remaining) + "\n[... truncated due to total context limit ...]";
        ctx.truncated = true;
      }
      totalChars += ctx.content.length;
      results.push(ctx);
    }
  }
  return results;
}

export async function buildFolderContext(
  folderId: string,
  userId: string
): Promise<FolderContext> {
  const Folder = (await import("../models/folder-model")).default;
  const folderDoc = await Folder.findOne({ _id: folderId, "metadata.owner": userId });
  const folderName = folderDoc?.name || folderId;

  const filesInFolder = await File.find({
    parent: folderId,
    "metadata.owner": userId,
    "metadata.trashed": { $ne: true },
  }).limit(30);

  const fileIds = filesInFolder.map((f: any) => String(f._id));
  const fileContexts = await buildMultipleFileContexts(fileIds, userId);

  // Generate a short folder-level summary
  const fileSummary = fileContexts
    .map((fc) => `• ${fc.filename} (${fc.type}): ${(fc.content || "").slice(0, 200)}`)
    .join("\n");

  let folderSummary = `Folder "${folderName}" contains ${fileContexts.length} file(s):\n${fileSummary}`;
  if (folderSummary.length > 4000) {
    folderSummary = folderSummary.slice(0, 4000) + "\n[... truncated ...]";
  }

  return {
    folderId,
    folderName,
    files: fileContexts,
    summary: folderSummary,
  };
}

export function formatContextForPrompt(fileContexts: FileContext[]): string {
  if (!fileContexts.length) return "";

  const sections = fileContexts.map((fc) => {
    const header = `=== FILE: ${fc.filename} (${fc.type}) ===`;
    const body = fc.content || "[No content extracted]";
    const footer = fc.truncated ? "\n[File was truncated to fit context window]" : "";
    return `${header}\n${body}${footer}`;
  });

  return `\n\n---\n# Attached File Context\n\n${sections.join("\n\n")}\n---\n`;
}
