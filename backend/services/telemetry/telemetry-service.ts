import UserProfile from "../../models/user-profile-model";
import { RedisCache } from "../cache/redis-cache";

/**
 * Telemetry Service
 * Aggregates daily metrics for the Admin Overview Dashboard.
 */
export class TelemetryService {
  /**
   * Get total system metrics
   */
  static async getOverviewMetrics() {
    try {
      const totalUsers = await UserProfile.countDocuments();
      
      const today = new Date().toISOString().split("T")[0];
      
      // We would normally aggregate all users' tokens from Redis, 
      // but for simplicity in a dashboard, we'll estimate or pull from global keys if we had them.
      // We can also just aggregate totalMessages from MongoDB.
      
      const aggregation = await UserProfile.aggregate([
        {
          $group: {
            _id: null,
            totalMessagesAllTime: { $sum: "$totalMessages" },
          }
        }
      ]);
      
      const totalMessagesAllTime = aggregation[0]?.totalMessagesAllTime || 0;

      return {
        totalUsers,
        totalMessagesAllTime,
        activeToday: 0, // Placeholder
        bandwidthUsed: "0 GB", // Placeholder
      };
    } catch (e) {
      console.error("[TelemetryService] Error getting overview metrics", e);
      return { totalUsers: 0, totalMessagesAllTime: 0 };
    }
  }
}
