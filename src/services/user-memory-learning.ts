import type { PluginInput } from "@opencode-ai/plugin";
import { getTags } from "./tags.js";
import { log, logDebug } from "./logger.js";
import { CONFIG } from "../config.js";
import { createUserPromptRepository, createUserProfileRepository } from "./storage/factory.js";
import type {
  UserPromptRepository,
  UserProfileRepository,
  UserProfileRow,
  UserProfileData,
} from "./storage/types.js";

const promptRepo: UserPromptRepository = createUserPromptRepository();
const profileRepo: UserProfileRepository = createUserProfileRepository();

let isLearningRunning = false;

export async function performUserProfileLearning(
  ctx: PluginInput,
  directory: string
): Promise<void> {
  if (isLearningRunning) return;
  isLearningRunning = true;
  try {
    const count = await promptRepo.countUnanalyzedForUserLearning();
    const threshold = CONFIG.userProfileAnalysisInterval;

    if (count < threshold) {
      return;
    }

    const prompts = await promptRepo.getPromptsForUserLearning(threshold);

    if (prompts.length === 0) {
      return;
    }

    const tags = await getTags(directory);
    const userId = tags.user.userEmail;
    if (!userId) {
      throw new Error(
        "Cannot perform profile learning: no user email configured. " +
          "Set git user.email or provide userEmailOverride in config."
      );
    }

    const existingProfile = await profileRepo.getActiveProfile(userId);

    const context = buildUserAnalysisContext(prompts, existingProfile);

    const updatedProfileData = await analyzeUserProfile(context, existingProfile);

    if (!updatedProfileData) {
      await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
      return;
    }

    if (existingProfile) {
      let profileData;
      try {
        profileData = JSON.parse(existingProfile.profileData);
      } catch (err) {
        log("Corrupt profile data, skipping learning cycle for this profile", {
          profileId: existingProfile.id,
          error: err,
        });
        // Mark prompts as analyzed so they don't get picked up again in an infinite loop
        await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
        return;
      }
      const changeSummary = generateChangeSummary(profileData, updatedProfileData);
      await profileRepo.updateProfile(
        existingProfile.id,
        updatedProfileData,
        prompts.length,
        changeSummary
      );
    } else {
      await profileRepo.createProfile(
        userId,
        tags.user.displayName || "Unknown",
        tags.user.userName || "unknown",
        tags.user.userEmail || "unknown",
        updatedProfileData,
        prompts.length
      );
    }

    await promptRepo.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));

    if (CONFIG.showUserProfileToasts) {
      await ctx.client?.tui
        .showToast({
          body: {
            title: "User Profile Updated",
            message: `Analyzed ${prompts.length} prompts and updated your profile`,
            variant: "success",
            duration: 3000,
          },
        })
        .catch((e) => {
          logDebug("toast failed", { error: String(e) });
        });
    }
  } finally {
    isLearningRunning = false;
  }
}

function generateChangeSummary(oldProfile: UserProfileData, newProfile: UserProfileData): string {
  const changes: string[] = [];

  const prefDiff = newProfile.preferences.length - oldProfile.preferences.length;
  if (prefDiff > 0) changes.push(`+${prefDiff} preferences`);

  const patternDiff = newProfile.patterns.length - oldProfile.patterns.length;
  if (patternDiff > 0) changes.push(`+${patternDiff} patterns`);

  const workflowDiff = newProfile.workflows.length - oldProfile.workflows.length;
  if (workflowDiff > 0) changes.push(`+${workflowDiff} workflows`);

  return changes.length > 0 ? changes.join(", ") : "Profile refinement";
}

function buildUserAnalysisContext(prompts: any[], existingProfile: UserProfileRow | null): string {
  const existingProfileSection = existingProfile
    ? `
## Existing User Profile

${existingProfile.profileData}

**Instructions**: Merge new insights with the existing profile. Update confidence scores for reinforced patterns, add new patterns, and refine existing ones.`
    : `
**Instructions**: Create a new user profile from scratch based on the prompts below.`;

  return `# User Profile Analysis

Analyze ${prompts.length} user prompts to ${existingProfile ? "update" : "create"} the user profile.

${existingProfileSection}

## Recent Prompts

${prompts.map((p, i) => `${i + 1}. ${p.content}`).join("\n\n")}

## Analysis Guidelines

Identify and ${existingProfile ? "update" : "create"}:

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

${existingProfile ? "Merge with existing profile, incrementing frequencies and updating confidence scores." : "Create initial profile with conservative confidence scores."}`;
}

async function analyzeUserProfile(
  context: string,
  existingProfile: UserProfileRow | null
): Promise<UserProfileData | null> {
  if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
    const { isProviderConnected, getV2Client, generateStructuredOutput } =
      await import("./ai/opencode-provider.js");

    if (!isProviderConnected(CONFIG.opencodeProvider)) {
      throw new Error(
        `opencode provider '${CONFIG.opencodeProvider}' is not connected. Check your opencode provider configuration.`
      );
    }

    const v2Client = getV2Client();
    if (!v2Client) {
      throw new Error(
        "opencode-memnet: v2 client not initialized; cannot perform user-profile learning"
      );
    }

    const systemPrompt = `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

Use the update_user_profile tool to save the ${existingProfile ? "updated" : "new"} profile.`;

    const { z } = await import("zod");
    const schema = z.object({
      preferences: z.array(
        z.object({
          category: z.string(),
          description: z.string(),
          confidence: z.number(),
          evidence: z.array(z.string()),
        })
      ),
      patterns: z.array(
        z.object({
          category: z.string(),
          description: z.string(),
        })
      ),
      workflows: z.array(
        z.object({
          description: z.string(),
          steps: z.array(z.string()),
        })
      ),
    });

    const result = await generateStructuredOutput({
      client: v2Client,
      providerID: CONFIG.opencodeProvider,
      modelID: CONFIG.opencodeModel,
      systemPrompt,
      userPrompt: context,
      schema,
    });

    if (existingProfile) {
      const existingData: UserProfileData = JSON.parse(existingProfile.profileData);
      return profileRepo.mergeProfileData(
        existingData,
        result as unknown as Partial<UserProfileData>
      );
    }
    return result as UserProfileData;
  }

  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    log("User Profile Config Check Failed:", {
      memoryModel: CONFIG.memoryModel,
      memoryApiUrl: CONFIG.memoryApiUrl,
      memoryApiKey: CONFIG.memoryApiKey,
    });
    throw new Error("External API not configured for user memory learning");
  }

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);

  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

  const systemPrompt = `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

Use the update_user_profile tool to save the ${existingProfile ? "updated" : "new"} profile.`;

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "update_user_profile",
      description: existingProfile
        ? "Update existing user profile with new insights"
        : "Create new user profile",
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

  const result = await provider.executeToolCall(
    systemPrompt,
    context,
    toolSchema,
    `user-profile-${Date.now()}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to analyze user profile");
  }

  const rawData = result.data;

  if (existingProfile) {
    let existingData: UserProfileData;
    try {
      existingData = JSON.parse(existingProfile.profileData);
    } catch {
      log("Corrupt profile data, skipping", { profileId: existingProfile.id });
      return rawData as UserProfileData;
    }
    return profileRepo.mergeProfileData(existingData, rawData);
  }

  return rawData as UserProfileData;
}
