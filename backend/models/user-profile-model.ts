/**
 * user-profile-model.ts
 *
 * The cognitive + psychological + behavioural profile for each user.
 * This is the "brain's understanding" of who the person is — updated
 * continuously from every interaction, file upload, message, and task.
 *
 * Includes:
 *  - Big Five (OCEAN) personality traits
 *  - Emotional state history & rolling averages
 *  - Communication style preferences
 *  - Work patterns and productivity rhythms
 *  - Interests, expertise domains, goals
 *  - Chain-of-thought summaries per session
 *  - Rate limiting state (free / paid tier)
 */

import mongoose, { Schema, Document } from "mongoose";

// ── OCEAN Personality Traits ─────────────────────────────────────────────────
export interface OceanTraits {
  openness: number;          // 0-1: curiosity, creativity, imagination
  conscientiousness: number; // 0-1: organisation, dependability, discipline
  extraversion: number;      // 0-1: sociability, assertiveness, energy
  agreeableness: number;     // 0-1: cooperativeness, empathy, warmth
  neuroticism: number;       // 0-1: anxiety, emotional instability, sensitivity
}

// ── Emotional State Snapshot ─────────────────────────────────────────────────
export interface EmotionalSnapshot {
  timestamp: Date;
  dominant: string;          // e.g. "curious", "stressed", "excited", "neutral"
  valence: number;           // -1 (negative) to +1 (positive)
  arousal: number;           // 0 (calm) to 1 (highly activated)
  context: string;           // what triggered this state
  sessionId?: string;
}

// ── Interest / Expertise Node ─────────────────────────────────────────────────
export interface InterestNode {
  topic: string;
  domain: string;           // "finance", "technology", "health", "creative" etc.
  strength: number;         // 0-1 confidence/interest level
  lastReinforced: Date;
  evidenceCount: number;    // how many times this has been observed
}

// ── Communication Style ──────────────────────────────────────────────────────
export interface CommunicationStyle {
  formality: number;        // 0=very casual, 1=very formal
  verbosity: number;        // 0=concise, 1=verbose
  prefersBullets: boolean;
  prefersCode: boolean;
  preferredLanguage: string;
  avgMessageLength: number;
  responseLength: "short" | "medium" | "long" | "detailed";
}

// ── Work Pattern ─────────────────────────────────────────────────────────────
export interface WorkPattern {
  peakHoursUTC: number[];   // e.g. [9, 10, 11, 14, 15] — active hours
  avgSessionMinutes: number;
  taskCompletionStyle: "methodical" | "exploratory" | "deadline-driven";
  prefersStructured: boolean;
  timezone: string;
}

// ── Rate Limit State ─────────────────────────────────────────────────────────
export interface RateLimitState {
  tier: "free" | "pro" | "enterprise" | "admin";
  dailyMessagesUsed: number;
  dailyMessagesLimit: number;
  dailyToolUsesUsed: number;
  dailyToolUsesLimit: number;
  dailyTokensUsed: number;
  dailyTokensLimit: number;
  codeExecutionEnabled: boolean;
  agentsEnabled: boolean;
  lastResetAt: Date;
  monthlySpend?: number;
}

// ── Chain of Thought Entry ────────────────────────────────────────────────────
export interface ChainOfThoughtEntry {
  sessionId: string;
  timestamp: Date;
  summary: string;          // condensed reasoning chain
  intent: string;
  outcome: string;
  keyInsights: string[];
}

// ── User Profile Interface ────────────────────────────────────────────────────
export interface UserProfileInterface extends Document {
  userId: string;                       // FK to User model
  tenantId: string;

  // Identity & personality
  displayName?: string;
  ocean: OceanTraits;
  communicationStyle: CommunicationStyle;
  workPattern: WorkPattern;

  // Interests & knowledge domains
  interests: InterestNode[];
  expertiseDomains: string[];
  currentGoals: string[];

  // Emotional history
  emotionalHistory: EmotionalSnapshot[];
  currentEmotionalState: EmotionalSnapshot;
  averageValence: number;               // rolling 30-day avg

  // Chain of thought & memory
  chainOfThought: ChainOfThoughtEntry[];
  longTermMemory: string[];             // important facts to always remember
  recentContext: string;                // last 5-session context summary

