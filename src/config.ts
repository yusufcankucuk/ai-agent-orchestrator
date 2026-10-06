import { z } from "zod";
import { resolve } from "node:path";
import type { ModelDefinition, ProviderName } from "./schemas.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(180_000),
  SUBSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(0),
  PROJECT_WORKSPACE: z.string().trim().min(1).default("work/project"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const apiKeys = new Map<ProviderName, string>();
  if (parsed.OPENAI_API_KEY) apiKeys.set("openai", parsed.OPENAI_API_KEY);
  if (parsed.ANTHROPIC_API_KEY) apiKeys.set("anthropic", parsed.ANTHROPIC_API_KEY);
  if (parsed.GEMINI_API_KEY) apiKeys.set("gemini", parsed.GEMINI_API_KEY);
  return {
    apiKeys,
    port: parsed.PORT,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    subscriptionTimeoutMs: parsed.SUBSCRIPTION_TIMEOUT_MS,
    workspaceDirectory: resolve(parsed.PROJECT_WORKSPACE),
  };
}

export const defaultModels: ModelDefinition[] = [
  { provider: "openai", model: "gpt-5.6-luna", roles: ["general", "coding", "review"], capabilities: ["reasoning", "code", "analysis"], inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.2, priority: 30, tier: "advanced" },
  { provider: "anthropic", model: "claude-sonnet-4-6", roles: ["general", "architecture", "review"], capabilities: ["reasoning", "code", "analysis"], inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15, priority: 20, tier: "advanced" },
  { provider: "gemini", model: "gemini-2.5-flash", roles: ["general", "research", "summarization"], capabilities: ["reasoning", "analysis", "long-context"], inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 2.5, priority: 25, tier: "fast" },
  { provider: "mock", model: "mock-1", roles: ["*"], capabilities: ["*"], inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, priority: -100, tier: "balanced" },
];

export const chatGptSubscriptionModel: ModelDefinition = {
  provider: "openai",
  model: "chatgpt-plan",
  roles: ["general", "coding"],
  capabilities: ["reasoning", "code", "analysis", "long-context"],
  inputUsdPerMillionTokens: 0,
  outputUsdPerMillionTokens: 0,
  priority: 80,
  tier: "advanced",
};

export const claudeSubscriptionModel: ModelDefinition = {
  provider: "anthropic",
  model: "sonnet",
  roles: ["architecture", "review"],
  capabilities: ["reasoning", "code", "analysis"],
  inputUsdPerMillionTokens: 0,
  outputUsdPerMillionTokens: 0,
  priority: 90,
  tier: "advanced",
};

export const antigravitySubscriptionModel: ModelDefinition = {
  provider: "gemini",
  model: "gemini-3.8-flash-high",
  roles: ["general", "research", "summarization", "coding", "architecture"],
  capabilities: ["reasoning", "analysis", "long-context", "code"],
  inputUsdPerMillionTokens: 0,
  outputUsdPerMillionTokens: 0,
  priority: 90,
  tier: "fast",
};
