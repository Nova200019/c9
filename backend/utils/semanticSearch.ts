import File, { FileInterface } from "../models/file-model";
import fs from "fs";
import path from "path";
import env from "../enviroment/env";
import { getFSStoragePath } from "./getFSStoragePath";
import ffmpeg from "fluent-ffmpeg";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { WaveFile } from "wavefile";
import getFileData from "../services/chunk-service/utils/getFileData";
import os from "os";
import crypto from "crypto";
import User from "../models/user-model";
import axios from "axios";
import { pipeline as createPipeline, env as transformersEnv } from "@xenova/transformers";

const localTransformersEnv = transformersEnv as any;
localTransformersEnv.allowRemoteModels = false;
localTransformersEnv.allowLocalModels = true;

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const ollamaTextModel = process.env.OLLAMA_TEXT_MODEL || "llama3.2:3b";
const ollamaVisionModel = process.env.OLLAMA_VISION_MODEL || ollamaTextModel;
const ollamaEmbeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const localWhisperModel = process.env.LOCAL_WHISPER_MODEL || "Xenova/whisper-tiny.en";
const localEmbeddingModel = process.env.LOCAL_EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";

let whisperPipelinePromise: Promise<any> | null = null;
let embeddingPipelinePromise: Promise<any> | null = null;

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "your",
  "file",
  "files",
  "into",
  "about",
  "when",
  "what",
  "which",
  "will",
  "into",
  "their",
  "there",
  "them",
  "then",
  "than",
  "into",
  "been",
  "were",
  "are",
  "was",
  "you",
  "our",
  "out",
  "use",
  "used",
  "using",
]);

const toNumericVector = (value: any): number[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (Array.isArray(value[0])) return toNumericVector(value[0]);
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  if (value.data) return Array.from(value.data as ArrayLike<number>).map((entry) => Number(entry));
  if (typeof value === "object" && typeof value.length === "number") {
    return Array.from(value as ArrayLike<number>).map((entry) => Number(entry));
  }
  return [];
};

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));

const extractHeuristicKeywords = (text: string) => {
  const tokens = normalizeText(text);
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }

  const ranked = Array.from(frequency.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([token]) => token);

  return {
    keywords: ranked,
    categories: ranked.length ? [ranked[0]] : ["document"],
  };
};

