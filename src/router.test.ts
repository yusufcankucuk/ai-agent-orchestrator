import { describe, expect, it } from "vitest";
import { antigravitySubscriptionModel, chatGptSubscriptionModel } from "./config.js";
import { MockProvider } from "./providers.js";
import { ModelRouter } from "./router.js";
import type { ModelDefinition, TaskDefinition } from "./schemas.js";

const task: TaskDefinition = { id: "t", role: "coding", capability: "code", prompt: "x", dependencies: [], maxOutputTokens: 10 };
const models: ModelDefinition[] = [
  { provider: "mock", model: "fallback", roles: ["*"], capabilities: ["*"], inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, priority: 0 },
  { provider: "mock", model: "specialist", roles: ["coding"], capabilities: ["code"], inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, priority: 0 },
];

describe("ModelRouter", () => {
  it("prefers exact role and capability matches", () => {
    const route = new ModelRouter(models, new Map([["mock", new MockProvider()]])).route(task);
    expect(route.definition.model).toBe("specialist");
  });

  it("returns capability-compatible fallback routes in score order", () => {
    const candidates: ModelDefinition[] = [
      { provider: "openai", model: "coder", roles: ["coding"], capabilities: ["code"], inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, priority: 10 },
      { provider: "gemini", model: "backup", roles: ["research"], capabilities: ["code"], inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, priority: 20 },
    ];
    const providers = new Map(["openai", "gemini"].map((name) => [name, new MockProvider()]));
    expect(new ModelRouter(candidates, providers).routes(task).map((route) => route.definition.model)).toEqual(["coder", "backup"]);
  });

  it("routes coding work to Gemini before GPT", () => {
    const providers = new Map(["openai", "gemini"].map((name) => [name, new MockProvider()]));
    expect(new ModelRouter([chatGptSubscriptionModel, antigravitySubscriptionModel], providers)
      .routes(task).map((route) => route.definition.provider)).toEqual(["gemini", "openai"]);
  });

  it("uses Gemini for easy work and GPT for hard work", () => {
    const providers = new Map(["openai", "gemini"].map((name) => [name, new MockProvider()]));
    const router = new ModelRouter([chatGptSubscriptionModel, antigravitySubscriptionModel], providers);
    expect(router.route({ ...task, difficulty: "easy" }).definition.provider).toBe("gemini");
    expect(router.route({ ...task, difficulty: "hard" }).definition.provider).toBe("openai");
  });

  it("honors explicit model preferences", () => {
    const route = new ModelRouter(models, new Map([["mock", new MockProvider()]])).route({ ...task, preferredModel: "fallback" });
    expect(route.definition.model).toBe("fallback");
  });

  it("honors explicit provider preferences", () => {
    const route = new ModelRouter(models, new Map([["mock", new MockProvider()]])).route({ ...task, preferredProvider: "mock" });
    expect(route.definition.provider).toBe("mock");
  });

  it("does not escape an explicit model preference", () => {
    expect(new ModelRouter(models, new Map([["mock", new MockProvider()]])).routes({ ...task, preferredModel: "specialist" })).toHaveLength(1);
  });

  it("fails when no provider is available", () => {
    expect(() => new ModelRouter(models, new Map()).route(task)).toThrow("No model available");
  });
});
