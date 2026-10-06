import { describe, expect, it } from "vitest";
import { detectDifficulty, MasterOrchestrator, validateDag } from "./orchestrator.js";
import type { GenerateRequest, GenerateResponse, ModelProvider } from "./providers.js";
import type { ModelDefinition, TaskDefinition } from "./schemas.js";

const model: ModelDefinition = {
  provider: "mock",
  model: "test-model",
  roles: ["*"],
  capabilities: ["*"],
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 1,
  priority: 0,
};

class RecordingProvider implements ModelProvider {
  readonly name = "mock" as const;
  calls: string[] = [];
  writePermissions: boolean[] = [];
  active = 0;
  peakActive = 0;
  failures = 0;

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request.prompt);
    this.writePermissions.push(request.allowWorkspaceWrites === true);
    this.active++;
    this.peakActive = Math.max(this.peakActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.active--;
    if (this.failures-- > 0) throw new Error("temporary failure");
    return { text: `done:${request.prompt}`, inputTokens: 10, outputTokens: 10 };
  }
}

class NamedProvider implements ModelProvider {
  constructor(readonly name: "openai" | "gemini", private readonly fail: boolean) {}
  calls = 0;
  async generate(): Promise<GenerateResponse> {
    this.calls++;
    if (this.fail) throw new Error(`${this.name} unavailable`);
    return { text: `${this.name} recovered`, inputTokens: 10, outputTokens: 10 };
  }
}

class BlockingProvider implements ModelProvider {
  readonly name = "mock" as const;
  started!: () => void;
  readonly ready = new Promise<void>((resolve) => { this.started = resolve; });
  generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.started();
    return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
  }
}

function orchestrator(provider: RecordingProvider) {
  return new MasterOrchestrator([model], new Map([["mock", provider]]));
}

