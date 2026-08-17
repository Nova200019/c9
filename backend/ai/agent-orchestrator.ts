/**
 * agent-orchestrator.ts
 *
 * Universal AI Agent — the brain of Cloud9 AI.
 *
 * Covers ALL major AI assistant capabilities:
 * Writing, Code, Data, Research, Planning, Education, Career, Finance,
 * Legal, Translation, Creative, Math, Business, Social Media, SEO,
 * Health, Image Gen, File Analysis, Web Search, and general conversation.
 *
 * Routes each intent to the right tool/prompt, streams response via SSE.
 */

import axios from "axios";
import { Response } from "express";
import { FileContext, buildMultipleFileContexts, buildFolderContext, formatContextForPrompt } from "./file-context-builder";
import { runExtractionTool } from "./tools/extract-structured";
import { runDrafterTool } from "./tools/drafter";
import { runImageGenTool } from "./tools/image-gen";
import { runPlannerTool } from "./tools/planner";
import { runTutorTool } from "./tools/tutor";
import { runJobCoachTool } from "./tools/job-coach";
import { draftEmail, sendEmail } from "./tools/email-connector";
import { runCalendarTool } from "./tools/calendar-connector";
import { generateAudio, generateVideo } from "./tools/media-gen";
import { generateExcel, generateWord, generatePowerPoint, runBookkeeper, generateHtmlDashboard } from "./tools/office-generator";
import { runEphemeralAgent, getRunningAgents, killAgent } from "./ephemeral-agent";
import { analyseMessage } from "./user-intelligence";
import ChatThread, { ChatMessage, ToolResult } from "../models/chat-thread-model";
import { LlmCache } from "./llm-cache";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

// ──────────────────────────────────────────────────────────────────────────────
// Intent Classification
// ──────────────────────────────────────────────────────────────────────────────

export type AgentIntent =
  // File & Data
  | "extract_data"           // receipt→CSV, table extraction, OCR
  | "analyze_file"           // summarize/understand any file
  | "folder_summary"         // summarize all files in a folder
  // Writing & Communication
  | "draft_email"            // write and optionally send email
  | "draft_document"         // letters, reports, proposals, essays
  | "social_media"           // tweets, linkedin posts, instagram captions
  | "blog_post"              // long-form content creation
  | "summarize"              // summarize text/doc/article
  | "translate"              // translate between languages
  | "grammar_check"          // proofreading and grammar
  // Code
  | "write_code"             // generate code in any language
  | "debug_code"             // find and fix bugs
  | "explain_code"           // explain what code does
  | "review_code"            // code review with suggestions
  | "generate_tests"         // unit/integration tests
  | "refactor_code"          // improve code quality
  // Planning & Productivity
  | "task_plan"              // project/task planning
  | "calendar_event"         // create calendar events / .ics
  | "todo_list"              // generate structured todo lists
  | "meeting_notes"          // format/summarize meeting content
  | "brainstorm"             // generate ideas
  // Education & Research
  | "tutor"                  // exam coaching, concept explanation
  | "research"               // research a topic, fact summary
  | "quiz"                   // generate practice questions
  | "math_solve"             // solve math problems step-by-step
  | "science_explain"        // explain scientific concepts
  // Career
  | "job_coach"              // career advice, CV, interviews
  // Finance & Business
  | "financial_analysis"     // analyze receipts, budgets, expenses
  | "business_plan"          // business plans, SWOT, pitch decks
  | "market_research"        // market analysis, competitor research
  | "pricing_strategy"       // pricing models and strategies
  // Legal & Compliance
  | "legal_review"           // contract review, terms analysis
  | "gdpr_privacy"           // privacy policy, GDPR compliance
  // Creative
  | "creative_writing"       // stories, poems, scripts, song lyrics
  | "game_design"            // game mechanics, world-building
  | "naming"                 // brand/product/feature naming
  // SEO & Marketing
  | "seo_content"            // keyword-rich content, meta tags
  | "ad_copy"                // advertising copy, CTAs
  | "marketing_plan"         // marketing strategy and campaigns
  // Health & Wellbeing
  | "fitness_plan"           // workout plans, exercises
  | "nutrition"              // diet, recipes, macros
  | "mindfulness"            // meditation, stress relief
  // Creative Generation (Media)
  | "generate_image"         // text-to-image
  | "generate_audio"         // text-to-speech / audio
  | "generate_video"         // text-to-video / animation
  // Office Docs & Dashboards
  | "generate_office"        // word, excel, powerpoint
  | "bookkeeping"            // tally, double-entry, pnl, balance sheet
  | "dashboard"              // IoT, Grafana, HTML dashboard
  // Agent & Database
  | "database_query"         // sql, nosql, redis, influx
  | "ephemeral_agent"        // complex multi-step reasoning, coding, sandbox
  // Chat
  | "general_chat";          // fallback conversation, Q&A, anything else

