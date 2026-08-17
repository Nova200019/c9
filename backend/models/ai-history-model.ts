import mongoose, { Document } from "mongoose";

const aiHistorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ["chat", "vision", "audio", "embedding", "index", "archive", "agent", "plan", "search"],
      index: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    response: {
      type: String,
      default: "",
    },
    modelName: {
      type: String,
      default: "",
    },
    summary: {
      type: String,
      default: "",
    },
    keywords: {
      type: [String],
      default: [],
    },
    categories: {
      type: [String],
      default: [],
    },
    relatedFileIds: {
      type: [String],
      default: [],
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
    },
    archiveId: {
      type: String,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

aiHistorySchema.index({ tenantId: 1, createdAt: -1 });
aiHistorySchema.index({ archived: 1, createdAt: 1 });

export interface AiHistoryInterface extends Document {
  tenantId: string;
  userId: string;
  kind: string;
  prompt: string;
  response: string;
  modelName: string;
  summary?: string;
  keywords: string[];
  categories: string[];
  relatedFileIds: string[];
  archived?: boolean;
  archivedAt?: Date;
  archiveId?: string;
  metadata?: Record<string, unknown>;
}

const AiHistory = mongoose.model<AiHistoryInterface>("ai_history", aiHistorySchema);

export default AiHistory;
module.exports = AiHistory;
