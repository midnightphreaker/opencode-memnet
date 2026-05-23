// src/services/user-profile-learner-server.ts
// Server-side user profile learning: AI provider calls without OpenCode plugin dependency.
// Mirrors the logic from user-memory-learning.ts but uses AIProviderFactory directly.

import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import type { UserProfileData } from "./storage/types.js";

// ── Prompt builder ──────────────────────────────────────────

export function buildUserAnalysisContext(
  prompts: string[],
  existingProfileJson: string | null
): string {
  const existingProfileSection = existingProfileJson
    ? `
## Existing User Profile

${existingProfileJson}

**Instructions**: Merge new insights with the existing profile. Update confidence scores for reinforced patterns, add new patterns, and refine existing ones.`
    : `
**Instructions**: Create a new user profile from scratch based on the prompts below.`;

  return `# User Profile Analysis

Analyze ${prompts.length} user prompts to ${existingProfileJson ? "update" : "create"} the user profile.

${existingProfileSection}

## Recent Prompts

${prompts.map((p, i) => `${i + 1}. ${p}`).join("\n\n")}

## Analysis Guidelines

Identify and ${existingProfileJson ? "update" : "create"}:

1. **Preferences** (max ${CONFIG.userProfileMaxPreferences})
   - Code style, communication style, tool preferences
   - Assign confidence 0.5-1.0 based on evidence strength
   - Include 1-3 example prompts as evidence

2. **Patterns** (max ${CONFIG.userProfileMaxPatterns})
   - Recurring topics, problem domains, technical interests
   - Track frequency of occurrence

3. **Workflows** (max ${CONFIG.userProfileMaxWorkflows})
   - Development sequences, habits, learning style
   - Break down into steps if applicable

${existingProfileJson ? "Merge with existing profile, incrementing frequencies and updating confidence scores." : "Create initial profile with conservative confidence scores."}`;
}

// ── Tool schema for structured output ───────────────────────

const PROFILE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "update_user_profile",
    description: "Update or create user profile",
    parameters: {
      type: "object",
      properties: {
        preferences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              description: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "array", items: { type: "string" }, maxItems: 3 },
            },
            required: ["category", "description", "confidence", "evidence"],
          },
        },
        patterns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              description: { type: "string" },
            },
            required: ["category", "description"],
          },
        },
        workflows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              steps: { type: "array", items: { type: "string" } },
            },
            required: ["description", "steps"],
          },
        },
      },
      required: ["preferences", "patterns", "workflows"],
    },
  },
};

// ── Analyze user profile via AI ─────────────────────────────

export async function analyzeUserProfile(
  prompts: string[],
  existingProfileJson: string | null
): Promise<UserProfileData | null> {
  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    throw new Error(
      "Server requires memoryModel and memoryApiUrl for user profile learning. Configure these in opencode-memnet.jsonc."
    );
  }

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);
  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

  const context = buildUserAnalysisContext(prompts, existingProfileJson);

  const systemPrompt = `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfileJson ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

Use the update_user_profile tool to save the ${existingProfileJson ? "updated" : "new"} profile.`;

  const result = await provider.executeToolCall(
    systemPrompt,
    context,
    PROFILE_TOOL_SCHEMA,
    `user-profile-${Date.now()}`
  );

  if (!result.success || !result.data) {
    log("Server profile analysis: AI returned no data", { error: result.error });
    return null;
  }

  return result.data as UserProfileData;
}

// ── Generate change summary ─────────────────────────────────

export function generateChangeSummary(
  oldProfile: UserProfileData,
  newProfile: UserProfileData
): string {
  const changes: string[] = [];

  const prefDiff = newProfile.preferences.length - oldProfile.preferences.length;
  if (prefDiff > 0) changes.push(`+${prefDiff} preferences`);

  const patternDiff = newProfile.patterns.length - oldProfile.patterns.length;
  if (patternDiff > 0) changes.push(`+${patternDiff} patterns`);

  const workflowDiff = newProfile.workflows.length - oldProfile.workflows.length;
  if (workflowDiff > 0) changes.push(`+${workflowDiff} workflows`);

  return changes.length > 0 ? changes.join(", ") : "Profile refinement";
}