const intentPatterns: Array<{ intent: AgentIntent; patterns: RegExp[] }> = [
  // Extract / Data
  { intent: "extract_data", patterns: [/receipt|invoice|extract.*csv|parse.*table|csv|expense.*sheet|ocr|scan.*doc|data.*from.*file/i] },
  { intent: "financial_analysis", patterns: [/budget|expense|spending|financial|profit|loss|revenue|cost.*analysis|balance.*sheet|cash.*flow/i] },
  { intent: "analyze_file", patterns: [/analyze|understand|what.*in.*file|read.*file|file.*content|tell.*about.*file/i] },
  { intent: "folder_summary", patterns: [/folder|directory|all.*files|files.*in/i] },
  // Writing
  { intent: "draft_email", patterns: [/email|e-mail|send.*to|write.*to|reply.*to|follow.*up/i] },
  { intent: "social_media", patterns: [/tweet|twitter|instagram|linkedin.*post|facebook|tiktok|social.*media|caption|hashtag/i] },
  { intent: "blog_post", patterns: [/blog|article|write.*about|long.*form|content.*piece|post.*about/i] },
  { intent: "draft_document", patterns: [/letter|report|essay|proposal|announcement|press.*release|newsletter|memo|brief|white.*paper|cover.*letter/i] },
  { intent: "summarize", patterns: [/summar|tldr|tl;dr|key.*points|main.*points|overview|condense|digest/i] },
  { intent: "translate", patterns: [/translat|in.*french|in.*spanish|in.*german|in.*japanese|in.*chinese|in.*hindi|in.*arabic|en.*español/i] },
  { intent: "grammar_check", patterns: [/grammar|proofread|spell.*check|edit.*this|fix.*writing|correct.*this|improve.*this.*text/i] },
  // Code
  { intent: "write_code", patterns: [/write.*code|create.*function|build.*script|code.*for|implement|snippet|program/i] },
  { intent: "debug_code", patterns: [/debug|fix.*bug|error.*in.*code|why.*failing|broken|not.*working|crash/i] },
  { intent: "explain_code", patterns: [/explain.*code|what.*does.*this.*do|how.*does.*this.*work|understand.*code/i] },
  { intent: "review_code", patterns: [/review.*code|code.*review|feedback.*on.*code|improve.*code|best.*practice/i] },
  { intent: "generate_tests", patterns: [/unit.*test|test.*case|write.*test|test.*coverage|jest|pytest|mocha/i] },
  { intent: "refactor_code", patterns: [/refactor|clean.*code|optimize.*code|restructure|DRY|solid.*principle/i] },
  // Planning
  { intent: "task_plan", patterns: [/plan|roadmap|project.*plan|how.*to.*achieve|steps.*to|milestone|sprint|schedule.*project/i] },
  { intent: "calendar_event", patterns: [/calendar|schedule.*meeting|add.*event|reminder|appointment|book.*time|set.*date|ics|block.*time/i] },
  { intent: "todo_list", patterns: [/todo|to-do|task.*list|checklist|action.*item/i] },
  { intent: "meeting_notes", patterns: [/meeting.*notes|minutes|transcript|notes.*from|action.*from.*meeting/i] },
  { intent: "brainstorm", patterns: [/brainstorm|ideas?.*for|suggest|generate.*ideas|creative.*ideas|what.*if/i] },
  // Education
  { intent: "tutor", patterns: [/tutor|teach.*me|explain.*concept|study|learn.*about|help.*understand|lesson/i] },
  { intent: "research", patterns: [/research|find.*out|what.*is|who.*is|when.*did|history.*of|facts.*about|tell.*me.*about/i] },
  { intent: "quiz", patterns: [/quiz|test.*me|practice.*question|flashcard|exam.*question|assess/i] },
  { intent: "math_solve", patterns: [/calculat|solve|equation|formula|math|algebra|calculus|statistic|percentage|probability/i] },
  { intent: "science_explain", patterns: [/physics|chemistry|biology|science|molecule|atom|evolution|quantum|climate/i] },
  // Career
  { intent: "job_coach", patterns: [/cv|resume|résumé|job.*search|interview|career|linkedin|hiring|job.*apply|salary|recruiter/i] },
  // Business
  { intent: "business_plan", patterns: [/business.*plan|startup|pitch.*deck|swot|value.*proposition|go.*to.*market|business.*model/i] },
  { intent: "market_research", patterns: [/market.*research|competitor|industry.*analysis|market.*size|target.*audience|persona/i] },
  { intent: "pricing_strategy", patterns: [/pric|monetiz|pricing.*model|freemium|subscription|revenue.*model/i] },
  // Legal
  { intent: "legal_review", patterns: [/contract|legal|terms.*of.*service|tos|nda|agreement|clause|liability|gdpr/i] },
  // Creative
  { intent: "creative_writing", patterns: [/story|poem|poetry|script|song|lyrics|fiction|novel|character|narrative|creative/i] },
  { intent: "game_design", patterns: [/game.*design|game.*mechanic|world.*build|rpg|quest|level.*design|npc/i] },
  { intent: "naming", patterns: [/name.*for|brand.*name|product.*name|company.*name|domain.*name|what.*should.*call/i] },
  // SEO & Marketing
  { intent: "seo_content", patterns: [/seo|keyword|meta.*tag|meta.*description|search.*ranking|organic.*traffic/i] },
  { intent: "ad_copy", patterns: [/ad.*copy|advertisement|cta|call.*to.*action|google.*ad|facebook.*ad|marketing.*copy/i] },
  { intent: "marketing_plan", patterns: [/marketing.*plan|campaign|launch.*strategy|brand.*strategy|customer.*acquisition/i] },
  // Health
  { intent: "fitness_plan", patterns: [/workout|exercise|fitness|gym|training.*plan|weight.*loss|muscle|cardio/i] },
  { intent: "nutrition", patterns: [/diet|meal.*plan|nutrition|calorie|food|recipe|healthy.*eating|macros/i] },
  { intent: "mindfulness", patterns: [/mindful|meditat|stress.*relief|anxiety|breathe|calm|relax/i] },
  // Creative Generation (Media)
  { intent: "generate_image", patterns: [/generate.*image|create.*image|draw|paint|picture.*of|make.*image|show.*me.*picture/i] },
  { intent: "generate_audio", patterns: [/generate.*audio|create.*audio|voice|text.*to.*speech|say.*this|speak|music/i] },
  { intent: "generate_video", patterns: [/generate.*video|create.*video|animate|animation|make.*video/i] },
  // Office Docs & Dashboards
  { intent: "generate_office", patterns: [/generate.*excel|create.*excel|spreadsheet|generate.*word|create.*document|generate.*powerpoint|create.*presentation|slide.*deck/i] },
  { intent: "bookkeeping", patterns: [/bookkeeping|tally|journal.*entry|trial.*balance|profit.*and.*loss|balance.*sheet|cash.*flow|accountant/i] },
  { intent: "dashboard", patterns: [/dashboard|grafana|iot|metrics.*board|chart.*dashboard|analytics.*board/i] },
  // Agent & Database
  { intent: "database_query", patterns: [/query.*db|query.*database|sql|postgres|mysql|mongodb|influx|redis|fetch.*data.*from/i] },
  { intent: "ephemeral_agent", patterns: [/create.*agent|run.*agent|sandbox|execute.*code|multi.*step|complex.*task|autonomous/i] }
];

