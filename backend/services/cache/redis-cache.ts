import Redis from "ioredis";

// Use environment variables or fallback to standard local redis port
const redisUri = process.env.REDIS_URL || "redis://localhost:6379";

// Initialize the global Redis client
export const redisClient = new Redis(redisUri, {
  retryStrategy(times) {
    // Retry connection up to 10 times, max wait 2 seconds
    const delay = Math.min(times * 50, 2000);
    if (times > 10) {
      console.error("[RedisCache] Connection failed. Max retries reached.");
      return null;
    }
    return delay;
  },
  maxRetriesPerRequest: null,
});

redisClient.on("connect", () => console.log("[RedisCache] Connected to Redis."));
redisClient.on("error", (err) => console.error("[RedisCache] Redis Error:", err.message));

export class RedisCache {
  /**
   * Set a key in the cache with an optional time-to-live in seconds
   */
  static async set(key: string, value: any, ttlSeconds: number = 86400): Promise<void> {
    try {
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      await redisClient.set(key, stringValue, "EX", ttlSeconds);
    } catch (error) {
      console.error(`[RedisCache] Failed to set key ${key}:`, error);
    }
  }

  /**
   * Get a key from the cache, automatically parsing JSON if necessary
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redisClient.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as unknown as T; // Return raw string if JSON parsing fails
      }
    } catch (error) {
      console.error(`[RedisCache] Failed to get key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a specific key
   */
  static async del(key: string): Promise<void> {
    try {
      await redisClient.del(key);
    } catch (error) {
      console.error(`[RedisCache] Failed to delete key ${key}:`, error);
    }
  }

  /**
   * Increment a numerical key
   */
  static async incrby(key: string, increment: number): Promise<number | null> {
    try {
      return await redisClient.incrby(key, increment);
    } catch (error) {
      console.error(`[RedisCache] Failed to incrby key ${key}:`, error);
      return null;
    }
  }
}
