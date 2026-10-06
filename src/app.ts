import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { antigravitySubscriptionModel, chatGptSubscriptionModel, claudeSubscriptionModel, defaultModels, type AppConfig } from "./config.js";
import { MasterOrchestrator } from "./orchestrator.js";
import { AnthropicProvider, AntigravitySubscriptionProvider, ClaudeSubscriptionProvider, CodexSubscriptionProvider, GeminiProvider, MockProvider, OpenAIProvider, type ModelProvider } from "./providers.js";

export function createOrchestrator(config: AppConfig): MasterOrchestrator {
  const providers = new Map<string, ModelProvider>();
  let models = defaultModels;
  providers.set("mock", new MockProvider());
  const openaiKey = config.apiKeys.get("openai");
  const anthropicKey = config.apiKeys.get("anthropic");
  const geminiKey = config.apiKeys.get("gemini");
  let disableClaudeCli = false;
  if (openaiKey) {
    providers.set("openai", new OpenAIProvider(openaiKey, config.requestTimeoutMs));
  } else {
    const command = findExecutable(process.env.CODEX_CLI_PATH || "codex");
    if (command) {
      providers.set("openai", new CodexSubscriptionProvider(command, config.subscriptionTimeoutMs, config.workspaceDirectory));
      models = [chatGptSubscriptionModel, ...models.filter((model) => model.provider !== "openai")];
    }
  }
  if (anthropicKey) {
    providers.set("anthropic", new AnthropicProvider(anthropicKey, config.requestTimeoutMs));
  } else {
    const command = findExecutable(process.env.CLAUDE_CLI_PATH || "claude");
    if (command) {
      providers.set("anthropic", new ClaudeSubscriptionProvider(command, config.subscriptionTimeoutMs, config.workspaceDirectory));
      models = [claudeSubscriptionModel, ...models.filter((model) => model.provider !== "anthropic")];
      disableClaudeCli = true;
    }
  }
  if (geminiKey) {
    providers.set("gemini", new GeminiProvider(geminiKey, config.requestTimeoutMs));
  } else {
    const command = findExecutable(process.env.ANTIGRAVITY_CLI_PATH || (process.env.HOME ? join(process.env.HOME, ".local", "bin", "agy") : "agy"));
    if (command) {
      providers.set("gemini", new AntigravitySubscriptionProvider(command, config.subscriptionTimeoutMs, config.workspaceDirectory));
      models = [antigravitySubscriptionModel, ...models.filter((model) => model.provider !== "gemini")];
    }
  }
  const orchestrator = new MasterOrchestrator(models, providers, undefined, undefined, config.workspaceDirectory);
  if (disableClaudeCli) orchestrator.setProviderEnabled("anthropic", false);
  return orchestrator;
}

function findExecutable(command: string): string | undefined {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep searching */ }
  }
  return undefined;
}
