import { chatWithLocalModel, embedTextWithChain } from "./local-chain";

export type AiTaskType =
  | "chat"
  | "vision"
  | "audio"
  | "embedding"
  | "index"
  | "archive"
  | "agent";

export type AiJobPriority = "high" | "normal" | "low";

export interface AiJob<T = unknown> {
  id: string;
  type: AiTaskType;
  priority: AiJobPriority;
  tenantId?: string;
  payload: T;
  retries?: number;
}

interface QueuedJob<T = unknown> extends AiJob<T> {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface AiServiceOptions {
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  embeddingModel?: string;
  maxConcurrency?: number;
  retryCount?: number;
}

export class AiJobQueue {
  private readonly maxConcurrency: number;
  private readonly retryCount: number;
  private readonly queue: QueuedJob[] = [];
  private activeCount = 0;

  constructor(maxConcurrency = 2, retryCount = 1) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
    this.retryCount = Math.max(0, retryCount);
  }

  enqueue<T>(job: AiJob<T>, handler: (job: AiJob<T>) => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const queuedJob: QueuedJob<T> = {
        ...job,
        retries: job.retries ?? this.retryCount,
        resolve,
        reject,
      };

      this.queue.push(queuedJob);
      this.queue.sort((left, right) => this.priorityScore(left.priority) - this.priorityScore(right.priority));
      void this.drain(handler as (job: AiJob<unknown>) => Promise<unknown>);
    });
  }

  private priorityScore(priority: AiJobPriority) {
    if (priority === "high") return 0;
    if (priority === "normal") return 1;
    return 2;
  }

  private async drain(handler: (job: AiJob<unknown>) => Promise<unknown>) {
    if (this.activeCount >= this.maxConcurrency) return;

    const nextJob = this.queue.shift();
    if (!nextJob) return;

    this.activeCount += 1;

    try {
      const result = await handler(nextJob);
      nextJob.resolve(result);
    } catch (error) {
      if ((nextJob.retries || 0) > 0) {
        this.queue.unshift({
          ...nextJob,
          retries: (nextJob.retries || 0) - 1,
        });
      } else {
        nextJob.reject(error);
      }
    } finally {
      this.activeCount -= 1;
      void this.drain(handler);
    }
  }
}

export class LocalAiService {
  private readonly baseUrl: string;
  private readonly textModel: string;
  private readonly visionModel: string;
  private readonly embeddingModel: string;
  private readonly queue: AiJobQueue;

  constructor(options: AiServiceOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
    this.textModel = options.textModel || process.env.OLLAMA_TEXT_MODEL || "qwen2.5:7b-instruct";
    this.visionModel = options.visionModel || process.env.OLLAMA_VISION_MODEL || "llava:7b";
    this.embeddingModel = options.embeddingModel || process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
    this.queue = new AiJobQueue(options.maxConcurrency ?? 2, options.retryCount ?? 1);
  }

  async health() {
    return {
      ok: true,
      models: [this.textModel, this.visionModel, this.embeddingModel],
    };
  }

  async chat(prompt: string, options: { tenantId?: string; priority?: AiJobPriority } = {}) {
    return this.queue.enqueue(
      {
        id: `chat-${Date.now()}`,
        type: "chat",
        priority: options.priority || "normal",
        tenantId: options.tenantId,
        payload: { prompt },
      },
      async () => {
        return chatWithLocalModel(prompt);
      }
    );
  }

  async describeImage(imageBase64: string, prompt?: string) {
    return chatWithLocalModel(
      [
        "You are a vision assistant.",
        prompt || "Describe this image briefly and clearly.",
        `Image data (base64): ${imageBase64.slice(0, 1200)}`,
      ].join("\n")
    );
  }

  async embedText(text: string) {
    return embedTextWithChain(text);
  }

  async planTask(prompt: string, tenantId?: string) {
    return this.chat(
      [
        "You are a local file-assistant planner.",
        "Generate a concise JSON plan with steps, risks, and expected outputs.",
        `Tenant: ${tenantId || "shared"}`,
        "",
        prompt,
      ].join("\n"),
      { tenantId, priority: "high" }
    );
  }
}

export const localAiService = new LocalAiService();
