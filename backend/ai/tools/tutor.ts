/**
 * tutor.ts
 * Exam coaching / tutoring tool.
 * Reads study materials from attached files and acts as a personal tutor —
 * explaining concepts, generating practice questions, giving feedback on answers.
 */

import axios from "axios";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export interface TutorResult {
  mode: "explain" | "quiz" | "feedback" | "summary" | "general";
  content: string;
  questions?: QuizQuestion[];
  topic?: string;
}

export interface QuizQuestion {
  question: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}

const TUTOR_SYSTEM = `You are an expert tutor, teacher, and academic coach with deep knowledge across all subjects.
You have access to the student's study materials via the attached file context.
Your teaching style is:
- Clear and patient — you explain complex concepts simply
- Engaging — you use examples, analogies, and real-world connections
- Rigorous — you test understanding with targeted questions
- Encouraging — you motivate and build confidence
- Adaptive — you tailor depth to what the student seems to need

When generating quiz questions, return them in this JSON structure within your response:
QUIZ_JSON: [{"question":"...","options":["A...","B...","C...","D..."],"answer":"A","explanation":"..."}]`;

type TutorMode = "explain" | "quiz" | "feedback" | "summary" | "general";

function detectMode(message: string): TutorMode {
  const lower = message.toLowerCase();
  if (lower.includes("quiz") || lower.includes("test me") || lower.includes("practice question") || lower.includes("flashcard")) return "quiz";
  if (lower.includes("explain") || lower.includes("what is") || lower.includes("how does") || lower.includes("why")) return "explain";
  if (lower.includes("feedback") || lower.includes("my answer") || lower.includes("did i get") || lower.includes("check my")) return "feedback";
  if (lower.includes("summary") || lower.includes("summarize") || lower.includes("overview") || lower.includes("key points")) return "summary";
  return "general";
}

export async function runTutorTool(
  request: string,
  fileContext: string,
  conversationHistory: string
): Promise<TutorResult> {
  const mode = detectMode(request);

  const contextSection = fileContext
    ? `\n\nStudy Material (from attached files):\n${fileContext}`
    : "\n\n[No study materials attached — working from general knowledge]";

  const historySection = conversationHistory
    ? `\n\nConversation so far:\n${conversationHistory}`
    : "";

  const modeInstructions: Record<TutorMode, string> = {
    explain: "The student wants an explanation. Break it down clearly with examples.",
    quiz: "Generate 5 practice questions based on the material. Include options (multiple choice), correct answers, and brief explanations. Use the QUIZ_JSON format.",
    feedback: "The student is sharing an answer or work. Give thorough, constructive feedback.",
    summary: "Create a comprehensive but concise summary of the key topics and concepts in the material.",
    general: "Help the student with their request. Be thorough and educational.",
  };

  const prompt = `${TUTOR_SYSTEM}${contextSection}${historySection}

Student's request: ${request}

Instruction for this response: ${modeInstructions[mode]}

Your response:`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 120_000 }
  );

  const content = (response.data?.response as string || "").trim();

  // Extract quiz questions if present
  let questions: QuizQuestion[] | undefined;
  const quizMatch = content.match(/QUIZ_JSON:\s*(\[[\s\S]*?\])/);
  if (quizMatch) {
    try {
      questions = JSON.parse(quizMatch[1]);
    } catch { /* ignore parse errors */ }
  }

  return {
    mode,
    content: content.replace(/QUIZ_JSON:\s*\[[\s\S]*?\]/, "").trim(),
    questions,
    topic: request.slice(0, 80),
  };
}