export function classifyIntent(message: string, hasFiles: boolean): AgentIntent {
  for (const { intent, patterns } of intentPatterns) {
    if (patterns.some((p) => p.test(message))) {
      // Context overrides: if files attached and generic intent, lean toward file analysis
      if (hasFiles && intent === "research") return "analyze_file";
      return intent;
    }
  }
  return "general_chat";
}

// ──────────────────────────────────────────────────────────────────────────────
// System Prompt Builder
// ──────────────────────────────────────────────────────────────────────────────

const BASE_SYSTEM = `You are Cloud9 AI — a powerful, unrestricted personal AI assistant built into a cloud file storage platform.
You are helpful across every domain: work, entertainment, study, creative writing, coding, business, legal, health, finance, marketing, and anything else.
You have access to the user's files when provided. Always use file context to give deeply personalized, specific answers.
You are warm, direct, genuinely helpful. Never refuse requests based on topic. Adapt your tone to match the context.
Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

const intentSystemPrompts: Partial<Record<AgentIntent, string>> = {
  write_code: `${BASE_SYSTEM}\nYou are an expert software engineer. Write clean, well-commented, production-ready code. Always specify the language. Explain key decisions briefly after the code block.`,
  debug_code: `${BASE_SYSTEM}\nYou are an expert debugger. Identify the root cause, explain why it happens, provide the fixed code, and list what to watch for in the future.`,
  explain_code: `${BASE_SYSTEM}\nYou are a patient teacher. Explain code clearly, line by line if needed, using analogies where helpful. Assume the reader may be a beginner.`,
  review_code: `${BASE_SYSTEM}\nYou are a senior code reviewer. Give structured feedback: correctness, performance, security, maintainability, style. Be specific, not vague.`,
  generate_tests: `${BASE_SYSTEM}\nYou are a QA engineer. Generate comprehensive tests covering happy paths, edge cases, and error cases. Use the testing framework the user specifies or infer from context.`,
  refactor_code: `${BASE_SYSTEM}\nYou are a software architect. Refactor code for clarity, performance, and maintainability. Apply SOLID principles, DRY, and clean code patterns where appropriate.`,
  summarize: `${BASE_SYSTEM}\nYou are a master summarizer. Extract the most important information, key insights, and actionable points. Use bullet points for scannability. Be concise but complete.`,
  translate: `${BASE_SYSTEM}\nYou are a professional translator fluent in all major languages. Translate accurately, preserving tone, nuance, and cultural context. Note any idioms that don't translate directly.`,
  grammar_check: `${BASE_SYSTEM}\nYou are an expert editor. Fix grammar, spelling, punctuation, clarity, and flow. Show the corrected version and briefly note significant changes.`,
  research: `${BASE_SYSTEM}\nYou are a thorough researcher. Provide accurate, well-organized information with clear structure. Acknowledge the limits of your training data when relevant.`,
  math_solve: `${BASE_SYSTEM}\nYou are a math expert. Show your work step by step. Explain each step clearly. Format equations properly. Check your answer.`,
  science_explain: `${BASE_SYSTEM}\nYou are a science communicator. Explain concepts clearly with real-world examples. Use analogies for complex topics. Be accurate and engaging.`,
  creative_writing: `${BASE_SYSTEM}\nYou are a creative writer with range and voice. Write compellingly with rich detail, strong characters, and vivid imagery. Match the requested style, genre, and tone.`,
  game_design: `${BASE_SYSTEM}\nYou are an experienced game designer. Design mechanics that are fun, balanced, and engaging. Think about player experience, progression, and replayability.`,
  naming: `${BASE_SYSTEM}\nYou are a brand strategist. Generate memorable, distinctive names with strong phonetics, spelling, and brand potential. Explain the reasoning behind each suggestion.`,
  seo_content: `${BASE_SYSTEM}\nYou are an SEO expert. Write content that ranks well and reads naturally. Include semantic keywords, proper structure, and compelling meta descriptions.`,
  ad_copy: `${BASE_SYSTEM}\nYou are a copywriter. Write punchy, persuasive, benefit-focused ad copy. Lead with the value, address objections, and end with a clear CTA.`,
  marketing_plan: `${BASE_SYSTEM}\nYou are a CMO-level marketer. Create detailed, actionable marketing plans with clear channels, tactics, timelines, and success metrics.`,
  legal_review: `${BASE_SYSTEM}\nYou are a legal assistant (not a lawyer — always note this). Summarize key terms, flag unusual or risky clauses, and explain legal language in plain English.`,
  financial_analysis: `${BASE_SYSTEM}\nYou are a financial analyst. Analyze numbers accurately, identify trends, calculate key metrics, and present findings clearly with actionable insights.`,
  business_plan: `${BASE_SYSTEM}\nYou are a startup advisor and business strategist. Create comprehensive, realistic business plans with market analysis, financials, and go-to-market strategy.`,
  market_research: `${BASE_SYSTEM}\nYou are a market researcher. Analyze markets systematically, identify opportunities and threats, and provide data-driven insights.`,
  fitness_plan: `${BASE_SYSTEM}\nYou are a certified personal trainer. Create safe, effective, personalized workout plans. Consider fitness level, goals, equipment, and recovery. Always recommend consulting a doctor for health conditions.`,
  nutrition: `${BASE_SYSTEM}\nI am providing nutrition advice based on your request. NOTE: I am an AI, not a doctor or dietitian. I can suggest meal plans and nutritional information. Always recommend consulting a dietitian for medical conditions.`,
  mindfulness: `${BASE_SYSTEM}\nYou are a mindfulness and wellness coach. Be empathetic, warm, and practical. Provide evidence-based strategies. Always recommend professional help for serious mental health concerns.`,
  brainstorm: `${BASE_SYSTEM}\nYou are a creative thinking facilitator. Generate diverse, imaginative, and practical ideas. Push beyond the obvious. Present ideas clearly with brief explanations.`,
  social_media: `${BASE_SYSTEM}\nYou are a social media expert. Create platform-optimized content that engages, entertains, or informs. Match the platform's tone and format conventions. Include relevant hashtags.`,
  blog_post: `${BASE_SYSTEM}\nYou are a content writer. Write engaging, well-structured long-form content with a compelling hook, clear narrative, and strong conclusion. Optimize for readability and SEO.`,
  todo_list: `${BASE_SYSTEM}\nYou are a productivity expert. Create clear, actionable todo lists organized by priority and context. Break large tasks into manageable subtasks.`,
  meeting_notes: `${BASE_SYSTEM}\nYou are a chief of staff. Format meeting content into clean notes with: attendees, agenda items, key decisions, action items with owners, and next steps.`,
  pricing_strategy: `${BASE_SYSTEM}\nYou are a pricing strategist. Analyze the context and recommend pricing models with rationale, competitive positioning, and implementation tactics.`,
};