  // Data & behavioural stats
  totalSessions: number;
  totalMessages: number;
  totalFilesUploaded: number;
  preferredTools: string[];             // tools the user uses most

  // Rate limiting
  rateLimit: RateLimitState;

  // Collective sharing (for free-tier graph contribution)
  shareAnonymisedData: boolean;
  anonymisedProfileVector?: number[];   // embedding of personality for collective graph

  // System
  profileVersion: number;              // incremented on each update
  lastUpdated: Date;
  createdAt: Date;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const OceanSchema = new Schema<OceanTraits>(
  { openness: Number, conscientiousness: Number, extraversion: Number, agreeableness: Number, neuroticism: Number },
  { _id: false }
);

const EmotionalSnapshotSchema = new Schema<EmotionalSnapshot>(
  { timestamp: Date, dominant: String, valence: Number, arousal: Number, context: String, sessionId: String },
  { _id: false }
);

const InterestNodeSchema = new Schema<InterestNode>(
  { topic: String, domain: String, strength: Number, lastReinforced: Date, evidenceCount: Number },
  { _id: false }
);

const CommunicationStyleSchema = new Schema<CommunicationStyle>(
  { formality: Number, verbosity: Number, prefersBullets: Boolean, prefersCode: Boolean, preferredLanguage: String, avgMessageLength: Number, responseLength: String },
  { _id: false }
);

const WorkPatternSchema = new Schema<WorkPattern>(
  { peakHoursUTC: [Number], avgSessionMinutes: Number, taskCompletionStyle: String, prefersStructured: Boolean, timezone: String },
  { _id: false }
);

const RateLimitStateSchema = new Schema<RateLimitState>(
  { tier: { type: String, default: "free" }, dailyMessagesUsed: { type: Number, default: 0 }, dailyMessagesLimit: { type: Number, default: 50 }, dailyToolUsesUsed: { type: Number, default: 0 }, dailyToolUsesLimit: { type: Number, default: 10 }, dailyTokensUsed: { type: Number, default: 0 }, dailyTokensLimit: { type: Number, default: 100_000 }, codeExecutionEnabled: { type: Boolean, default: false }, agentsEnabled: { type: Boolean, default: false }, lastResetAt: { type: Date, default: Date.now }, monthlySpend: Number },
  { _id: false }
);

const ChainOfThoughtSchema = new Schema<ChainOfThoughtEntry>(
  { sessionId: String, timestamp: Date, summary: String, intent: String, outcome: String, keyInsights: [String] },
  { _id: false }
);

const UserProfileSchema = new Schema<UserProfileInterface>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    displayName: String,

    ocean: { type: OceanSchema, default: () => ({ openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }) },
    communicationStyle: { type: CommunicationStyleSchema, default: () => ({ formality: 0.5, verbosity: 0.5, prefersBullets: false, prefersCode: false, preferredLanguage: "en", avgMessageLength: 80, responseLength: "medium" }) },
    workPattern: { type: WorkPatternSchema, default: () => ({ peakHoursUTC: [], avgSessionMinutes: 0, taskCompletionStyle: "exploratory", prefersStructured: false, timezone: "UTC" }) },

    interests: { type: [InterestNodeSchema], default: [] },
    expertiseDomains: { type: [String], default: [] },
    currentGoals: { type: [String], default: [] },

    emotionalHistory: { type: [EmotionalSnapshotSchema], default: [] },
    currentEmotionalState: { type: EmotionalSnapshotSchema, default: () => ({ timestamp: new Date(), dominant: "neutral", valence: 0, arousal: 0.3, context: "" }) },
    averageValence: { type: Number, default: 0 },

    chainOfThought: { type: [ChainOfThoughtSchema], default: [] },
    longTermMemory: { type: [String], default: [] },
    recentContext: { type: String, default: "" },

    totalSessions: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    totalFilesUploaded: { type: Number, default: 0 },
    preferredTools: { type: [String], default: [] },

    rateLimit: { type: RateLimitStateSchema, default: () => ({}) },

    shareAnonymisedData: { type: Boolean, default: true },
    anonymisedProfileVector: { type: [Number], default: [] },

    profileVersion: { type: Number, default: 1 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

UserProfileSchema.index({ userId: 1 }, { unique: true });
UserProfileSchema.index({ "rateLimit.tier": 1 });

export default mongoose.model<UserProfileInterface>("UserProfile", UserProfileSchema);