async function callOllamaGenerate(prompt: string, images?: string[]) {
  const model = images?.length ? ollamaVisionModel : ollamaTextModel;
  const startTime = Date.now();
  console.log(`[AI-RAG] callOllamaGenerate -> model=${model}, promptLen=${prompt.length}, hasImages=${!!images?.length}`);
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model,
        prompt,
        stream: false,
        ...(images?.length ? { images } : {}),
      },
      { timeout: 120000 }
    );
    const elapsed = Date.now() - startTime;
    const result = typeof response.data?.response === "string" ? response.data.response.trim() : "";
    console.log(`[AI-RAG] callOllamaGenerate <- OK in ${elapsed}ms, responseLen=${result.length}`);
    return result;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[AI-RAG] callOllamaGenerate <- FAILED in ${elapsed}ms: ${error?.message || error}`);
    throw error;
  }
}

async function callOllamaEmbedding(text: string) {
  const startTime = Date.now();
  console.log(`[AI-RAG] callOllamaEmbedding -> model=${ollamaEmbeddingModel}, textLen=${text.length}`);
  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/embeddings`,
      { model: ollamaEmbeddingModel, prompt: text },
      { timeout: 120000 }
    );
    const vector = toNumericVector(response.data?.embedding);
    const elapsed = Date.now() - startTime;
    console.log(`[AI-RAG] callOllamaEmbedding <- OK in ${elapsed}ms, vectorDim=${vector.length}`);
    return vector;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[AI-RAG] callOllamaEmbedding <- FAILED in ${elapsed}ms: ${error?.message || error}`);
    throw error;
  }
}

async function getLocalWhisperPipeline() {
  if (!whisperPipelinePromise) {
    console.log(`[AI-RAG] Initializing local whisper pipeline: ${localWhisperModel}`);
    whisperPipelinePromise = createPipeline("automatic-speech-recognition", localWhisperModel, {
      quantized: true,
    });
  }

  return whisperPipelinePromise;
}

async function getLocalEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    console.log(`[AI-RAG] Initializing local embedding pipeline: ${localEmbeddingModel}`);
    embeddingPipelinePromise = createPipeline("feature-extraction", localEmbeddingModel, {
      quantized: true,
    });
  }

  return embeddingPipelinePromise;
}

async function transcribeAudioLocal(filePath: string): Promise<string> {
  const startTime = Date.now();
  console.log(`[AI-RAG] transcribeAudioLocal -> file=${filePath}`);
  try {
    const whisperPipeline = await getLocalWhisperPipeline();
    const result = await whisperPipeline(filePath, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = typeof result === "string" ? result.trim() : (typeof result?.text === "string" ? result.text.trim() : "");
    console.log(`[AI-RAG] transcribeAudioLocal <- OK in ${Date.now() - startTime}ms, textLen=${text.length}`);
    return text;
  } catch (error: any) {
    console.error(`[AI-RAG] transcribeAudioLocal <- FAILED in ${Date.now() - startTime}ms: ${error?.message || error}`);
    return "";
  }
}

async function getImageCaptionLocal(imageBuffer: Buffer): Promise<string> {
  const prompt = [
    "Describe this image in one short sentence.",
    "Return only the description without extra commentary.",
  ].join(" ");

  console.log(`[AI-RAG] getImageCaptionLocal -> imageSize=${imageBuffer.length} bytes`);
  try {
    const caption = await callOllamaGenerate(prompt, [imageBuffer.toString("base64")]);
    console.log(`[AI-RAG] getImageCaptionLocal <- caption="${caption.slice(0, 100)}"`);
    return caption;
  } catch (error: any) {
    console.error(`[AI-RAG] getImageCaptionLocal <- FAILED: ${error?.message || error}`);
    return "";
  }
}

async function getTokensLocal(text: string): Promise<{ keywords: string[]; categories: string[] }> {
  const trimmedText = text.trim();
  if (!trimmedText) return { keywords: [], categories: [] };

  const prompt = [
    "Extract the 5 most important keywords or keyphrases from the text.",
    "Extract the 5 most relevant categories or topics from the text.",
    'Return only valid JSON in this shape: {"keywords":[...],"categories":[...]}.',
    "Do not include markdown.",
    "",
    "Text:",
    trimmedText,
  ].join("\n");

  console.log(`[AI-RAG] getTokensLocal -> textLen=${trimmedText.length}`);
  try {
    const response = await callOllamaGenerate(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);

    const result = {
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((value: string) => String(value).trim()).filter(Boolean).slice(0, 5)
        : [],
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.map((value: string) => String(value).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
    console.log(`[AI-RAG] getTokensLocal <- keywords=[${result.keywords.join(", ")}], categories=[${result.categories.join(", ")}]`);
    return result;
  } catch (error: any) {
    console.warn(`[AI-RAG] getTokensLocal <- Ollama failed, using heuristic fallback: ${error?.message || error}`);
    return extractHeuristicKeywords(trimmedText);
  }
}

function fallbackEmbedding(text: string): number[] {
  const dimensions = 128;
  const vector = new Array(dimensions).fill(0);
  const tokens = normalizeText(text);

  for (const token of tokens) {
    let hash = 0;

    for (let index = 0; index < token.length; index += 1) {
      hash = (hash * 31 + token.charCodeAt(index)) | 0;
    }

    const position = Math.abs(hash) % dimensions;
    vector[position] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

async function getTextEmbeddingLocal(text: string): Promise<number[]> {
  const trimmedText = text.trim();
  if (!trimmedText) return [];

  const startTime = Date.now();
  console.log(`[AI-RAG] getTextEmbeddingLocal -> textLen=${trimmedText.length}`);

  // Try Ollama first
  try {
    const ollamaEmbedding = await callOllamaEmbedding(trimmedText);
    if (ollamaEmbedding.length) {
      console.log(`[AI-RAG] getTextEmbeddingLocal <- Ollama OK in ${Date.now() - startTime}ms, dim=${ollamaEmbedding.length}`);
      return ollamaEmbedding;
    }
    console.warn(`[AI-RAG] getTextEmbeddingLocal <- Ollama returned empty embedding`);
  } catch (error: any) {
    console.warn(`[AI-RAG] getTextEmbeddingLocal <- Ollama embedding failed: ${error?.message || error}`);
  }

  // Try local Xenova pipeline
  try {
    console.log(`[AI-RAG] getTextEmbeddingLocal -> Trying local Xenova pipeline...`);
    const embeddingPipeline = await getLocalEmbeddingPipeline();
    const result = await embeddingPipeline(trimmedText, {
      pooling: "mean",
      normalize: true,
    });

    const vector = toNumericVector((result as any)?.data ?? result);
    console.log(`[AI-RAG] getTextEmbeddingLocal <- Xenova OK in ${Date.now() - startTime}ms, dim=${vector.length}`);
    return vector;
  } catch (error: any) {
    console.warn(`[AI-RAG] getTextEmbeddingLocal <- Xenova failed: ${error?.message || error}. Using hash fallback.`);
    return fallbackEmbedding(trimmedText);
  }
}

// --- Extraction Helpers (with Audio) ---

const extractFrame = (videoPath: string, framePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .screenshots({ count: 1, filename: path.basename(framePath), folder: path.dirname(framePath) });
  });
};

const extractAudio = (mediaPath: string, audioPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(mediaPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .output(audioPath)
      .audioCodec('pcm_s16le').audioFrequency(16000).audioChannels(1)
      .run();
  });
};

// Helper: Decrypt and reconstruct file to temp path, return temp path
async function reconstructDecryptedFile(file: FileInterface): Promise<string | null> {
  const startTime = Date.now();
  console.log(`[AI-RAG] reconstructDecryptedFile -> file="${file.filename}", owner=${file.metadata.owner}`);
  try {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `ai-decrypt-${crypto.randomUUID()}${path.extname(file.filename)}`);
    const writeStream = fs.createWriteStream(tempFilePath);

    const user = await User.findById(file.metadata.owner);
    if (!user) {
      console.error(`[AI-RAG] reconstructDecryptedFile <- FAILED: Owner user not found (id=${file.metadata.owner})`);
      return null;
    }

    const finished = new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const fakeRes = writeStream as any;
    fakeRes.set = () => {};
    fakeRes.on = writeStream.on.bind(writeStream);

    await getFileData(fakeRes, file._id.toString(), user);
    await finished;

    try {
      const stats = await fs.promises.stat(tempFilePath);
      if (stats.size === 0) {
        console.error(`[AI-RAG] reconstructDecryptedFile <- FAILED: Decrypted file is empty (0 bytes)`);
        return null;
      }
      console.log(`[AI-RAG] reconstructDecryptedFile <- OK in ${Date.now() - startTime}ms, size=${stats.size} bytes, path=${tempFilePath}`);
    } catch (err: any) {
      console.error(`[AI-RAG] reconstructDecryptedFile <- FAILED: Could not stat temp file: ${err?.message || err}`);
      return null;
    }

    return tempFilePath;
  } catch (e: any) {
    console.error(`[AI-RAG] reconstructDecryptedFile <- FAILED in ${Date.now() - startTime}ms: ${e?.message || e}`);
    return null;
  }
}

// --- Cosine similarity ---
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] || 0), 0);
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return normA && normB ? dot / (normA * normB) : 0;
}

// --- Core Logic: Token Generation & Embedding ---
export async function generateTokensForFile(file: FileInterface): Promise<{ fileKey: string; tokens: string[]; categories: string[]; type: string; embedding: number[] } | null> {
  const startTime = Date.now();
  console.log(`[AI-RAG] generateTokensForFile -> file="${file.filename}", id=${file._id}`);

  const decryptedFilePath = await reconstructDecryptedFile(file);
  if (!decryptedFilePath) {
    console.error(`[AI-RAG] generateTokensForFile <- SKIPPED: Could not decrypt/reconstruct file "${file.filename}"`);
    return null;
  }

  const ext = path.extname(decryptedFilePath).toLowerCase();
  let tokens: string[] = [];
  let categories: string[] = [];
  let type = "";
  let textForEmbedding = "";

  console.log(`[AI-RAG] generateTokensForFile -> Processing ext="${ext}"`);

  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.JPG', '.HEIC'].includes(ext)) {
    console.log(`[AI-RAG] generateTokensForFile -> Image path: captioning...`);
    const imageBuffer = await fs.promises.readFile(decryptedFilePath);
    const caption = await getImageCaptionLocal(imageBuffer);
    const captionTokens = caption.length ? caption : path.basename(file.filename, ext);
    tokens = captionTokens
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, "").toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    categories = ["image"];
    textForEmbedding = caption || tokens.join(" ");
    type = "image";
  } else if (['.mp4', '.mov', '.mkv'].includes(ext)) {
    console.log(`[AI-RAG] generateTokensForFile -> Video path: extracting frame + captioning...`);
    const framePath = `${decryptedFilePath}_frame.jpg`;
    await extractFrame(decryptedFilePath, framePath);
    const imageBuffer = await fs.promises.readFile(framePath);
    const caption = await getImageCaptionLocal(imageBuffer);
    const captionTokens = caption.length ? caption : path.basename(file.filename, ext);
    tokens = captionTokens
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, "").toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    categories = ["video"];
    textForEmbedding = caption || tokens.join(" ");
    type = "video";
    fs.promises.unlink(framePath).catch(() => {});
  } else if (['.mp3', '.wav', '.m4a'].includes(ext)) {
    console.log(`[AI-RAG] generateTokensForFile -> Audio path: transcribing...`);
    const audioPath = `${decryptedFilePath}.wav`;
    await extractAudio(decryptedFilePath, audioPath);
    const transcript = await transcribeAudioLocal(audioPath);
    const transcriptSource = transcript.length ? transcript : path.basename(file.filename, ext);
    const { keywords, categories: cats } = await getTokensLocal(transcriptSource);
    tokens = keywords.length ? keywords : normalizeText(transcriptSource).slice(0, 5);
    categories = cats.length ? cats : ["audio"];
    textForEmbedding = transcriptSource;
    type = "audio";
    fs.promises.unlink(audioPath).catch(() => {});
  } else if ([".txt", ".md", ".pdf", ".docx"].includes(ext)) {
    console.log(`[AI-RAG] generateTokensForFile -> Document path: extracting text...`);
    let text = "";
    if (ext === ".pdf") text = (await pdfParse(await fs.promises.readFile(decryptedFilePath))).text;
    else if (ext === ".docx") text = (await mammoth.extractRawText({ path: decryptedFilePath })).value;
    else text = await fs.promises.readFile(decryptedFilePath, "utf8");
    const safeText = text.slice(0, 12000);
    console.log(`[AI-RAG] generateTokensForFile -> Extracted ${safeText.length} chars of text`);
    const { keywords, categories: cats } = await getTokensLocal(safeText);
    tokens = keywords.length ? keywords : normalizeText(safeText).slice(0, 5);
    categories = cats.length ? cats : ["text"];
    textForEmbedding = safeText;
    type = "text";
  } else {
    console.warn(`[AI-RAG] generateTokensForFile <- SKIPPED: Unsupported file extension "${ext}"`);
  }

  fs.promises.unlink(decryptedFilePath).catch(() => {});
  if (!tokens.length) {
    console.warn(`[AI-RAG] generateTokensForFile <- SKIPPED: No tokens extracted for "${file.filename}"`);
    return null;
  }

  // Get dense embedding for the tokens/description
  console.log(`[AI-RAG] generateTokensForFile -> Generating embedding for type=${type}, tokens=[${tokens.join(", ")}]`);
  const embedding = textForEmbedding ? await getTextEmbeddingLocal(textForEmbedding) : [];

  const elapsed = Date.now() - startTime;
  console.log(`[AI-RAG] generateTokensForFile <- DONE in ${elapsed}ms: file="${file.filename}", type=${type}, tokens=[${tokens.join(", ")}], embeddingDim=${embedding.length}`);

  return { fileKey: file.filename, tokens, categories, type, embedding };
}

// --- Indexing: Store tokens & embedding per file ---
export async function addFileToIndex(file: FileInterface) {
  const startTime = Date.now();
  console.log(`[AI-RAG] ===== addFileToIndex START ===== file="${file.filename}", id=${file._id}`);
  try {
    const tokenData = await generateTokensForFile(file);
    if (!tokenData) {
      console.warn(`[AI-RAG] addFileToIndex <- No token data generated, skipping index write for "${file.filename}"`);
      return;
    }
    let index: any[] = [];
    try {
      index = JSON.parse(await fs.promises.readFile("semantic_token_index.json", "utf8"));
      console.log(`[AI-RAG] addFileToIndex -> Loaded existing index with ${index.length} entries`);
    } catch (readErr: any) {
      console.log(`[AI-RAG] addFileToIndex -> No existing index file (will create): ${readErr?.code || readErr?.message}`);
    }
    const updatedIndex = index.filter(item => item.fileKey !== file.filename);
    updatedIndex.push(tokenData);
    await fs.promises.writeFile("semantic_token_index.json", JSON.stringify(updatedIndex, null, 2));
    const elapsed = Date.now() - startTime;
    console.log(`[AI-RAG] ===== addFileToIndex DONE in ${elapsed}ms ===== file="${file.filename}", indexSize=${updatedIndex.length}`);
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[AI-RAG] ===== addFileToIndex FAILED in ${elapsed}ms ===== file="${file.filename}": ${error?.message || error}`);
    console.error(error?.stack || error);
  }
}

