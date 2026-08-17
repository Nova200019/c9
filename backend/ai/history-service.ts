import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import AiHistory from "../models/ai-history-model";
import AiArchive from "../models/ai-archive-model";
import File from "../models/file-model";

const gzip = promisify(zlib.gzip);
const writeFile = fs.promises.writeFile;
const mkdir = fs.promises.mkdir;

const archiveRoot = path.join(os.tmpdir(), "mydrive-ai-archives");
const maintenanceIntervalMs = Number(process.env.AI_MAINTENANCE_INTERVAL_MS || 1000 * 60 * 30);
const historyRetentionDays = Number(process.env.AI_HISTORY_RETENTION_DAYS || 30);
const fileColdDays = Number(process.env.AI_FILE_COLD_DAYS || 45);
let maintenanceStarted = false;

const ensureArchiveRoot = async () => {
  await mkdir(archiveRoot, { recursive: true });
};

const nowIso = () => new Date().toISOString();

export async function recordAiHistory(entry: {
  tenantId: string;
  userId: string;
  kind: string;
  prompt: string;
  response: string;
  model: string;
  summary?: string;
  keywords?: string[];
  categories?: string[];
  relatedFileIds?: string[];
  metadata?: Record<string, unknown>;
}) {
  return AiHistory.create({
    tenantId: entry.tenantId,
    userId: entry.userId,
    kind: entry.kind,
    prompt: entry.prompt,
    response: entry.response,
    modelName: entry.model,
    summary: entry.summary || "",
    keywords: entry.keywords || [],
    categories: entry.categories || [],
    relatedFileIds: entry.relatedFileIds || [],
    metadata: entry.metadata || {},
  });
}

export async function getAiHistoryForTenant(tenantId: string, limit = 50) {
  return AiHistory.find({ tenantId, archived: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, limit));
}

export async function getAiHistoryForAdmin(limit = 100) {
  return AiHistory.find({})
    .sort({ createdAt: -1 })
    .limit(Math.max(1, limit));
}

export async function getAiAdminStatus() {
  const [historyCount, archivedCount, fileCount, coldFileCount, archiveCount] = await Promise.all([
    AiHistory.countDocuments({ archived: { $ne: true } }),
    AiHistory.countDocuments({ archived: true }),
    File.countDocuments({}),
    File.countDocuments({ "metadata.storageTier": "cold" }),
    AiArchive.countDocuments({}),
  ]);

  return {
    historyCount,
    archivedCount,
    fileCount,
    coldFileCount,
    archiveCount,
    retentionDays: historyRetentionDays,
    coldFileDays: fileColdDays,
    maintenanceIntervalMs,
    timestamp: nowIso(),
  };
}

async function archiveHistoryBatch() {
  const cutoff = new Date(Date.now() - historyRetentionDays * 24 * 60 * 60 * 1000);
  const tenants = await AiHistory.distinct("tenantId", {
    archived: { $ne: true },
    createdAt: { $lt: cutoff },
  });

  for (const tenantId of tenants) {
    const items = await AiHistory.find({
      tenantId,
      archived: { $ne: true },
      createdAt: { $lt: cutoff },
    }).lean();

    if (!items.length) continue;

    await ensureArchiveRoot();
    const archivePath = path.join(archiveRoot, `history-${tenantId}-${Date.now()}.json.gz`);
    const payload = Buffer.from(JSON.stringify({ tenantId, kind: "history", items }, null, 2), "utf8");
    const compressed = await gzip(payload);
    await writeFile(archivePath, compressed);

    const archive = await AiArchive.create({
      tenantId,
      kind: "history",
      itemCount: items.length,
      archivePath,
      metadata: { createdAt: nowIso(), cutoff: cutoff.toISOString() },
    });

    const archiveId = (archive._id as any).toString();

    await AiHistory.updateMany(
      { tenantId, archived: { $ne: true }, createdAt: { $lt: cutoff } },
      { $set: { archived: true, archivedAt: new Date(), archiveId } }
    );
  }
}

async function archiveColdFilesBatch() {
  const cutoff = new Date(Date.now() - fileColdDays * 24 * 60 * 60 * 1000);
  const coldCandidates = await File.find({
    $or: [
      { "metadata.lastAccessedAt": { $exists: true, $lt: cutoff } },
      { uploadDate: { $lt: cutoff } },
    ],
    "metadata.storageTier": { $ne: "cold" },
    "metadata.trashed": { $ne: true },
  }).lean();

  if (!coldCandidates.length) return;

  await ensureArchiveRoot();
  const tenantGroups = new Map<string, typeof coldCandidates>();

  for (const file of coldCandidates) {
    const tenantId = String(file.metadata?.owner || "unknown");
    const group = tenantGroups.get(tenantId) || [];
    group.push(file);
    tenantGroups.set(tenantId, group);
  }

  for (const [tenantId, files] of tenantGroups.entries()) {
    const archivePath = path.join(archiveRoot, `files-${tenantId}-${Date.now()}.json.gz`);
    const payload = Buffer.from(JSON.stringify({ tenantId, kind: "files", files }, null, 2), "utf8");
    const compressed = await gzip(payload);
    await writeFile(archivePath, compressed);

    const archive = await AiArchive.create({
      tenantId,
      kind: "files",
      itemCount: files.length,
      archivePath,
      metadata: { createdAt: nowIso(), cutoff: cutoff.toISOString() },
    });
    const archiveId = String((archive as { _id: { toString(): string } })._id);

    for (const file of files) {
      await File.updateOne(
        { _id: file._id },
        {
          $set: {
            "metadata.storageTier": "cold",
            "metadata.archivedAt": new Date(),
            "metadata.archiveId": archiveId,
          },
        }
      );
    }
  }
}

export async function runAiMaintenanceCycle() {
  await archiveHistoryBatch();
  await archiveColdFilesBatch();
}

export function startAiMaintenanceLoop() {
  if (maintenanceStarted) return;
  maintenanceStarted = true;

  void runAiMaintenanceCycle();
  setInterval(() => {
    void runAiMaintenanceCycle();
  }, maintenanceIntervalMs).unref();
}
