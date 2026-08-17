import { RedisCache } from "../services/cache/redis-cache";
import crypto from "crypto";

export class LlmCache {
  /**
   * Generates a deterministic hash for a given prompt and context combination.
   */
  private static generateKey(model: string, systemPrompt: string, userPrompt: string, context: string): string {
    const rawString = `${model}|${systemPrompt}|${userPrompt}|${context}`;
    const hash = crypto.createHash("sha256").update(rawString).digest("hex");
    return `ai:cache:${hash}`;
  }

  /**
   * Check if an exact response exists in cache for the given LLM parameters.
   */
  static async getCachedResponse(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    context: string = ""
  ): Promise<string | null> {
    const key = this.generateKey(model, systemPrompt, userPrompt, context);
    const cachedResponse = await RedisCache.get<string>(key);
    
    if (cachedResponse) {
      console.log(`[LlmCache] ⚡️ HIT for model=${model}`);
    } else {
      console.log(`[LlmCache] 🐌 MISS for model=${model}`);
    }
    
    return cachedResponse;
  }

  /**
   * Save an LLM response to Redis. 
   * Default TTL is 24 hours (86400 seconds) to balance storage costs and compute savings.
   */
  static async setCachedResponse(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    context: string,
    response: string,
    ttlSeconds: number = 86400
  ): Promise<void> {
    const key = this.generateKey(model, systemPrompt, userPrompt, context);
    await RedisCache.set(key, response, ttlSeconds);
  }
}