// --- Search: LLM-powered vector similarity search ---
export async function searchFiles(query: string, topK = 10): Promise<{ files: any[]; folders: any[] }> {
  console.log(`[AI-RAG] searchFiles -> query="${query}", topK=${topK}`);
  if (typeof query !== "string" || !query) return { files: [], folders: [] };
  let index: any[] = [];
  try {
    index = JSON.parse(await fs.promises.readFile("semantic_token_index.json", "utf8"));
    console.log(`[AI-RAG] searchFiles -> Loaded index with ${index.length} entries`);
  } catch (err: any) {
    console.warn(`[AI-RAG] searchFiles <- No index file found: ${err?.code || err?.message}`);
    return { files: [], folders: [] };
  }
  if (!index.length) {
    console.warn(`[AI-RAG] searchFiles <- Index is empty`);
    return { files: [], folders: [] };
  }

  // Get dense embedding for the query
  const queryEmbedding = await getTextEmbeddingLocal(query);
  console.log(`[AI-RAG] searchFiles -> Query embedding dim=${queryEmbedding.length}`);

  // Score by cosine similarity
  const scored = index
    .map((item: any) => ({
      fileKey: item.fileKey,
      score: cosineSimilarity(queryEmbedding, item.embedding || []),
    }))
    .filter((item: { fileKey: string; score: number }) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  console.log(`[AI-RAG] searchFiles -> Top scores: ${scored.map(s => `${s.fileKey}(${s.score.toFixed(3)})`).join(", ")}`);

  if (!scored.length) {
    console.log(`[AI-RAG] searchFiles <- No matches above threshold`);
    return { files: [], folders: [] };
  }

  type ScoredType = { fileKey: string; score: number };

  const files = await File.find({
    filename: { $in: scored.map((s: ScoredType) => s.fileKey) },
    "metadata.trashed": { $ne: true }
  });
  const filesMap = new Map(files.map((f: any) => [f.filename, f]));
  const filesOrdered = scored
    .map((s: ScoredType) => filesMap.get(s.fileKey))
    .filter(Boolean);

  console.log(`[AI-RAG] searchFiles <- Returning ${filesOrdered.length} files`);
  return { files: filesOrdered, folders: [] };
}