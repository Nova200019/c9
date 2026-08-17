/**
 * planner.ts
 * Task & project planning tool.
 * Produces structured plans with steps, timelines, priorities, and risks.
 */

import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export interface PlanStep {
  step: number;
  title: string;
  description: string;
  duration?: string;
  priority: "high" | "medium" | "low";
  dependencies?: string[];
  tags?: string[];
}

export interface PlanResult {
  title: string;
  objective: string;
  steps: PlanStep[];
  risks: string[];
  timeline?: string;
  rawMarkdown: string;
}

const PLANNER_SYSTEM = `You are an expert project manager and productivity coach.
Given a task, goal, or request, you create a detailed, actionable, and realistic plan.
Structure your output as valid JSON matching this exact shape:
{
  "title": "Plan title",
  "objective": "What we're trying to achieve",
  "timeline": "Estimated total time",
  "steps": [
    {
      "step": 1,
      "title": "Step title",
      "description": "What to do in detail",
      "duration": "e.g. 30 min, 2 hours, 1 day",
      "priority": "high|medium|low",
      "dependencies": ["step title if any"],
      "tags": ["category tags"]
    }
  ],
  "risks": ["potential risk 1", "potential risk 2"]
}
Return ONLY valid JSON. No markdown fences. No explanatory text before or after.`;

export async function runPlannerTool(
  request: string,
  fileContext: string
): Promise<PlanResult> {
  const contextSection = fileContext
    ? `\n\nContext from attached files/documents:\n${fileContext}`
    : "";

  const prompt = `${PLANNER_SYSTEM}${contextSection}

Planning request: ${request}

Return the JSON plan:`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 120_000 }
  );

  let raw = (response.data?.response as string || "").trim();
  raw = raw.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "Plan",
      objective: parsed.objective || request,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      timeline: parsed.timeline,
      rawMarkdown: raw,
    };
  } catch {
    // Fall back to markdown if JSON parse fails
    return {
      title: "Task Plan",
      objective: request,
      steps: [],
      risks: [],
      rawMarkdown: raw,
    };
  }
}