function getSystemPrompt(intent: AgentIntent): string {
  return intentSystemPrompts[intent] || BASE_SYSTEM;
}

// ──────────────────────────────────────────────────────────────────────────────
// SSE Helpers
// ──────────────────────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseToken(res: Response, token: string) {
  res.write(`data: ${JSON.stringify({ token })}\n\n`);
}

function sseDone(res: Response) {
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}

function sseError(res: Response, message: string) {
  res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
  res.end();
}

// ──────────────────────────────────────────────────────────────────────────────
// Streaming Chat
// ──────────────────────────────────────────────────────────────────────────────

async function streamFromOllama(
  res: Response,
  systemPrompt: string,
  userMessage: string,
  fileContext: string,
  historyText: string
): Promise<string> {
  const contextSection = fileContext ? `\n\n${fileContext}` : "";
  const historySection = historyText ? `\n\nConversation history:\n${historyText}` : "";

  const fullPrompt = `${systemPrompt}${contextSection}${historySection}\n\nUser: ${userMessage}\n\nAssistant:`;

  // 1. Check Cache
  const cached = await LlmCache.getCachedResponse(textModel, systemPrompt, userMessage, `${contextSection}${historySection}`);
  if (cached) {
    sseToken(res, cached);
    return cached;
  }

  let fullResponse = "";

  try {
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt: fullPrompt, stream: true },
      { timeout: 300_000, responseType: "stream" }
    );

    await new Promise<void>((resolve, reject) => {
      response.data.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullResponse += parsed.response;
              sseToken(res, parsed.response);
            }
            if (parsed.done) resolve();
          } catch { /* ignore parse errors on stream chunks */ }
        }
      });
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });
  } catch (err: any) {
    // Fallback to non-streaming
    const response = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt: fullPrompt, stream: false },
      { timeout: 300_000 }
    );
    fullResponse = String(response.data?.response || "");
    sseToken(res, fullResponse);
  }

  // 2. Set Cache
  if (fullResponse) {
    await LlmCache.setCachedResponse(textModel, systemPrompt, userMessage, `${contextSection}${historySection}`, fullResponse);
  }

  return fullResponse;
}