describe("MasterOrchestrator", () => {
  it("runs a DAG in dependency order and passes dependency output", async () => {
    const provider = new RecordingProvider();
    const events: string[] = [];
    const result = await orchestrator(provider).run({
      goal: "test",
      tasks: [
        { id: "first", role: "any", capability: "any", prompt: "one" },
        { id: "second", role: "any", capability: "any", prompt: "two", dependencies: ["first"] },
      ],
    }, (event) => events.push(event.type));

    expect(result.status).toBe("succeeded");
    expect(provider.calls[0]).toContain("Overall goal:\ntest");
    expect(provider.calls[0]).toContain("Current task:\none");
    expect(provider.calls[1]).toContain("first: done:Overall goal:");
    expect(events).toContain("task_updated");
    expect(events.at(-1)).toBe("run_finished");
  });

  it("honors retry and worker limits", async () => {
    const provider = new RecordingProvider();
    provider.failures = 1;
    const result = await orchestrator(provider).run({
      goal: "test",
      limits: { maxWorkers: 1, maxRetries: 1, maxBudgetUsd: 1 },
      tasks: [
        { id: "a", role: "any", capability: "any", prompt: "a" },
        { id: "b", role: "any", capability: "any", prompt: "b" },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(provider.calls).toHaveLength(3);
    expect(provider.peakActive).toBe(1);
  });

  it("allows workspace writes only for coding and general tasks", async () => {
    const provider = new RecordingProvider();
    await orchestrator(provider).run({
      goal: "test",
      tasks: [
        { id: "research", role: "research", capability: "analysis", prompt: "inspect" },
        { id: "build", role: "coding", capability: "code", prompt: "write", dependencies: ["research"] },
        { id: "final", role: "general", capability: "reasoning", prompt: "finish", dependencies: ["build"] },
      ],
    });

    expect(provider.writePermissions).toEqual([false, true, true]);
  });

  it("refuses work whose reservation exceeds the hard budget", async () => {
    const provider = new RecordingProvider();
    const result = await orchestrator(provider).run({
      goal: "test",
      limits: { maxWorkers: 1, maxRetries: 0, maxBudgetUsd: 0.000001 },
      tasks: [{ id: "expensive", role: "any", capability: "any", prompt: "long prompt", maxOutputTokens: 100 }],
    });

    expect(result.status).toBe("failed");
    expect(result.tasks[0]?.error).toContain("budget");
    expect(provider.calls).toHaveLength(0);
  });

  it("blocks dependents after a permanent failure", async () => {
    const provider = new RecordingProvider();
    provider.failures = 2;
    const result = await orchestrator(provider).run({
      goal: "test",
      limits: { maxWorkers: 1, maxRetries: 0, maxBudgetUsd: 1 },
      tasks: [
        { id: "bad", role: "any", capability: "any", prompt: "bad" },
        { id: "child", role: "any", capability: "any", prompt: "child", dependencies: ["bad"] },
      ],
    });

    expect(result.tasks.map((task) => task.status)).toEqual(["failed", "blocked"]);
  });

  it("records an unavailable route as a task failure", async () => {
    const result = await new MasterOrchestrator([model], new Map()).run({ goal: "test" });
    expect(result.tasks[0]).toMatchObject({ status: "failed", attempts: 0 });
  });

  it("switches to the next compatible model after a runtime failure", async () => {
    const primary = new NamedProvider("openai", true);
    const fallback = new NamedProvider("gemini", false);
    const models: ModelDefinition[] = [
      { ...model, provider: "openai", model: "primary", roles: ["coding"], capabilities: ["code"], priority: 20 },
      { ...model, provider: "gemini", model: "fallback", roles: ["research"], capabilities: ["code"], priority: 10 },
    ];
    const result = await new MasterOrchestrator(models, new Map([["openai", primary], ["gemini", fallback]])).run({
      goal: "test",
      limits: { maxWorkers: 1, maxRetries: 1, maxBudgetUsd: 1 },
      tasks: [{ id: "adaptive", role: "coding", capability: "code", prompt: "build" }],
    });

    expect(result.tasks[0]).toMatchObject({ status: "succeeded", provider: "gemini", model: "fallback", attempts: 2 });
    expect(result.tasks[0]?.routeHistory).toEqual([{ provider: "openai", model: "primary", error: "openai unavailable" }]);
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
  });

  it("can disable and re-enable a provider at runtime", async () => {
    const openai = new NamedProvider("openai", false);
    const models: ModelDefinition[] = [{ ...model, provider: "openai", model: "primary" }];
    const instance = new MasterOrchestrator(models, new Map([["openai", openai]]));

    instance.setProviderEnabled("openai", false);
    expect(instance.getProviderStatuses().find((item) => item.provider === "openai")).toMatchObject({ available: true, enabled: false });
    await expect(instance.run({ goal: "disabled" })).resolves.toMatchObject({ status: "failed" });

    instance.setProviderEnabled("openai", true);
    await expect(instance.run({ goal: "enabled" })).resolves.toMatchObject({ status: "succeeded" });
  });

  it("cancels every active worker", async () => {
    const provider = new BlockingProvider();
    const instance = new MasterOrchestrator([model], new Map([["mock", provider]]));
    const run = instance.run({ goal: "wait" });

    await provider.ready;
    expect(instance.terminateAllWorkers()).toBe(1);
    await expect(run).resolves.toMatchObject({ status: "failed" });
  });
});

describe("validateDag", () => {
  const task = (id: string, dependencies: string[] = []): TaskDefinition => ({
    id, role: "any", capability: "any", prompt: id, dependencies, maxOutputTokens: 100,
  });

  it("rejects unknown dependencies", () => {
    expect(() => validateDag([task("a", ["missing"])] )).toThrow("unknown dependency");
  });

  it("rejects cycles", () => {
    expect(() => validateDag([task("a", ["b"]), task("b", ["a"])] )).toThrow("cycle");
  });

  it("rejects duplicate ids and self dependencies", () => {
    expect(() => validateDag([task("a"), task("a")])).toThrow("unique");
    expect(() => validateDag([task("a", ["a"])] )).toThrow("itself");
  });
});

describe("detectDifficulty", () => {
  it("reads the planner marker and safely defaults to medium", () => {
    expect(detectDifficulty("Plan\nDIFFICULTY: easy")).toBe("easy");
    expect(detectDifficulty("Plan\nZORLUK: zor")).toBe("hard");
    expect(detectDifficulty("Plan without a marker")).toBe("medium");
  });
});
