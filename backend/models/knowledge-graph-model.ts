/**
 * knowledge-graph-model.ts
 *
 * A per-user knowledge graph stored in MongoDB.
 * Nodes are entities (people, concepts, files, topics, emotions, places, events).
 * Edges are directed relationships between nodes.
 *
 * The "super-graph" is the anonymised aggregate across all free-tier users,
 * enabling collective intelligence and recommendation.
 */

import mongoose, { Schema, Document } from "mongoose";

// ── Node Types ───────────────────────────────────────────────────────────────
export type NodeType =
  | "concept"        // abstract ideas, topics, skills
  | "person"         // contacts, colleagues, family, self
  | "file"           // documents, images, audio, video in Cloud9
  | "project"        // named projects or goals
  | "emotion"        // emotional state or trigger
  | "event"          // meetings, deadlines, milestones
  | "place"          // physical or virtual locations
  | "tool"           // software, services, AI tools used
  | "organisation"   // companies, teams, departments
  | "goal"           // explicit user goals
  | "fact";          // extracted factual data point

export type EdgeType =
  | "related_to"
  | "caused_by"
  | "leads_to"
  | "part_of"
  | "created"
  | "associated_with"
  | "contradicts"
  | "supports"
  | "depends_on"
  | "similar_to"
  | "triggers"
  | "belongs_to"
  | "mentioned_with";

// ── Graph Node ────────────────────────────────────────────────────────────────
export interface GraphNode {
  id: string;                    // UUID
  type: NodeType;
  label: string;                 // human-readable name
  description?: string;
  properties: Record<string, unknown>;
  embedding?: number[];          // semantic embedding for vector search
  importance: number;            // 0-1 how central this node is
  frequency: number;             // how often referenced
  sentiment: number;             // -1 to +1
  firstSeen: Date;
  lastSeen: Date;
  tags: string[];
}

// ── Graph Edge ────────────────────────────────────────────────────────────────
export interface GraphEdge {
  id: string;                    // UUID
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;                // 0-1 strength of relationship
  confidence: number;            // 0-1 how confident this edge is
  context: string;               // what triggered this relationship
  createdAt: Date;
  updatedAt: Date;
}

// ── Full Knowledge Graph Document ─────────────────────────────────────────────
export interface KnowledgeGraphInterface extends Document {
  userId: string;
  tenantId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: string;               // AI-generated summary of the graph
  dominantTopics: string[];
  knowledgeClusters: Array<{
    clusterId: string;
    label: string;
    nodeIds: string[];
    strength: number;
  }>;
  // Collective graph metadata
  anonymisedContribution: boolean;
  contributionHash: string;      // anonymised hash for de-duplication
  lastGraphUpdate: Date;
  nodeCount: number;
  edgeCount: number;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const GraphNodeSchema = new Schema<GraphNode>(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    label: { type: String, required: true },
    description: String,
    properties: { type: Schema.Types.Mixed, default: {} },
    embedding: { type: [Number], default: [] },
    importance: { type: Number, default: 0.5 },
    frequency: { type: Number, default: 1 },
    sentiment: { type: Number, default: 0 },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    tags: { type: [String], default: [] },
  },
  { _id: false }
);

const GraphEdgeSchema = new Schema<GraphEdge>(
  {
    id: { type: String, required: true },
    sourceId: { type: String, required: true },
    targetId: { type: String, required: true },
    type: { type: String, required: true },
    weight: { type: Number, default: 0.5 },
    confidence: { type: Number, default: 0.7 },
    context: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const KnowledgeGraphSchema = new Schema<KnowledgeGraphInterface>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true },
    nodes: { type: [GraphNodeSchema], default: [] },
    edges: { type: [GraphEdgeSchema], default: [] },
    summary: { type: String, default: "" },
    dominantTopics: { type: [String], default: [] },
    knowledgeClusters: {
      type: [
        new Schema(
          { clusterId: String, label: String, nodeIds: [String], strength: Number },
          { _id: false }
        ),
      ],
      default: [],
    },
    anonymisedContribution: { type: Boolean, default: true },
    contributionHash: { type: String, default: "" },
    lastGraphUpdate: { type: Date, default: Date.now },
    nodeCount: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

KnowledgeGraphSchema.index({ userId: 1 }, { unique: true });
KnowledgeGraphSchema.index({ "nodes.label": "text", "nodes.tags": "text" });

export default mongoose.model<KnowledgeGraphInterface>("KnowledgeGraph", KnowledgeGraphSchema);