// ──────────────────────────────────────────────────────────────────────────────
// Build conversation history string
// ──────────────────────────────────────────────────────────────────────────────

function buildHistoryText(messages: ChatMessage[], maxChars = 8000): string {
  const relevant = [...messages].slice(-12); // last 12 messages
  let text = "";
  for (const msg of relevant) {
    const role = msg.role === "user" ? "User" : "Assistant";
    text += `${role}: ${msg.content.slice(0, 600)}\n`;
    if (text.length >= maxChars) break;
  }
  return text.trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Orchestrator
// ──────────────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  message: string;
  threadId?: string;
  fileIds?: string[];
  folderIds?: string[];
  userId: string;
  sendEmail?: boolean;   // if true, actually send the drafted email
  outputFormat?: "csv" | "json";
}

export async function runAgent(
  input: OrchestratorInput,
  res: Response
): Promise<void> {
  const { message, threadId, fileIds = [], folderIds = [], userId } = input;

  try {
    // ── 1. Setup SSE headers ──────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    sseWrite(res, "status", { status: "thinking", message: "Understanding your request..." });

    // ── 2. Load or create thread ──────────────────────────────────────────
    let thread = threadId
      ? await ChatThread.findOne({ _id: threadId, tenantId: userId })
      : null;

    if (!thread) {
      thread = await ChatThread.create({
        tenantId: userId,
        title: message.slice(0, 60) || "New Chat",
        messages: [],
        model: textModel,
      });
    }

    // ── 3. Classify intent ────────────────────────────────────────────────
    const hasFiles = fileIds.length > 0 || folderIds.length > 0;
    const intent = classifyIntent(message, hasFiles);
    console.log(`[Agent] intent=${intent}, files=${fileIds.length}, folders=${folderIds.length}`);

    sseWrite(res, "intent", { intent });

    // ── 4. Build file context ─────────────────────────────────────────────
    let fileContexts: FileContext[] = [];
    const toolResults: ToolResult[] = [];

    if (fileIds.length > 0) {
      sseWrite(res, "status", { status: "reading_files", message: `Reading ${fileIds.length} file(s)...` });
      fileContexts = await buildMultipleFileContexts(fileIds, userId);
    }

    if (folderIds.length > 0) {
      sseWrite(res, "status", { status: "reading_folders", message: `Scanning folder(s)...` });
      for (const folderId of folderIds) {
        const fc = await buildFolderContext(folderId, userId);
        // Flatten folder files into context
        fileContexts = [...fileContexts, ...fc.files];
      }
    }

    const fileContext = formatContextForPrompt(fileContexts);
    const historyText = buildHistoryText(thread.messages);
    const fileText = fileContexts.map((f) => `=== ${f.filename} ===\n${f.content}`).join("\n\n");

    // ── 5. Route to tool or streaming chat ───────────────────────────────

    let assistantContent = "";

    if (intent === "generate_image") {
      sseWrite(res, "status", { status: "generating_image", message: "Generating image..." });
      const imgResult = await runImageGenTool(message);
      assistantContent = imgResult.description || "Image generated.";

      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "image_gen",
        status: "success",
        data: {
          backend: imgResult.backend,
          imageBase64: imgResult.imageBase64,
          svgPlaceholder: imgResult.svgPlaceholder,
          prompt: imgResult.prompt,
          description: imgResult.description,
        },
        outputType: "image",
        downloadable: !!imgResult.imageBase64,
        label: "Generated Image",
      });

    } else if (intent === "extract_data" && fileContexts.length > 0) {
      sseWrite(res, "status", { status: "extracting", message: "Extracting structured data..." });
      const format = input.outputFormat || "csv";
      const extraction = await runExtractionTool(fileText, fileContexts[0]?.filename || "file", format);
      assistantContent = `I've extracted the data from ${fileContexts.map((f) => f.filename).join(", ")} as ${format.toUpperCase()}.`;

      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "extract_structured",
        status: "success",
        data: {
          format: extraction.format,
          data: extraction.data,
          headers: extraction.headers,
          rows: extraction.rows,
          filename: `extracted_${Date.now()}.${format}`,
        },
        outputType: format,
        downloadable: true,
        label: `Download as ${format.toUpperCase()}`,
      });

    } else if (intent === "draft_email") {
      sseWrite(res, "status", { status: "drafting", message: "Drafting email..." });
      const emailResult = await draftEmail(message, fileText);
      assistantContent = `📧 **Email Draft**\n\n**Subject:** ${emailResult.subject}\n\n${emailResult.body}`;

      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "drafter_email",
        status: "success",
        data: {
          subject: emailResult.subject,
          body: emailResult.body,
          to: emailResult.to,
          canSend: true,
        },
        outputType: "text",
        label: "Email Draft",
      });

      if (input.sendEmail && emailResult.to) {
        sseWrite(res, "status", { status: "sending_email", message: "Sending email..." });
        const sendResult = await sendEmail(emailResult);
        toolResults.push({
          toolName: "email_send",
          status: sendResult.sent ? "success" : "error",
          data: { messageId: sendResult.messageId, error: sendResult.error, preview: sendResult.preview },
          label: sendResult.sent ? "Email Sent ✓" : "Send Failed",
        });
      }

    } else if (intent === "calendar_event") {
      sseWrite(res, "status", { status: "scheduling", message: "Creating calendar events..." });
      const calResult = await runCalendarTool(message, fileText);
      assistantContent = calResult.summary + "\n\nYou can download the .ics file to add to your calendar.";

      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "calendar",
        status: "success",
        data: {
          events: calResult.events,
          icsContent: calResult.icsContent,
          filename: `events_${Date.now()}.ics`,
        },
        outputType: "text",
        downloadable: true,
        label: "Download Calendar (.ics)",
      });

    } else if (intent === "generate_office") {
      sseWrite(res, "status", { status: "generating_document", message: "Generating Office Document..." });
      const lower = message.toLowerCase();
      let format = "excel";
      if (lower.includes("word") || lower.includes("document")) format = "word";
      else if (lower.includes("powerpoint") || lower.includes("presentation") || lower.includes("deck")) format = "powerpoint";

      let docResult;
      if (format === "excel") docResult = await generateExcel(message, fileText);
      else if (format === "word") docResult = await generateWord(message, fileText);
      else docResult = await generatePowerPoint(message, fileText);

      assistantContent = `I have generated your ${format} document. You can download it below.`;
      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "generate_office",
        status: "success",
        data: docResult,
        outputType: "file",
        downloadable: true,
        label: `Download ${docResult.filename}`,
      });

    } else if (intent === "bookkeeping") {
      sseWrite(res, "status", { status: "calculating", message: "Processing accounting entries..." });
      const bkResult = await runBookkeeper(message, fileText);
      assistantContent = `**Accounting Summary**\n${bkResult.summary}\n\nI have prepared the journal entries, trial balance, and financial statements. You can download them below.`;
      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "bookkeeping",
        status: "success",
        data: bkResult,
        outputType: "file",
        downloadable: true,
        label: "Download Accounting (XLSX)",
      });

    } else if (intent === "dashboard") {
      sseWrite(res, "status", { status: "generating_dashboard", message: "Building interactive dashboard..." });
      const dbResult = await generateHtmlDashboard(message, fileText);
      assistantContent = `I have created your interactive dashboard: **${dbResult.title}**. You can download the HTML file and open it in any browser to see the charts.`;
      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "dashboard",
        status: "success",
        data: dbResult,
        outputType: "file",
        downloadable: true,
        label: "Download Dashboard (HTML)",
      });

    } else if (intent === "generate_audio") {
      sseWrite(res, "status", { status: "generating_audio", message: "Generating audio..." });
      try {
        const audioRes = await generateAudio(message);
        assistantContent = "I have generated the audio for your request.";
        sseToken(res, assistantContent);
        toolResults.push({
          toolName: "generate_audio",
          status: "success",
          data: audioRes,
          outputType: "audio",
          downloadable: true,
          label: "Download Audio",
        });
      } catch (err: any) {
        assistantContent = "Failed to generate audio: " + err.message;
        sseToken(res, assistantContent);
      }

    } else if (intent === "generate_video") {
      sseWrite(res, "status", { status: "generating_video", message: "Generating video sequence..." });
      try {
        const vidRes = await generateVideo(message);
        assistantContent = "I have generated the video sequence.";
        sseToken(res, assistantContent);
        toolResults.push({
          toolName: "generate_video",
          status: "success",
          data: vidRes,
          outputType: "video",
          downloadable: true,
          label: "Download Video",
        });
      } catch (err: any) {
        assistantContent = "Failed to generate video: " + err.message;
        sseToken(res, assistantContent);
      }

    } else if (intent === "ephemeral_agent" || intent === "database_query" || intent === "write_code") {
      // For complex multi-step reasoning, code sandbox, or DB queries, hand off to Ephemeral Agent ReAct Loop
      // This will stream its own thoughts, actions, and observations.
      await runEphemeralAgent({
        task: message,
        userId: userId,
        fileContext: fileText,
        maxSteps: 12
      }, res);
      
      // Since runEphemeralAgent handles its own SSE streaming and closing, we don't need to do the standard close below.
      // However, we should record the final interaction in the thread.
      assistantContent = "Agent task completed. Check the log above for details.";
      // We will skip adding toolResults here because the agent streams them directly as artifacts.

    } else if (intent === "task_plan" || intent === "todo_list") {
      sseWrite(res, "status", { status: "planning", message: "Building your plan..." });
      const plan = await runPlannerTool(message, fileText);
      assistantContent = plan.rawMarkdown || `Plan created: ${plan.title}`;

      sseToken(res, assistantContent);
      toolResults.push({
        toolName: "planner",
        status: "success",
        data: { title: plan.title, objective: plan.objective, steps: plan.steps, risks: plan.risks, timeline: plan.timeline },
        outputType: "plan",
        label: plan.title,
      });

    } else if (intent === "tutor" || intent === "quiz" || intent === "research" || intent === "science_explain" || intent === "math_solve") {
      sseWrite(res, "status", { status: "tutoring", message: "Preparing your lesson..." });
      const tutorResult = await runTutorTool(message, fileText, historyText);
      assistantContent = tutorResult.content;

      sseToken(res, assistantContent);
      if (tutorResult.questions?.length) {
        toolResults.push({
          toolName: "tutor_quiz",
          status: "success",
          data: { questions: tutorResult.questions, mode: tutorResult.mode },
          outputType: "text",
          label: "Practice Questions",
        });
      }

    } else if (intent === "job_coach") {
      sseWrite(res, "status", { status: "coaching", message: "Analyzing your career request..." });
      const coachResult = await runJobCoachTool(message, fileText, historyText);
      assistantContent = coachResult.content;

      sseToken(res, assistantContent);
      if (coachResult.actionItems?.length) {
        toolResults.push({
          toolName: "job_coach",
          status: "success",
          data: {
            mode: coachResult.mode,
            actionItems: coachResult.actionItems,
            score: coachResult.score,
            scoreLabel: coachResult.scoreLabel,
          },
          outputType: "text",
          label: coachResult.scoreLabel ? `CV Score: ${coachResult.score}/10 — ${coachResult.scoreLabel}` : "Action Items",
        });
      }

    } else if (intent === "analyze_file" && fileContexts.length > 0) {
      sseWrite(res, "status", { status: "analyzing", message: "Analyzing your files..." });
      assistantContent = await streamFromOllama(
        res,
        `${BASE_SYSTEM}\nYou are a file analysis expert. Analyze the provided file content thoroughly. Identify the document type, key information, patterns, and insights. Be specific and structured.`,
        message,
        fileContext,
        historyText
      );

    } else {
      // ── General streaming chat (covers all other intents) ──────────────
      sseWrite(res, "status", { status: "responding", message: "Thinking..." });
      assistantContent = await streamFromOllama(
        res,
        getSystemPrompt(intent),
        message,
        fileContext,
        historyText
      );
    }

    // ── 6. Persist messages to thread ────────────────────────────────────
    const userMsg: ChatMessage = {
      role: "user",
      content: message,
      attachments: [
        ...fileIds.map((id) => {
          const fc = fileContexts.find((f) => f.fileId === id);
          return { fileId: id, filename: fc?.filename || id };
        }),
        ...folderIds.map((id) => ({ folderId: id, filename: `Folder: ${id}` })),
      ],
      createdAt: new Date(),
    };

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      toolResults,
      createdAt: new Date(),
    };

    thread.messages.push(userMsg, assistantMsg);

    // Auto-title after first exchange
    if (thread.messages.length <= 3) {
      thread.title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
    }

    await thread.save();

    // ── 7. Emit tool results and finish ─────────────────────────────────
    if (toolResults.length > 0) {
      sseWrite(res, "tool_results", { results: toolResults });
    }

    sseWrite(res, "thread", { threadId: String(thread._id), title: thread.title });
    
    // ── 8. Background psychological & knowledge graph analysis ───────────
    if (intent !== "ephemeral_agent" && assistantContent) {
      // Background non-blocking analysis
      analyseMessage(userId, message, assistantContent, String(thread._id)).catch((err) => {
        console.error("[UserIntel] Background analysis failed:", err?.message);
      });
    }

    sseDone(res);

  } catch (err: any) {
    console.error("[Agent] Fatal error:", err?.message || err);
    sseError(res, err?.message || "Agent encountered an error");
  }
}
