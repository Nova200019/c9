import { Request, Response, NextFunction } from "express";
import { localAiService } from "../ai";
import { analyzeText, splitDocumentIntoChunks } from "../ai/local-chain";
import { recordAiHistory, getAiHistoryForTenant, getAiHistoryForAdmin, getAiAdminStatus, runAiMaintenanceCycle } from "../ai/history-service";
import { searchFiles } from "../utils/semanticSearch";
import { runAgent } from "../ai/agent-orchestrator";
import ChatThread from "../models/chat-thread-model";

interface RequestWithUser extends Request {
  user?: {
    _id: string;
    email: string;
    admin?: boolean;
  };
}

class AiController {
  // ── Legacy chat (kept for backwards compat) ────────────────────────────────
  chat = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).send("Error Authenticating");

      const prompt = String(req.body.prompt || "").trim();
      if (!prompt) return res.status(400).json({ error: "Missing prompt" });

      const startTime = Date.now();
      console.log(`[AI-API] POST /ai-service/chat -> user=${user._id}, promptLen=${prompt.length}`);

      const response = String(await localAiService.chat(prompt, { tenantId: user._id.toString() }));
      const insights = await analyzeText(prompt);
      const chunks = await splitDocumentIntoChunks(prompt);

      const record = await recordAiHistory({
        tenantId: user._id.toString(),
        userId: user._id.toString(),
        kind: "chat",
        prompt,
        response,
        model: process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct",
        summary: insights.summary,
        keywords: insights.keywords,
        categories: insights.categories,
        metadata: { chunkCount: chunks.length },
      });

      console.log(`[AI-API] POST /ai-service/chat <- OK in ${Date.now() - startTime}ms, historyId=${record._id}`);
      res.json({ response, historyId: record._id, insights });
    } catch (error) {
      console.error(`[AI-API] POST /ai-service/chat <- ERROR:`, error);
      next(error as any);
    }
  };

  // ── Universal streaming agent (v2) ─────────────────────────────────────────
  chatV2 = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const message = String(req.body.message || req.body.prompt || "").trim();
      if (!message) return res.status(400).json({ error: "Missing message" });

      const threadId = req.body.threadId as string | undefined;
      const fileIds: string[] = Array.isArray(req.body.fileIds) ? req.body.fileIds : [];
      const folderIds: string[] = Array.isArray(req.body.folderIds) ? req.body.folderIds : [];
      const sendEmailFlag = req.body.sendEmail === true;
      const outputFormat = req.body.outputFormat === "json" ? "json" : "csv";

      console.log(`[AI-API] POST /ai-service/chat-v2 -> user=${user._id}, files=${fileIds.length}, folders=${folderIds.length}, thread=${threadId || "new"}`);

      await runAgent(
        {
          message,
          threadId,
          fileIds,
          folderIds,
          userId: user._id.toString(),
          sendEmail: sendEmailFlag,
          outputFormat,
        },
        res
      );
    } catch (error) {
      console.error(`[AI-API] POST /ai-service/chat-v2 <- ERROR:`, error);
      if (!res.headersSent) next(error as any);
    }
  };

  // ── Thread management ──────────────────────────────────────────────────────
  listThreads = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(Number(req.query.limit || 50), 100);
      const threads = await ChatThread.find(
        { tenantId: user._id.toString(), archived: { $ne: true } },
        { messages: 0 } // exclude messages for list view
      )
        .sort({ updatedAt: -1 })
        .limit(limit);

      res.json({ threads });
    } catch (error) {
      next(error as any);
    }
  };

  getThread = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const thread = await ChatThread.findOne({
        _id: req.params.id,
        tenantId: user._id.toString(),
      });

      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json({ thread });
    } catch (error) {
      next(error as any);
    }
  };

  createThread = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const thread = await ChatThread.create({
        tenantId: user._id.toString(),
        title: String(req.body.title || "New Chat"),
        messages: [],
        model: process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct",
      });

      res.json({ thread });
    } catch (error) {
      next(error as any);
    }
  };

  deleteThread = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      await ChatThread.deleteOne({ _id: req.params.id, tenantId: user._id.toString() });
      res.json({ ok: true });
    } catch (error) {
      next(error as any);
    }
  };

  renameThread = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const title = String(req.body.title || "").trim();
      if (!title) return res.status(400).json({ error: "Missing title" });

      const thread = await ChatThread.findOneAndUpdate(
        { _id: req.params.id, tenantId: user._id.toString() },
        { $set: { title } },
        { new: true, projection: { messages: 0 } }
      );
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json({ thread });
    } catch (error) {
      next(error as any);
    }
  };

  // ── Download tool output (CSV, ICS, etc.) ─────────────────────────────────
  downloadToolOutput = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const { threadId, messageIndex, toolIndex } = req.params;

      const thread = await ChatThread.findOne({ _id: threadId, tenantId: user._id.toString() });
      if (!thread) return res.status(404).json({ error: "Thread not found" });

      const msgIdx = parseInt(messageIndex, 10);
      const toolIdx = parseInt(toolIndex, 10);
      const message = thread.messages[msgIdx];
      const toolResult = message?.toolResults?.[toolIdx];

      if (!toolResult) return res.status(404).json({ error: "Tool result not found" });

      const data = toolResult.data as Record<string, any>;

      if (toolResult.toolName === "extract_structured" || toolResult.outputType === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${data.filename || "extracted.csv"}"`);
        return res.send(data.data || "");
      }

      if (toolResult.toolName === "calendar" || data.icsContent) {
        res.setHeader("Content-Type", "text/calendar");
        res.setHeader("Content-Disposition", `attachment; filename="${data.filename || "events.ics"}"`);
        return res.send(data.icsContent || "");
      }

      if (toolResult.toolName === "image_gen" && data.imageBase64) {
        const buf = Buffer.from(data.imageBase64, "base64");
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Disposition", `attachment; filename="generated_image.png"`);
        return res.send(buf);
      }

      res.json(data);
    } catch (error) {
      next(error as any);
    }
  };

  // ── Legacy endpoints ───────────────────────────────────────────────────────
  plan = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).send("Error Authenticating");

      const prompt = String(req.body.prompt || req.body.query || "").trim();
      if (!prompt) return res.status(400).json({ error: "Missing prompt" });

      const startTime = Date.now();
      const relatedFiles = await searchFiles(prompt, 8);
      const response = String(await localAiService.planTask(prompt, user._id.toString()));
      const insights = await analyzeText(prompt);

      const record = await recordAiHistory({
        tenantId: user._id.toString(),
        userId: user._id.toString(),
        kind: "plan",
        prompt,
        response,
        model: process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct",
        summary: insights.summary,
        keywords: insights.keywords,
        categories: insights.categories,
        relatedFileIds: [...(relatedFiles.files || []).map((file: any) => String(file._id))],
        metadata: { relatedFileCount: (relatedFiles.files || []).length },
      });

      console.log(`[AI-API] POST /ai-service/plan <- OK in ${Date.now() - startTime}ms`);
      res.json({ response, historyId: record._id, relatedFiles });
    } catch (error) {
      next(error as any);
    }
  };

  search = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).send("Error Authenticating");

      const query = String(req.body.query || "").trim();
      if (!query) return res.status(400).json({ error: "Missing query" });

      const results = await searchFiles(query, 10);
      await recordAiHistory({
        tenantId: user._id.toString(),
        userId: user._id.toString(),
        kind: "search",
        prompt: query,
        response: JSON.stringify({ fileCount: results.files.length, folderCount: results.folders.length }),
        model: process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
        keywords: (await analyzeText(query)).keywords,
        categories: ["search"],
        relatedFileIds: results.files.map((file: any) => String(file._id)),
      });

      res.json(results);
    } catch (error) {
      next(error as any);
    }
  };

  history = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).send("Error Authenticating");

      const limit = Number(req.query.limit || 50);
      const includeArchived = req.query.includeArchived === "true";
      const history = includeArchived
        ? await getAiHistoryForAdmin(limit)
        : await getAiHistoryForTenant(user._id.toString(), limit);

      res.json(history);
    } catch (error) {
      next(error as any);
    }
  };

  status = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const health = await localAiService.health();
      const status = await getAiAdminStatus();
      res.json({ ...health, ...status });
    } catch (error) {
      next(error as any);
    }
  };

  adminStatus = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const health = await localAiService.health();
      const status = await getAiAdminStatus();
      const history = await getAiHistoryForAdmin(25);
      res.json({ ...health, ...status, recentHistory: history });
    } catch (error) {
      next(error as any);
    }
  };

  archiveNow = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      await runAiMaintenanceCycle();
      res.json({ ok: true });
    } catch (error) {
      next(error as any);
    }
  };
}

export default AiController;
