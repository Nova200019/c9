/**
 * job-coach.ts
 * Career coaching tool — CV analysis, job search guidance, interview prep,
 * salary negotiation, LinkedIn profile advice, skill gap analysis.
 */

import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export type JobCoachMode =
  | "cv_review"
  | "cover_letter"
  | "interview_prep"
  | "salary_negotiation"
  | "skill_gap"
  | "linkedin_profile"
  | "job_search"
  | "career_advice";

export interface JobCoachResult {
  mode: JobCoachMode;
  content: string;
  actionItems?: string[];
  score?: number;
  scoreLabel?: string;
}

const JOB_COACH_SYSTEM = `You are an elite career coach, executive recruiter, and HR expert with 20+ years of experience.
You help people land their dream jobs through:
- Brutally honest CV/resume feedback that gets results
- Tailored cover letters that stand out
- Interview preparation with real tough questions and model answers
- Salary negotiation tactics
- LinkedIn profile optimization
- Skill gap analysis with a concrete learning roadmap
- Job market insights and search strategy

You are direct, practical, and genuinely invested in the person's career success.
You use specific examples, not vague advice. You treat the person like a friend who happens to be a career expert.`;

function detectMode(message: string): JobCoachMode {
  const lower = message.toLowerCase();
  if (lower.includes("cv") || lower.includes("resume") || lower.includes("résumé")) return "cv_review";
  if (lower.includes("cover letter")) return "cover_letter";
  if (lower.includes("interview")) return "interview_prep";
  if (lower.includes("salary") || lower.includes("negotiate") || lower.includes("pay")) return "salary_negotiation";
  if (lower.includes("skill") || lower.includes("gap") || lower.includes("learn")) return "skill_gap";
  if (lower.includes("linkedin") || lower.includes("profile")) return "linkedin_profile";
  if (lower.includes("find job") || lower.includes("job search") || lower.includes("apply")) return "job_search";
  return "career_advice";
}

const modePrompts: Record<JobCoachMode, string> = {
  cv_review: `Review the CV/resume in the attached files thoroughly. Provide:
1. An overall score out of 10 with rationale
2. What's working well (be specific)
3. Critical issues to fix (be direct and specific)
4. Exact rewrite suggestions for weak sections
5. ATS optimization tips
6. 5 most important action items

Format as ACTION_ITEMS_JSON: ["item1","item2",...] at the end.`,

  cover_letter: `Write a compelling, tailored cover letter based on the job description or context provided.
The letter should be specific, show genuine enthusiasm, and highlight the most relevant experience.
Avoid clichés. Make it feel human and memorable.`,

  interview_prep: `Generate comprehensive interview preparation material including:
1. 10 likely interview questions (mix of behavioral, technical, situational)
2. Model answers using STAR method where appropriate
3. Questions the candidate should ask the interviewer
4. Common mistakes to avoid
5. How to research and prepare`,

  salary_negotiation: `Provide specific, tactical salary negotiation advice:
1. How to research market rates
2. Exact scripts for the negotiation conversation
3. How to handle common pushback
4. What non-salary benefits to negotiate
5. Red lines — when to walk away`,

  skill_gap: `Analyze the person's background and target role, then provide:
1. The key skills they're missing
2. A prioritized learning roadmap (90-day and 6-month)
3. Specific resources (courses, books, projects)
4. How to demonstrate new skills on a CV`,

  linkedin_profile: `Optimize the LinkedIn profile for maximum visibility and impact:
1. Headline that attracts recruiters
2. About section rewrite
3. Experience section improvements
4. Skills to add for SEO
5. Content strategy for building authority`,

  job_search: `Create a comprehensive job search strategy:
1. Best job boards for this field
2. Company targeting approach
3. Networking tactics (cold outreach scripts included)
4. Timeline and daily action plan
5. How to track applications and follow up`,

  career_advice: `Give comprehensive, honest career advice based on the situation. Be specific and actionable.`,
};

export async function runJobCoachTool(
  request: string,
  fileContext: string,
  conversationHistory: string
): Promise<JobCoachResult> {
  const mode = detectMode(request);

  const contextSection = fileContext
    ? `\n\nAttached documents (CV, job description, etc.):\n${fileContext}`
    : "";

  const historySection = conversationHistory
    ? `\n\nPrevious conversation:\n${conversationHistory}`
    : "";

  const prompt = `${JOB_COACH_SYSTEM}${contextSection}${historySection}

User: ${request}

Task: ${modePrompts[mode]}

Your response:`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 120_000 }
  );

  const content = (response.data?.response as string || "").trim();

  // Extract action items if present
  let actionItems: string[] | undefined;
  const actionMatch = content.match(/ACTION_ITEMS_JSON:\s*(\[[\s\S]*?\])/);
  if (actionMatch) {
    try {
      actionItems = JSON.parse(actionMatch[1]);
    } catch { /* ignore */ }
  }

  // Extract score if CV review
  let score: number | undefined;
  let scoreLabel: string | undefined;
  if (mode === "cv_review") {
    const scoreMatch = content.match(/(\d+)\s*(?:\/\s*10|out of 10)/i);
    if (scoreMatch) {
      score = parseInt(scoreMatch[1], 10);
      scoreLabel = score >= 8 ? "Strong" : score >= 6 ? "Good" : score >= 4 ? "Needs Work" : "Major Revision Needed";
    }
  }

  return {
    mode,
    content: content.replace(/ACTION_ITEMS_JSON:\s*\[[\s\S]*?\]/, "").trim(),
    actionItems,
    score,
    scoreLabel,
  };
}
