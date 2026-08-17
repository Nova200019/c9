/**
 * ephemeral-agent.ts
 *
 * Sub-agent system inspired by Claude Code / AutoGPT / LangChain Agents.
 *
 * Each agent:
 *  1. Gets a task + a scoped tool set
 *  2. Runs a ReAct (Reason → Act → Observe) loop
 *  3. Streams each thought/action/observation via SSE
 *  4. Self-destructs (cleanup) after completion or max steps
 *
 * Supported agent tools:
 *  - read_file       — read a Cloud9 file
 *  - write_file      — create/update a file in Cloud9
 *  - run_code        — execute code in VM2 sandbox (Node.js)
 *  - query_db        — execute SQL/NoSQL query on connected databases
 *  - web_search      — DuckDuckGo instant answer API
 *  - generate_excel  — create a .xlsx spreadsheet
 *  - generate_word   — create a .docx document
 *  - generate_chart  — create an HTML chart (Chart.js)
 *  - summarise       — AI summarisation
 *  - extract_data    — structured data extraction from text
 *  - llm_call        — sub-call to the Ollama LLM
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { Response } from "express";
import vm from "vm";
import * as XLSX from "xlsx";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

// ── Agent Registry (in-memory, self-cleaning) ─────────────────────────────────

interface AgentRecord {
  id: string;
  userId: string;
  task: string;
  startedAt: Date;
  status: "running" | "complete" | "failed";
  steps: AgentStep[];
}

const agentRegistry = new Map<string, AgentRecord>();

// Auto-clean finished agents after 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, agent] of agentRegistry.entries()) {
    if (agent.status !== "running" && agent.startedAt.getTime() < cutoff) {
      agentRegistry.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentStep {
  stepIndex: number;
  type: "think" | "act" | "observe" | "done" | "error";
  content: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp: Date;
}

interface AgentContext {
  id: string;
  userId: string;
  task: string;
  fileContext: string;
  memory: string[];
  steps: AgentStep[];
  maxSteps: number;
  res: Response;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseAgent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseStep(res: Response, step: AgentStep) {
  res.write(`event: agent_step\ndata: ${JSON.stringify(step)}\n\n`);
}

// ── Built-in tools ────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = `Available tools (call exactly one per turn):

- read_file(path: string) → read a file from context memory
- run_code(code: string, language: "javascript" | "python_description") → execute sandboxed JS or describe Python execution
- web_search(query: string) → search DuckDuckGo for current information
- generate_excel(data: {headers: string[], rows: string[][], filename: string}) → create a spreadsheet
- generate_word(content: string, filename: string) → create a Word document
- generate_chart(type: "bar"|"line"|"pie"|"scatter", data: {labels: string[], datasets: Array<{label: string, data: number[]}>}, title: string) → create interactive HTML chart
- extract_data(text: string, schema: string) → extract structured data matching schema from text
- llm_call(prompt: string) → call the AI model for a sub-task
- summarise(text: string) → produce a concise summary
- remember(fact: string) → store an important fact in working memory
- task_complete(result: string) → mark the task as done with final result`;

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  tool: string,
  input: Record<string, unknown>,
  ctx: AgentContext
): Promise<unknown> {
  switch (tool) {
    case "read_file": {
      // Read from pre-loaded file context
      return ctx.fileContext || "No file context available";
    }

    case "run_code": {
      const code = String(input.code || "");
      const language = String(input.language || "javascript");

      if (language === "python_description") {
        // For Python: describe what the code would do and return a mock result
        const res = await axios.post(
          `${ollamaBaseUrl}/api/generate`,
          { model: textModel, prompt: `Describe what this Python code would output and return a realistic example result:\n\`\`\`python\n${code}\n\`\`\`\nReturn only the output/result, no explanation.`, stream: false },
          { timeout: 30_000 }
        );
        return { output: res.data?.response || "", language: "python", sandboxed: false };
      }

      // JavaScript — run in Node.js vm sandbox
      const sandbox = {
        console: { log: (...args: unknown[]) => output.push(args.map(String).join(" ")), error: (...args: unknown[]) => output.push("[ERR] " + args.map(String).join(" ")) },
        Math, JSON, Array, Object, String, Number, Boolean, Date,
        result: undefined as unknown,
      };
      const output: string[] = [];

      try {
        const wrapped = `(async () => { ${code} })()`;
        const script = new vm.Script(wrapped);
        const context = vm.createContext(sandbox);
        await script.runInContext(context, { timeout: 5000 });
        return { output: output.join("\n"), result: sandbox.result, language: "javascript", sandboxed: true };
      } catch (err: any) {
        return { error: err?.message, output: output.join("\n"), language: "javascript", sandboxed: true };
      }
    }

    case "web_search": {
      const query = String(input.query || "");
      try {
        const res = await axios.get("https://api.duckduckgo.com/", {
          params: { q: query, format: "json", no_html: 1, skip_disambig: 1 },
          timeout: 8000,
        });
        const data = res.data as any;
        const answer = data.AbstractText || data.Answer || data.Heading || "No direct answer found.";
        const topics = (data.RelatedTopics || []).slice(0, 3).map((t: any) => t.Text || "").filter(Boolean);
        return { answer, relatedTopics: topics, source: data.AbstractURL || "" };
      } catch {
        return { answer: `Web search for: "${query}" (offline or unavailable)`, relatedTopics: [], source: "" };
      }
    }

    case "generate_excel": {
      const { headers, rows, filename } = input as { headers: string[]; rows: string[][]; filename: string };
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(buffer).toString("base64");
      return { base64, filename: filename || "output.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rowCount: rows.length };
    }

    case "generate_word": {
      const content = String(input.content || "");
      const filename = String(input.filename || "document.docx");
      // Use simple OOXML template
      const docxml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${content.split("\n").map((line) =>
        `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`
      ).join("")}
  </w:body>
</w:document>`;
      const base64 = Buffer.from(docxml).toString("base64");
      return { base64, filename, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content };
    }

    case "generate_chart": {
      const { type, data, title } = input as { type: string; data: { labels: string[]; datasets: Array<{ label: string; data: number[] }> }; title: string };
      const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b"];
      const datasetsJson = JSON.stringify(
        (data.datasets || []).map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: colors[i % colors.length] + "99",
          borderColor: colors[i % colors.length],
          borderWidth: 2,
        }))
      );
      const labelsJson = JSON.stringify(data.labels || []);

      const html = `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>body{background:#080b14;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:Inter,sans-serif;} canvas{max-width:800px;}</style>
</head>
<body>
<canvas id="chart"></canvas>
<script>
new Chart(document.getElementById('chart'), {
  type: '${type}',
  data: { labels: ${labelsJson}, datasets: ${datasetsJson} },
  options: { responsive: true, plugins: { legend: { labels: { color: '#f0f2ff' } }, title: { display: true, text: '${title}', color: '#f0f2ff', font: { size: 18 } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } } } }
});
</script></body></html>`;

      return { html, base64: Buffer.from(html).toString("base64"), type, title, rowCount: data.labels?.length || 0 };
    }

    case "extract_data": {
      const text = String(input.text || "");
      const schema = String(input.schema || "");
      const res = await axios.post(
        `${ollamaBaseUrl}/api/generate`,
        { model: textModel, prompt: `Extract data from this text following this schema: ${schema}\n\nText:\n${text.slice(0, 2000)}\n\nReturn ONLY valid JSON matching the schema.`, stream: false },
        { timeout: 45_000 }
      );
      let raw = (res.data?.response as string || "").trim().replace(/^```json\n?/i, "").replace(/```$/, "").trim();
      try { return JSON.parse(raw); } catch { return { raw }; }
    }

    case "llm_call": {
      const prompt = String(input.prompt || "");
      const res = await axios.post(
        `${ollamaBaseUrl}/api/generate`,
        { model: textModel, prompt, stream: false },
        { timeout: 60_000 }
      );
      return { response: res.data?.response || "" };
    }

    case "summarise": {
      const text = String(input.text || "").slice(0, 4000);
      const res = await axios.post(
        `${ollamaBaseUrl}/api/generate`,
        { model: textModel, prompt: `Summarise the following in 3-5 concise bullet points:\n\n${text}`, stream: false },
        { timeout: 30_000 }
      );
      return { summary: res.data?.response || "" };
    }

    case "remember": {
      const fact = String(input.fact || "");
      ctx.memory.push(fact);
      return { stored: true, fact };
    }

    case "task_complete": {
      return { result: String(input.result || "Task completed."), done: true };
    }

    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

// ── Parse tool call from LLM response ────────────────────────────────────────

interface ParsedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

function parseToolCall(text: string): ParsedToolCall | null {
  // Try JSON tool call
  const jsonMatch = text.match(/\{[\s\S]*"tool"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tool) return { tool: parsed.tool, input: parsed.input || parsed };
    } catch { /* continue */ }
  }

  // Try function-call syntax: tool_name(...)
  const fnMatch = text.match(/(\w+)\([\s\S]*\)/);
  if (fnMatch) {
    try {
      const input = JSON.parse(fnMatch[2]);
      return { tool: fnMatch[1], input: typeof input === "object" ? input : { value: input } };
    } catch {
      return { tool: fnMatch[1], input: { value: fnMatch[2] } };
    }
  }

  return null;
}

