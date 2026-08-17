/**
 * user-intelligence.ts
 *
 * The central intelligence service that:
 *  1. Builds and updates each user's psychological + cognitive profile
 *  2. Extracts entities + relationships from messages → knowledge graph
 *  3. Generates personalised system prompts using chain-of-thought
 *  4. Tracks emotional state, interests, communication style in real-time
 *  5. Summarises graph clusters into actionable insights
 *  6. Contributes anonymised data to the collective super-graph
 *
 * All updates are async and non-blocking — they happen AFTER the response streams.
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import UserProfile, { UserProfileInterface, OceanTraits, EmotionalSnapshot, InterestNode } from "../models/user-profile-model";
import KnowledgeGraph, { KnowledgeGraphInterface, GraphNode, GraphEdge, NodeType } from "../models/knowledge-graph-model";
import { RedisCache } from "../services/cache/redis-cache";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

// ── Rate limit tiers ──────────────────────────────────────────────────────────

export const getRateLimitTiers = () => ({
  free: {
    dailyMessagesLimit: parseInt(process.env.TIER_FREE_MSG_LIMIT || "50", 10),
    dailyToolUsesLimit: parseInt(process.env.TIER_FREE_TOOL_LIMIT || "10", 10),
    dailyTokensLimit: parseInt(process.env.TIER_FREE_TOKEN_LIMIT || "100000", 10),
    codeExecutionEnabled: process.env.TIER_FREE_CODE_EXEC === "true",
    agentsEnabled: process.env.TIER_FREE_AGENTS === "true",
  },
  pro: {
    dailyMessagesLimit: parseInt(process.env.TIER_PRO_MSG_LIMIT || "500", 10),
    dailyToolUsesLimit: parseInt(process.env.TIER_PRO_TOOL_LIMIT || "200", 10),
    dailyTokensLimit: parseInt(process.env.TIER_PRO_TOKEN_LIMIT || "2000000", 10),
    codeExecutionEnabled: (process.env.TIER_PRO_CODE_EXEC || "true") === "true",
    agentsEnabled: (process.env.TIER_PRO_AGENTS || "true") === "true",
  },
  enterprise: {
    dailyMessagesLimit: parseInt(process.env.TIER_ENT_MSG_LIMIT || "999999", 10),
    dailyToolUsesLimit: parseInt(process.env.TIER_ENT_TOOL_LIMIT || "999999", 10),
    dailyTokensLimit: parseInt(process.env.TIER_ENT_TOKEN_LIMIT || "50000000", 10),
    codeExecutionEnabled: (process.env.TIER_ENT_CODE_EXEC || "true") === "true",
    agentsEnabled: (process.env.TIER_ENT_AGENTS || "true") === "true",
  },
  admin: {
    dailyMessagesLimit: parseInt(process.env.TIER_ADMIN_MSG_LIMIT || "999999", 10),
    dailyToolUsesLimit: parseInt(process.env.TIER_ADMIN_TOOL_LIMIT || "999999", 10),
    dailyTokensLimit: parseInt(process.env.TIER_ADMIN_TOKEN_LIMIT || "999999999", 10),
    codeExecutionEnabled: (process.env.TIER_ADMIN_CODE_EXEC || "true") === "true",
    agentsEnabled: (process.env.TIER_ADMIN_AGENTS || "true") === "true",
  },
});

// ── Get or create user profile ────────────────────────────────────────────────

export async function getOrCreateProfile(userId: string, tenantId: string): Promise<UserProfileInterface> {
  let profile = await UserProfile.findOne({ userId });
  if (!profile) {
    profile = await UserProfile.create({ userId, tenantId });
    console.log(`[UserIntel] Created new profile for user=${userId}`);
  }
  const lastReset = profile.rateLimit.lastResetAt;
  const now = new Date();
  if (!lastReset || lastReset.toDateString() !== now.toDateString()) {
    profile.rateLimit.lastResetAt = now;
    await profile.save();
  }
  return profile;
}

// ── Check rate limits ─────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  resetAt?: Date;
  tier: string;
  remaining: {
    messages: number;
    toolUses: number;
    tokens: number;
  };
}

export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  const profile = await UserProfile.findOne({ userId });
  if (!profile) return { allowed: true, tier: "free", remaining: { messages: 50, toolUses: 10, tokens: 100_000 } };

  const rl = profile.rateLimit;
  const today = new Date().toISOString().split("T")[0];

  const msgsUsedStr = (await RedisCache.get<string>(`rateLimit:${userId}:msgs:${today}`)) || "0";
  const tokensUsedStr = (await RedisCache.get<string>(`rateLimit:${userId}:tokens:${today}`)) || "0";
  const toolsUsedStr = (await RedisCache.get<string>(`rateLimit:${userId}:tools:${today}`)) || "0";

  const msgsUsed = parseInt(msgsUsedStr as string, 10) || 0;
  const tokensUsed = parseInt(tokensUsedStr as string, 10) || 0;
  const toolsUsed = parseInt(toolsUsedStr as string, 10) || 0;

  if (msgsUsed >= rl.dailyMessagesLimit) {
    return {
      allowed: false,
      reason: `Daily message limit reached (${rl.dailyMessagesLimit}). Resets at midnight.`,
      resetAt: new Date(new Date().setHours(24, 0, 0, 0)),
      tier: rl.tier,
      remaining: { messages: 0, toolUses: Math.max(0, rl.dailyToolUsesLimit - toolsUsed), tokens: Math.max(0, rl.dailyTokensLimit - tokensUsed) },
    };
  }

  return {
    allowed: true,
    tier: rl.tier,
    remaining: {
      messages: Math.max(0, rl.dailyMessagesLimit - msgsUsed),
      toolUses: Math.max(0, rl.dailyToolUsesLimit - toolsUsed),
      tokens: Math.max(0, rl.dailyTokensLimit - tokensUsed),
    },
  };
}

export async function incrementUsage(userId: string, tokens: number, toolUsed = false) {
  const today = new Date().toISOString().split("T")[0];
  
  await RedisCache.incrby(`rateLimit:${userId}:msgs:${today}`, 1);
  await RedisCache.incrby(`rateLimit:${userId}:tokens:${today}`, tokens);
  if (toolUsed) {
    await RedisCache.incrby(`rateLimit:${userId}:tools:${today}`, 1);
  }

  // Update total messages asynchronously without blocking rate limits
  UserProfile.findOneAndUpdate(
    { userId },
    { $inc: { totalMessages: 1 }, $set: { lastUpdated: new Date() } }
  ).exec().catch(() => {});
}

// ── Build personalised system prompt ─────────────────────────────────────────

export async function buildPersonalisedSystemPrompt(userId: string, baseSystem: string): Promise<string> {
  const profile = await UserProfile.findOne({ userId }).lean();
  if (!profile) return baseSystem;

  const parts: string[] = [baseSystem];

  // Communication style
  const style = profile.communicationStyle;
  const formalityStr = style.formality > 0.7 ? "formal" : style.formality < 0.3 ? "casual and friendly" : "balanced";
  const verbosityStr = style.verbosity > 0.7 ? "detailed and thorough" : style.verbosity < 0.3 ? "concise and direct" : "moderately detailed";
  const bulletPref = style.prefersBullets ? "Use bullet points when listing multiple items." : "Use flowing prose unless a list is clearly needed.";
  const codePref = style.prefersCode ? "Include code examples when relevant." : "";

  parts.push(`\n## How to Respond to This User
- Tone: ${formalityStr}
- Detail level: ${verbosityStr}
- ${bulletPref}
${codePref ? `- ${codePref}` : ""}
- Preferred response length: ${style.responseLength}`);

  // Emotional context
  const emotion = profile.currentEmotionalState;
  if (emotion && emotion.dominant !== "neutral") {
    parts.push(`\n## Current Emotional Context
The user appears to be feeling ${emotion.dominant} (valence: ${emotion.valence > 0 ? "positive" : "slightly negative"}).
Adjust your tone accordingly — be ${emotion.valence < -0.3 ? "supportive and encouraging" : "engaged and energetic"}.`);
  }

  // Interests & expertise
  const topInterests = profile.interests
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5)
    .map((i) => i.topic);

  if (topInterests.length > 0) {
    parts.push(`\n## User's Key Interests & Expertise
Known interests: ${topInterests.join(", ")}.
Domains of expertise: ${profile.expertiseDomains.slice(0, 5).join(", ")}.
Tailor examples and analogies to these areas when relevant.`);
  }

  // Active goals
  if (profile.currentGoals.length > 0) {
    parts.push(`\n## User's Current Goals
${profile.currentGoals.slice(0, 3).map((g) => `- ${g}`).join("\n")}
Keep these goals in mind when making suggestions.`);
  }

  // Long-term memory
  if (profile.longTermMemory.length > 0) {
    parts.push(`\n## Important Facts About This User
${profile.longTermMemory.slice(0, 10).map((m) => `- ${m}`).join("\n")}`);
  }

  // Recent context
  if (profile.recentContext) {
    parts.push(`\n## Recent Conversation Context
${profile.recentContext}`);
  }

  return parts.join("\n");
}

// ── Analyse message for psychological signals ─────────────────────────────────

interface MessageAnalysis {
  emotion: EmotionalSnapshot;
  entities: Array<{ label: string; type: NodeType; properties?: Record<string, unknown> }>;
  relationships: Array<{ source: string; target: string; type: string }>;
  intent: string;
  interests: string[];
  goals: string[];
  facts: string[];
  oceanSignals: Partial<OceanTraits>;
}

export async function analyseMessage(
  userId: string,
  message: string,
  response: string,
  sessionId: string
): Promise<void> {
  // Run async analysis — non-blocking
  setImmediate(async () => {
    try {
      const analysis = await extractAnalysis(message, response);
      await updateProfile(userId, sessionId, analysis, message);
      await updateKnowledgeGraph(userId, analysis);
    } catch (err: any) {
      console.error(`[UserIntel] Analysis error for user=${userId}:`, err?.message);
    }
  });
}

async function extractAnalysis(message: string, response: string): Promise<MessageAnalysis> {
  const prompt = `Analyse this conversation snippet and extract structured data.

User message: "${message.slice(0, 500)}"
Assistant response: "${response.slice(0, 300)}"

Return a JSON object with exactly this structure (no extra keys):
{
  "emotion": { "dominant": "curious|excited|stressed|neutral|frustrated|happy|anxious|confident|confused|focused", "valence": -1.0 to 1.0, "arousal": 0.0 to 1.0 },
  "entities": [{ "label": "entity name", "type": "concept|person|project|goal|fact|event|tool|organisation", "properties": {} }],
  "relationships": [{ "source": "entity1", "target": "entity2", "type": "related_to|part_of|leads_to|depends_on|similar_to" }],
  "intent": "one sentence describing what the user wants",
  "interests": ["topic1", "topic2"],
  "goals": ["goal1"],
  "facts": ["important fact about the user"],
  "oceanSignals": { "openness": null or 0-1, "conscientiousness": null or 0-1, "extraversion": null or 0-1, "agreeableness": null or 0-1, "neuroticism": null or 0-1 }
}

Only include ocean signals if clearly evidenced. Return ONLY the JSON. No explanation.`;

  const res = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 30_000 }
  );

  let raw = (res.data?.response as string || "").trim();
  raw = raw.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(raw) as MessageAnalysis;
  } catch {
    return {
      emotion: { timestamp: new Date(), dominant: "neutral", valence: 0, arousal: 0.3, context: "" },
      entities: [],
      relationships: [],
      intent: "",
      interests: [],
      goals: [],
      facts: [],
      oceanSignals: {},
    };
  }
}

async function updateProfile(
  userId: string,
  sessionId: string,
  analysis: MessageAnalysis,
  message: string
): Promise<void> {
  const profile = await UserProfile.findOne({ userId });
  if (!profile) return;

  // Update emotional state
  const emotionSnapshot: EmotionalSnapshot = {
    timestamp: new Date(),
    dominant: analysis.emotion?.dominant || "neutral",
    valence: analysis.emotion?.valence || 0,
    arousal: analysis.emotion?.arousal || 0.3,
    context: message.slice(0, 100),
    sessionId,
  };

  profile.currentEmotionalState = emotionSnapshot;
  profile.emotionalHistory.push(emotionSnapshot);
  if (profile.emotionalHistory.length > 200) {
    profile.emotionalHistory = profile.emotionalHistory.slice(-200);
  }

  // Rolling 30-entry valence average
  const recent30 = profile.emotionalHistory.slice(-30);
  profile.averageValence = recent30.reduce((sum, e) => sum + e.valence, 0) / (recent30.length || 1);

  // Update OCEAN traits (exponential moving average — new signals weighted 10%)
  if (analysis.oceanSignals) {
    const alpha = 0.1;
    for (const trait of ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as Array<keyof OceanTraits>) {
      const signal = (analysis.oceanSignals as any)[trait];
      if (signal !== null && signal !== undefined && !isNaN(signal)) {
        (profile.ocean as any)[trait] = (1 - alpha) * ((profile.ocean as any)[trait] || 0.5) + alpha * signal;
      }
    }
  }

  // Update interests
  for (const topic of analysis.interests || []) {
    const existing = profile.interests.find((i) => i.topic.toLowerCase() === topic.toLowerCase());
    if (existing) {
      existing.strength = Math.min(1, existing.strength + 0.05);
      existing.evidenceCount += 1;
      existing.lastReinforced = new Date();
    } else {
      profile.interests.push({ topic, domain: "general", strength: 0.3, lastReinforced: new Date(), evidenceCount: 1 });
    }
  }

  // Cap interests at 100
  if (profile.interests.length > 100) {
    profile.interests = profile.interests
      .sort((a, b) => b.strength * b.evidenceCount - a.strength * a.evidenceCount)
      .slice(0, 100);
  }

  // Update goals (deduplicate)
  for (const goal of analysis.goals || []) {
    if (!profile.currentGoals.includes(goal) && profile.currentGoals.length < 20) {
      profile.currentGoals.push(goal);
    }
  }

  // Add important facts to long-term memory
  for (const fact of analysis.facts || []) {
    if (!profile.longTermMemory.includes(fact) && profile.longTermMemory.length < 50) {
      profile.longTermMemory.push(fact);
    }
  }

  // Update message length stats (rolling avg)
  profile.communicationStyle.avgMessageLength =
    (profile.communicationStyle.avgMessageLength * 0.9) + (message.length * 0.1);

  // Update verbosity preference based on message length
  if (message.length > 200) profile.communicationStyle.verbosity = Math.min(1, profile.communicationStyle.verbosity + 0.01);
  if (message.length < 50) profile.communicationStyle.verbosity = Math.max(0, profile.communicationStyle.verbosity - 0.01);

  profile.totalMessages += 1;
  profile.profileVersion += 1;
  profile.lastUpdated = new Date();

  await profile.save();
}

async function updateKnowledgeGraph(userId: string, analysis: MessageAnalysis): Promise<void> {
  let graph = await KnowledgeGraph.findOne({ userId });
  if (!graph) {
    const tenantId = (await UserProfile.findOne({ userId }))?.tenantId || userId;
    graph = await KnowledgeGraph.create({ userId, tenantId });
  }

  const now = new Date();

  // Merge entities as nodes
  for (const entity of analysis.entities || []) {
    const existingNode = graph.nodes.find(
      (n) => n.label.toLowerCase() === entity.label.toLowerCase() && n.type === entity.type
    );

    if (existingNode) {
      existingNode.frequency += 1;
      existingNode.lastSeen = now;
      existingNode.importance = Math.min(1, existingNode.importance + 0.01);
    } else {
      const newNode: GraphNode = {
        id: uuidv4(),
        type: (entity.type as NodeType) || "concept",
        label: entity.label,
        properties: entity.properties || {},
        importance: 0.3,
        frequency: 1,
        sentiment: 0,
        firstSeen: now,
        lastSeen: now,
        tags: [],
      };
      graph.nodes.push(newNode);
    }
  }

  // Merge relationships as edges
  for (const rel of analysis.relationships || []) {
    const sourceNode = graph.nodes.find((n) => n.label.toLowerCase() === rel.source.toLowerCase());
    const targetNode = graph.nodes.find((n) => n.label.toLowerCase() === rel.target.toLowerCase());

    if (sourceNode && targetNode) {
      const existingEdge = graph.edges.find(
        (e) => e.sourceId === sourceNode.id && e.targetId === targetNode.id && e.type === rel.type
      );

      if (existingEdge) {
        existingEdge.weight = Math.min(1, existingEdge.weight + 0.05);
        existingEdge.updatedAt = now;
      } else {
        graph.edges.push({
          id: uuidv4(),
          sourceId: sourceNode.id,
          targetId: targetNode.id,
          type: rel.type as any,
          weight: 0.4,
          confidence: 0.6,
          context: "",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // Cap graph size
  if (graph.nodes.length > 500) {
    graph.nodes = graph.nodes
      .sort((a, b) => (b.importance * b.frequency) - (a.importance * a.frequency))
      .slice(0, 500);

    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    graph.edges = graph.edges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
  }

  // Update dominant topics
  const topNodes = [...graph.nodes]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10);
  graph.dominantTopics = topNodes.map((n) => n.label);
  graph.nodeCount = graph.nodes.length;
  graph.edgeCount = graph.edges.length;
  graph.lastGraphUpdate = now;

  await graph.save();
}

// ── Update chain of thought ───────────────────────────────────────────────────

export async function recordChainOfThought(
  userId: string,
  sessionId: string,
  intent: string,
  outcome: string,
  insights: string[]
): Promise<void> {
  const summary = `${intent} → ${outcome}`;

  await UserProfile.findOneAndUpdate(
    { userId },
    {
      $push: {
        chainOfThought: {
          $each: [{ sessionId, timestamp: new Date(), summary, intent, outcome, keyInsights: insights }],
          $slice: -100,  // keep last 100
        },
      },
      $set: { "recentContext": `Last task: ${summary}` },
    }
  );
}

// ── Get user insights for display ─────────────────────────────────────────────

export async function getUserInsights(userId: string): Promise<{
  profile: UserProfileInterface | null;
  graph: {
    nodeCount: number;
    edgeCount: number;
    dominantTopics: string[];
    topNodes: Array<{ label: string; type: string; importance: number }>;
  } | null;
  rateLimitStatus: RateLimitResult;
}> {
  const [profile, graph, rateLimitStatus] = await Promise.all([
    UserProfile.findOne({ userId }).lean() as Promise<UserProfileInterface | null>,
    KnowledgeGraph.findOne({ userId }).lean() as Promise<KnowledgeGraphInterface | null>,
    checkRateLimit(userId),
  ]);

  return {
    profile,
    graph: graph ? {
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      dominantTopics: graph.dominantTopics,
      topNodes: graph.nodes
        .sort((a, b) => (b.importance * b.frequency) - (a.importance * a.frequency))
        .slice(0, 20)
        .map((n) => ({ label: n.label, type: n.type, importance: n.importance })),
    } : null,
    rateLimitStatus,
  };
}

// ── Collective super-graph contribution ────────────────────────────────────────

export async function contributeToSuperGraph(userId: string): Promise<void> {
  // Anonymised contribution — strips personal identifiers
  const profile = await UserProfile.findOne({ userId });
  const graph = await KnowledgeGraph.findOne({ userId });

  if (!profile?.shareAnonymisedData || !graph) return;

  // Only contribute concept-type nodes (never person/file/event)
  const safeNodes = graph.nodes
    .filter((n) => n.type === "concept" || n.type === "tool" || n.type === "goal")
    .map((n) => ({ label: n.label, type: n.type, importance: n.importance }));

  // In a production system, this would push to a separate aggregate collection
  // For now, we mark the contribution timestamp
  await KnowledgeGraph.findOneAndUpdate(
    { userId },
    { $set: { anonymisedContribution: true, contributionHash: `hash_${userId.slice(-8)}_${Date.now()}` } }
  );

  console.log(`[SuperGraph] User ${userId.slice(-8)} contributed ${safeNodes.length} anonymised nodes`);
}

// ── Upgrade user tier ─────────────────────────────────────────────────────────

export async function setUserTier(userId: string, tier: "free" | "pro" | "enterprise" | "admin"): Promise<void> {
  const tiers = getRateLimitTiers();
  const tierConfig = tiers[tier];
  await UserProfile.findOneAndUpdate(
    { userId },
    {
      $set: {
        "rateLimit.tier": tier,
        "rateLimit.dailyMessagesLimit": tierConfig.dailyMessagesLimit,
        "rateLimit.dailyToolUsesLimit": tierConfig.dailyToolUsesLimit,
        "rateLimit.dailyTokensLimit": tierConfig.dailyTokensLimit,
        "rateLimit.codeExecutionEnabled": tierConfig.codeExecutionEnabled,
        "rateLimit.agentsEnabled": tierConfig.agentsEnabled,
      },
    }
  );
}

// ── Custom override for a specific user ───────────────────────────────────────

export async function setUserCustomLimits(userId: string, customConfig: Partial<typeof getRateLimitTiers extends () => { free: infer T } ? T : never>): Promise<void> {
  const updatePayload: Record<string, unknown> = {};
  if (customConfig.dailyMessagesLimit !== undefined) updatePayload["rateLimit.dailyMessagesLimit"] = customConfig.dailyMessagesLimit;
  if (customConfig.dailyToolUsesLimit !== undefined) updatePayload["rateLimit.dailyToolUsesLimit"] = customConfig.dailyToolUsesLimit;
  if (customConfig.dailyTokensLimit !== undefined) updatePayload["rateLimit.dailyTokensLimit"] = customConfig.dailyTokensLimit;
  if (customConfig.codeExecutionEnabled !== undefined) updatePayload["rateLimit.codeExecutionEnabled"] = customConfig.codeExecutionEnabled;
  if (customConfig.agentsEnabled !== undefined) updatePayload["rateLimit.agentsEnabled"] = customConfig.agentsEnabled;

  if (Object.keys(updatePayload).length > 0) {
    await UserProfile.findOneAndUpdate({ userId }, { $set: updatePayload });
  }
}

// ── AdSense / Monetization ───────────────────────────────────────────────────

export async function extractAdSenseKeywords(userId: string): Promise<string[]> {
  const profile = await UserProfile.findOne({ userId }).lean();
  if (!profile) return [];

  // Extract top 5 interests based on evidenceCount and emotional attachment
  const sortedInterests = profile.interests.sort((a, b) => b.evidenceCount - a.evidenceCount);
  const keywords = sortedInterests.slice(0, 5).map(i => i.topic);
  
  // Combine with general traits
  if (profile.ocean.openness > 0.7) keywords.push("innovative", "new tech");
  
  return keywords;
}
