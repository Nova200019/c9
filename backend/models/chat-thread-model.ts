import mongoose, { Document, Schema } from "mongoose";

export interface ChatAttachment {
  fileId?: string;
  folderId?: string;
  filename: string;
  mimeType?: string;
  localPath?: string;
}

export interface ToolResult {
  toolName: string;
  status: "success" | "error" | "pending";
  data?: Record<string, any>;
  outputType?: "image" | "text" | "json" | "csv" | "plan" | "file" | "audio" | "video";
  downloadable?: boolean;
  label?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  toolResults?: ToolResult[];
  imageUrl?: string;
  createdAt: Date;
}

export interface ChatThreadInterface extends Document {
  tenantId: string;
  title: string;
  messages: ChatMessage[];
  modelName: string;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChatAttachmentSchema = new Schema<ChatAttachment>(
  {
    fileId: { type: String },
    folderId: { type: String },
    filename: { type: String, required: true },
    mimeType: { type: String },
    localPath: { type: String },
  },
  { _id: false }
);

const ToolResultSchema = new Schema<ToolResult>(
  {
    toolName: { type: String, required: true },
    status: { type: String, enum: ["success", "error"], default: "success" },
    data: { type: Schema.Types.Mixed, default: {} },
    outputType: { type: String, enum: ["csv", "json", "image", "text", "plan"] },
    downloadable: { type: Boolean, default: false },
    label: { type: String },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<ChatMessage>(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, default: "" },
    attachments: { type: [ChatAttachmentSchema], default: [] },
    toolResults: { type: [ToolResultSchema], default: [] },
    imageUrl: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ChatThreadSchema = new Schema<ChatThreadInterface>(
  {
    tenantId: { type: String, required: true, index: true },
    title: { type: String, default: "New Chat" },
    messages: { type: [ChatMessageSchema], default: [] },
    modelName: { type: String, default: "qwen2.5:14b-instruct" },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatThreadSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model<ChatThreadInterface>("ChatThread", ChatThreadSchema);