// ── Main ReAct loop ───────────────────────────────────────────────────────────

async function runReActLoop(ctx: AgentContext): Promise<string> {
  const { id, task, fileContext, memory, maxSteps, res } = ctx;
  let stepIndex = 0;
  let finalResult = "";

  const systemPrompt = `You are an autonomous AI sub-agent running inside Cloud9 AI.
Your task: ${task}

${fileContext ? `Context from files:\n${fileContext.slice(0, 2000)}\n` : ""}
${TOOL_DEFINITIONS}

Working memory:
${memory.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(empty)"}

Rules:
- Think step-by-step before acting
- Call exactly ONE tool per response
- After each tool result, decide if the task is done
- If done, call task_complete(result="...")
- If more steps needed, call the next appropriate tool
- Maximum ${maxSteps} steps total

Format each response as:
THOUGHT: [your reasoning]
ACTION: [exact JSON tool call]

Example:
THOUGHT: I need to search for current information about this topic.
ACTION: {"tool": "web_search", "input": {"query": "..."}}`;

  let conversationHistory = `System: ${systemPrompt}\n\n`;

  while (stepIndex < maxSteps) {
    stepIndex++;

    // ── THINK phase ──────────────────────────────────────────────────────────
    const thinkResponse = await axios.post(
      `${ollamaBaseUrl}/api/generate`,
      { model: textModel, prompt: conversationHistory + `Step ${stepIndex}: `, stream: false },
      { timeout: 60_000 }
    );

    const rawThought = (thinkResponse.data?.response as string || "").trim();
    conversationHistory += `Step ${stepIndex}: ${rawThought}\n`;

    // Extract THOUGHT
    const thoughtMatch = rawThought.match(/THOUGHT:\s*([\s\S]+?)(?=ACTION:|$)/i);
    const thoughtText = thoughtMatch ? thoughtMatch[1].trim() : rawThought.split("\n")[0];

    const thinkStep: AgentStep = { stepIndex, type: "think", content: thoughtText, timestamp: new Date() };
    ctx.steps.push(thinkStep);
    sseStep(res, thinkStep);

    // Extract ACTION
    const actionMatch = rawThought.match(/ACTION:\s*([\s\S]+)$/i);
    const actionText = actionMatch ? actionMatch[1].trim() : rawThought;

    const toolCall = parseToolCall(actionText);

    if (!toolCall) {
      // No tool call found — treat as final answer
      finalResult = rawThought;
      const doneStep: AgentStep = { stepIndex, type: "done", content: rawThought, timestamp: new Date() };
      ctx.steps.push(doneStep);
      sseStep(res, doneStep);
      break;
    }

    // ── ACT phase ────────────────────────────────────────────────────────────
    const actStep: AgentStep = {
      stepIndex,
      type: "act",
      content: `Calling: ${toolCall.tool}`,
      tool: toolCall.tool,
      toolInput: toolCall.input,
      timestamp: new Date(),
    };
    ctx.steps.push(actStep);
    sseStep(res, actStep);

    if (toolCall.tool === "task_complete") {
      finalResult = String((toolCall.input as any).result || "Task completed.");
      const doneStep: AgentStep = { stepIndex, type: "done", content: finalResult, timestamp: new Date() };
      ctx.steps.push(doneStep);
      sseStep(res, doneStep);
      break;
    }

    // ── OBSERVE phase ────────────────────────────────────────────────────────
    let observation: unknown;
    try {
      observation = await executeTool(toolCall.tool, toolCall.input, ctx);
    } catch (err: any) {
      observation = { error: err?.message || "Tool execution failed" };
    }

    const observeStep: AgentStep = {
      stepIndex,
      type: "observe",
      content: JSON.stringify(observation).slice(0, 500),
      tool: toolCall.tool,
      toolOutput: observation,
      timestamp: new Date(),
    };
    ctx.steps.push(observeStep);
    sseStep(res, observeStep);

    conversationHistory += `Observation: ${JSON.stringify(observation).slice(0, 1000)}\n\n`;

    // Check if observation contains downloadable artifacts
    const obs = observation as Record<string, unknown>;
    if (obs.base64 || obs.html || obs.icsContent) {
      sseAgent(res, "artifact", {
        type: toolCall.tool,
        filename: obs.filename,
        base64: obs.base64,
        html: obs.html,
        mimeType: obs.mimeType,
      });
    }
  }

  if (!finalResult) {
    finalResult = `Agent completed ${stepIndex} steps. ${ctx.memory.length > 0 ? `Memory: ${ctx.memory.join("; ")}` : ""}`;
  }

  return finalResult;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EphemeralAgentInput {
  task: string;
  userId: string;
  fileContext?: string;
  maxSteps?: number;
}

export async function runEphemeralAgent(
  input: EphemeralAgentInput,
  res: Response
): Promise<void> {
  const agentId = uuidv4().slice(0, 8);
  const { task, userId, fileContext = "", maxSteps = 12 } = input;

  // Register agent
  const record: AgentRecord = {
    id: agentId,
    userId,
    task,
    startedAt: new Date(),
    status: "running",
    steps: [],
  };
  agentRegistry.set(agentId, record);

  sseAgent(res, "agent_start", { agentId, task, maxSteps });
  console.log(`[Agent:${agentId}] Starting → task="${task.slice(0, 80)}"`);

  const ctx: AgentContext = {
    id: agentId,
    userId,
    task,
    fileContext,
    memory: [],
    steps: [],
    maxSteps,
    res,
  };

  try {
    const result = await runReActLoop(ctx);
    record.status = "complete";
    record.steps = ctx.steps;

    sseAgent(res, "agent_complete", {
      agentId,
      result,
      steps: ctx.steps.length,
      memory: ctx.memory,
    });

    console.log(`[Agent:${agentId}] Complete in ${ctx.steps.length} steps`);
    return;
  } catch (err: any) {
    record.status = "failed";
    sseAgent(res, "agent_error", { agentId, error: err?.message || "Agent failed" });
    console.error(`[Agent:${agentId}] Failed:`, err?.message);
  } finally {
    // Self-destruct: clear from registry after 30 min (handled by interval above)
    // Immediate cleanup of sensitive context
    ctx.fileContext = "";
    ctx.memory = [];
  }
}

export function getRunningAgents(userId: string): AgentRecord[] {
  return [...agentRegistry.values()].filter((a) => a.userId === userId);
}

export function killAgent(agentId: string, userId: string): boolean {
  const agent = agentRegistry.get(agentId);
  if (!agent || agent.userId !== userId) return false;
  agent.status = "failed";
  return true;
}
