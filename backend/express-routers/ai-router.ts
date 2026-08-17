import { Router } from "express";
import authFullUser from "../middleware/authFullUser";
import authAdmin from "../middleware/authAdmin";
import AiController from "../controllers/ai-controller";

const router = Router();
const ai = new AiController();

// ── Universal Agent (v2) ───────────────────────────────────────────────────
router.post("/ai-service/chat-v2", authFullUser, ai.chatV2);

// ── Thread management ──────────────────────────────────────────────────────
router.get("/ai-service/threads", authFullUser, ai.listThreads);
router.post("/ai-service/threads", authFullUser, ai.createThread);
router.get("/ai-service/threads/:id", authFullUser, ai.getThread);
router.patch("/ai-service/threads/:id", authFullUser, ai.renameThread);
router.delete("/ai-service/threads/:id", authFullUser, ai.deleteThread);

// ── Tool output download ────────────────────────────────────────────────────
router.get(
  "/ai-service/threads/:threadId/messages/:messageIndex/tools/:toolIndex/download",
  authFullUser,
  ai.downloadToolOutput
);

// ── Legacy endpoints (backwards compat) ───────────────────────────────────
router.get("/ai-service/status", authFullUser, ai.status);
router.get("/ai-service/history", authFullUser, ai.history);
router.post("/ai-service/chat", authFullUser, ai.chat);
router.post("/ai-service/plan", authFullUser, ai.plan);
router.post("/ai-service/search", authFullUser, ai.search);

// ── Admin ──────────────────────────────────────────────────────────────────
router.get("/ai-service/admin/status", authAdmin, ai.adminStatus);
router.post("/ai-service/admin/archive", authAdmin, ai.archiveNow);

export default router;
