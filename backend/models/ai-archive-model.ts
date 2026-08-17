import mongoose, { Document } from "mongoose";

const aiArchiveSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ["history", "files", "combined"],
      index: true,
    },
    itemCount: {
      type: Number,
      required: true,
      default: 0,
    },
    archivePath: {
      type: String,
      required: true,
    },
    checksum: {
      type: String,
      default: "",
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

aiArchiveSchema.index({ tenantId: 1, createdAt: -1 });

export interface AiArchiveInterface extends Document {
  tenantId: string;
  kind: string;
  itemCount: number;
  archivePath: string;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

const AiArchive = mongoose.model<AiArchiveInterface>("ai_archive", aiArchiveSchema);

export default AiArchive;
module.exports = AiArchive;
