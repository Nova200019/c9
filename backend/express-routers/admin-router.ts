import express from "express";
import UserDB from "../db/mongoDB/userDB";
import UserProfile from "../models/user-profile-model";
import { ConfigManager } from "../serverUtils/config-manager";
import { TelemetryService } from "../services/telemetry/telemetry-service";
import auth from "../middleware/auth";
import ForbiddenError from "../utils/ForbiddenError";

const router = express.Router();
const userDB = new UserDB();

/**
 * Middleware to enforce Admin access
 */
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || !req.user.admin) {
    return next(new ForbiddenError("Admin access required"));
  }
  next();
};

router.use(auth);
router.use(requireAdmin);

// ── User Management ──────────────────────────────────────────────────────────

router.get("/users", async (req, res, next) => {
  try {
    const users = await (userDB as any).collection.find({}, { projection: { password: 0, tokens: 0, tempTokens: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/plan", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tier } = req.body; // "free", "pro", "enterprise"
    
    // In user-intelligence we mapped tiers. For now, update directly
    await UserProfile.findOneAndUpdate(
      { userId: id },
      { $set: { "rateLimit.tier": tier } }
    );
    
    res.json({ success: true, message: `Updated user ${id} to ${tier} plan` });
  } catch (err) {
    next(err);
  }
});

// ── System Configuration (Dynamic Env) ───────────────────────────────────────

router.get("/config", (req, res) => {
  const config = ConfigManager.readConfig();
  res.json(config);
});

router.post("/config", (req, res, next) => {
  try {
    const { updates } = req.body;
    if (!updates || typeof updates !== "object") {
      throw new Error("Invalid configuration updates");
    }

    ConfigManager.updateConfig(updates);
    
    res.json({ success: true, message: "Configuration updated. Server will restart in 1 second." });
    
    ConfigManager.restartServer();
  } catch (err) {
    next(err);
  }
});

// ── Telemetry Export ─────────────────────────────────────────────────────────

router.get("/metrics", async (req, res, next) => {
  try {
    const metrics = await TelemetryService.getOverviewMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

router.get("/export/:userId", async (req, res, next) => {
  try {
    const profile = await UserProfile.findOne({ userId: req.params.userId }).lean();
    if (!profile) throw new Error("User profile not found");
    
    res.setHeader("Content-disposition", `attachment; filename=user_telemetry_${req.params.userId}.json`);
    res.setHeader("Content-type", "application/json");
    res.send(JSON.stringify(profile, null, 2));
  } catch (err) {
    next(err);
  }
});

export default router;
