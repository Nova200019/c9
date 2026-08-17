import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:7b-instruct";
const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 120,
});

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
  "their",
  "there",
  "them",
  "then",
  "than",
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

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));

const heuristicInsights = (text: string) => {
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
    summary: ranked.slice(0, 3).join(" "),
  };
};

const parseInsights = (output: string) => {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  const raw = jsonMatch ? jsonMatch[0] : output;
  const parsed = JSON.parse(raw);

  return {
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((value: string) => String(value).trim()).filter(Boolean).slice(0, 5)
      : [],
    categories: Array.isArray(parsed.categories)
      ? parsed.categories.map((value: string) => String(value).trim()).filter(Boolean).slice(0, 5)
      : [],
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
  };
};

export async function splitDocumentIntoChunks(text: string) {
  return splitter.splitText(text);
}

export async function analyzeText(text: string) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return { keywords: [], categories: [], summary: "" };
  }

  const startTime = Date.now();
  console.log(`[AI-RAG] analyzeText -> textLen=${trimmedText.length}`);

  const chunks = await splitDocumentIntoChunks(trimmedText);
  const focusedText = chunks.slice(0, 4).join("\n\n").slice(0, 12000);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are a local file analysis engine.",
        "Return only strict JSON with keywords, categories, and summary.",
        'Shape: {"keywords": ["..."], "categories": ["..."], "summary": "..."}',
        "Keep keywords short and practical.",
      ].join(" "),
    ],
    ["human", "Analyze this text:\n\n{input}"],
  ]);

  try {
    const formattedPrompt = await prompt.format({ input: focusedText });
    console.log(`[AI-RAG] analyzeText -> Calling Ollama (model=${textModel})...`);
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      {
        model: textModel,
        prompt: formattedPrompt,
        stream: false,
      },
      { timeout: 120000 }
    );
    const output = typeof response.data?.response === "string" ? response.data.response : "";
    const result = parseInsights(String(output));
    console.log(`[AI-RAG] analyzeText <- OK in ${Date.now() - startTime}ms: keywords=[${result.keywords.join(", ")}]`);
    return result;
  } catch (error: any) {
    console.warn(`[AI-RAG] analyzeText <- Ollama failed in ${Date.now() - startTime}ms: ${error?.message || error}. Using heuristic.`);
    return heuristicInsights(focusedText);
  }
}

export async function embedTextWithChain(text: string) {
  const trimmedText = text.trim();
  if (!trimmedText) return [];

  const startTime = Date.now();
  console.log(`[AI-RAG] embedTextWithChain -> textLen=${trimmedText.length}`);

  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/embeddings`,
      { model: embeddingModel, prompt: trimmedText },
      { timeout: 120000 }
    );
    if (Array.isArray(response.data?.embedding)) {
      console.log(`[AI-RAG] embedTextWithChain <- OK in ${Date.now() - startTime}ms, dim=${response.data.embedding.length}`);
      return response.data.embedding;
    }
    console.warn(`[AI-RAG] embedTextWithChain <- Ollama returned non-array embedding`);
  } catch (error: any) {
    console.warn(`[AI-RAG] embedTextWithChain <- Ollama failed: ${error?.message || error}. Using hash fallback.`);
    const tokens = normalizeText(trimmedText);
    const dimensions = 128;
    const vector = new Array(dimensions).fill(0);

    for (const token of tokens) {
      let hash = 0;
      for (let index = 0; index < token.length; index += 1) {
        hash = (hash * 31 + token.charCodeAt(index)) | 0;
      }
      vector[Math.abs(hash) % dimensions] += 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude ? vector.map((value) => value / magnitude) : vector;
  }
}

export async function chatWithLocalModel(input: string) {
  const startTime = Date.now();
  console.log(`[AI-RAG] chatWithLocalModel -> model=${textModel}, inputLen=${input.length}`);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are the local on-device assistant for file search, planning, and agentic actions.",
        "Prefer concrete steps, JSON when asked, and avoid external dependencies.",
      ].join(" "),
    ],
    ["human", "{input}"],
  ]);

  const formattedPrompt = await prompt.format({ input });
  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    {
      model: textModel,
      prompt: formattedPrompt,
      stream: false,
    },
    { timeout: 120000 }
  );

  const result = await new StringOutputParser().parse(response.data?.response || "");
  console.log(`[AI-RAG] chatWithLocalModel <- OK in ${Date.now() - startTime}ms, responseLen=${String(result).length}`);
  return result;
}
