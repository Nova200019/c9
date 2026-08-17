import cron from "node-cron";
import FileDB from "../../db/mongoDB/fileDB";
import { FileInterface } from "../../models/file-model";
import { RedisCache } from "../../services/cache/redis-cache";

const fileDB = new FileDB();

/**
 * Storage Tier Agent
 * 
 * Background agent that runs every night at 2:00 AM.
 * Scans all files and intelligently tiers them:
 * - High score (RAM/CDN)
 * - Medium score (SSD)
 * - Low score (Cold Storage / Compressed)
 */
export class StorageTierAgent {
  static init() {
    // Run every day at 2:00 AM
    cron.schedule("0 2 * * *", async () => {
      console.log("[StorageTierAgent] Starting nightly semantic tiering scan...");
      await this.runScan();
    });
  }

  static async runScan() {
    // In a real production environment, this would use a cursor
    // For now, we'll fetch a batch of files to process
    try {
      const files: FileInterface[] = await (fileDB as any).collection.find({
        "metadata.aiScore": { $exists: true }
      }).limit(100).toArray();

      for (const file of files) {
        await this.processFile(file);
      }
      
      console.log(`[StorageTierAgent] Nightly scan completed. Processed ${files.length} files.`);
    } catch (e) {
      console.error("[StorageTierAgent] Error during scan:", e);
    }
  }

  private static async processFile(file: FileInterface) {
    const score = file.metadata.aiScore || 50;

    if (score >= 90 && file.metadata.storageTier !== "RAM") {
      console.log(`[StorageTierAgent] Upgrading file ${file._id} to RAM tier (Score: ${score})`);
      // Here we would load the file to Redis (or keep it locally cached heavily)
      await (fileDB as any).collection.updateOne(
        { _id: file._id },
        { $set: { "metadata.storageTier": "RAM" } }
      );
    } else if (score < 20 && file.metadata.storageTier !== "COLD") {
      console.log(`[StorageTierAgent] Downgrading file ${file._id} to COLD tier (Score: ${score})`);
      // Here we would trigger the `archiver` or `zlib` brotli compression to compress the S3 blob
      await (fileDB as any).collection.updateOne(
        { _id: file._id },
        { $set: { "metadata.storageTier": "COLD" } }
      );
    }
  }
}
