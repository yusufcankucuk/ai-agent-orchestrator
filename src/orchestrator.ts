import { randomUUID } from "node:crypto";
import type { ModelProvider } from "./providers.js";
import { InMemoryTaskQueue, type TaskQueue } from "./queue.js";
import { ModelRouter, type Route } from "./router.js";
import { runRequestSchema, type Difficulty, type ModelDefinition, type RunEvent, type RunResult, type TaskDefinition, type TaskState } from "./schemas.js";
import { InMemoryRunStore, type RunStore } from "./store.js";

export class MasterOrchestrator {
  private readonly router: ModelRouter;
  private readonly activeWorkers = new Map<string, AbortController>();
  private readonly providerPool: Map<string, ModelProvider>;
  private readonly activeProviders: Map<string, ModelProvider>;

  constructor(
    private readonly models: ModelDefinition[],
    providers: Map<string, ModelProvider>,
    private readonly store: RunStore = new InMemoryRunStore(),
    private readonly queue: TaskQueue = new InMemoryTaskQueue(),
    private workspaceDirectory = "",
  ) {
    this.providerPool = new Map(providers);
    this.activeProviders = new Map(providers);
    this.router = new ModelRouter(models, this.activeProviders);
  }

  getWorkspaceDirectory(): string { return this.workspaceDirectory; }

  setWorkspaceDirectory(directory: string): void {
    if (this.activeWorkers.size) throw new Error("Çalışan görev varken proje klasörü değiştirilemez");
    this.workspaceDirectory = directory;
    for (const provider of this.providerPool.values()) provider.setWorkspaceDirectory?.(directory);
  }

  getProviderStatuses() {
    return (["openai", "anthropic", "gemini"] as const).map((provider) => ({
      provider,
      available: this.providerPool.has(provider),
      enabled: this.activeProviders.has(provider),
      models: this.models.filter((model) => model.provider === provider).map((model) => model.model),
    }));
  }

  async getUsageStatuses() {
    return Promise.all([...this.activeProviders.entries()]
      .filter(([provider]) => provider !== "mock")
      .map(async ([provider, implementation]) => {
        if (!implementation.readUsage) return { provider, groups: [], error: "Bu bağlantı sayısal kota bilgisi sunmuyor" };
        try {
          return { provider, groups: await implementation.readUsage() };
        } catch {
          return { provider, groups: [], error: "Kalan kullanım bilgisi alınamadı" };
        }
      }));
  }

  setProviderEnabled(provider: "openai" | "anthropic" | "gemini", enabled: boolean): void {
    const implementation = this.providerPool.get(provider);
    if (!implementation) throw new Error(`${provider} CLI is not available`);
    if (enabled) this.activeProviders.set(provider, implementation);
    else this.activeProviders.delete(provider);
  }

  async run(input: unknown, onEvent?: (event: RunEvent) => void): Promise<RunResult> {
    const request = runRequestSchema.parse(input);
    validateDag(request.tasks);
    const runId = randomUUID();
    const states = new Map(request.tasks.map((task) => [task.id, initialState(task.id)]));
    await this.store.create({ runId, goal: request.goal, status: "failed", spentUsd: 0, tasks: [...states.values()] });
    onEvent?.({ type: "run_started", runId, goal: request.goal, tasks: [...states.values()].map(copyState) });

    const pending = new Map(request.tasks.map((task) => [task.id, task]));
    const running = new Map<string, Promise<void>>();
    let runDifficulty: Difficulty = "medium";
    let spentUsd = 0;
    let reservedUsd = 0;

    while (pending.size || running.size) {
      for (const [id, task] of pending) {
        const dependencies = task.dependencies.map((dependency) => states.get(dependency)!);
        if (dependencies.some((state) => state.status === "failed" || state.status === "blocked")) {
          const state = states.get(id)!;
          Object.assign(state, { status: "blocked", error: "Dependency failed" });
          await this.store.updateTask(runId, state);
          onEvent?.({ type: "task_updated", runId, task: copyState(state) });
          pending.delete(id);
          continue;
        }
        if (running.size >= request.limits.maxWorkers || !dependencies.every((state) => state.status === "succeeded")) continue;

        const routedTask = task.difficulty === "auto" ? { ...task, difficulty: runDifficulty } : task;
        const state = states.get(id)!;
        if (routedTask.difficulty && routedTask.difficulty !== "auto") state.difficulty = routedTask.difficulty;
        let routesForTask;
        try { routesForTask = this.router.routes(routedTask); }
        catch (error) {
          Object.assign(state, { status: "failed", error: errorMessage(error) });
          await this.store.updateTask(runId, state);
          onEvent?.({ type: "task_updated", runId, task: copyState(state) });
          pending.delete(id);
          continue;
        }
        const prompt = composePrompt(request.goal, routedTask, states);
        const reservation = Math.max(...routesForTask.map((route) => maximumCost(prompt, routedTask.maxOutputTokens, route.definition)));
        if (spentUsd + reservedUsd + reservation > request.limits.maxBudgetUsd) {
          const state = states.get(id)!;
          Object.assign(state, { status: "failed", error: "Hard budget limit would be exceeded" });
          await this.store.updateTask(runId, state);
          onEvent?.({ type: "task_updated", runId, task: copyState(state) });
          pending.delete(id);
          continue;
        }

        pending.delete(id);
        reservedUsd += reservation;
        const worker = this.executeTask(runId, request.limits.maxRetries, routedTask, prompt, state, routesForTask, onEvent)
          .then(async (actualCost) => {
            spentUsd += actualCost;
            if (task.id === "plan" && state.output) {
              runDifficulty = detectDifficulty(state.output);
              state.difficulty = runDifficulty;
              await this.store.updateTask(runId, state);
              onEvent?.({ type: "task_updated", runId, task: copyState(state) });
            }
          })
          .finally(() => { reservedUsd -= reservation; running.delete(id); });
        running.set(id, worker);
      }

      if (running.size) await Promise.race(running.values());
      else if (pending.size) throw new Error("DAG scheduler made no progress");
    }

    const status = [...states.values()].every((state) => state.status === "succeeded") ? "succeeded" : "failed";
    await this.store.finish(runId, status, spentUsd);
    onEvent?.({ type: "run_finished", runId, status, spentUsd });
    return (await this.store.get(runId))!;
  }

  terminateWorker(taskId: string): boolean {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return false;
    worker.abort(new Error("Worker terminated"));
    return true;
  }

  terminateAllWorkers(): number {
    const workers = [...this.activeWorkers.values()];
    for (const worker of workers) worker.abort(new Error("Kullanıcı işlemi durdurdu"));
    return workers.length;
  }

  private async executeTask(
    runId: string,
    maxRetries: number,
    task: TaskDefinition,
    prompt: string,
    state: TaskState,
    routes: Route[],
    onEvent?: (event: RunEvent) => void,
  ): Promise<number> {
    const controller = new AbortController();
    this.activeWorkers.set(task.id, controller);
    try {
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const route = routes[Math.min(attempt - 1, routes.length - 1)]!;
        state.attempts = attempt;
        Object.assign(state, { status: "running", provider: route.definition.provider, model: route.definition.model, error: undefined });
        await this.store.updateTask(runId, state);
        onEvent?.({ type: "task_updated", runId, task: copyState(state) });
        try {
          const response = await this.queue.submit(() => route.provider.generate({
            model: route.definition.model,
            prompt,
            maxOutputTokens: task.maxOutputTokens,
            signal: controller.signal,
            allowWorkspaceWrites: task.capability === "code" || task.role === "general",
          }));
          if (!response.text.trim()) throw new Error("Provider returned empty output");
          const cost = actualCost(response.inputTokens, response.outputTokens, route.definition);
          Object.assign(state, { status: "succeeded", output: response.text, costUsd: cost, error: undefined });
          await this.store.updateTask(runId, state);
          onEvent?.({ type: "task_updated", runId, task: copyState(state) });
          return cost;
        } catch (error) {
          state.routeHistory = [...(state.routeHistory ?? []), {
            provider: route.definition.provider,
            model: route.definition.model,
            error: errorMessage(error).slice(0, 500),
          }];
          if (attempt > maxRetries || controller.signal.aborted) throw error;
        }
      }
      throw new Error("Retry loop exhausted");
    } catch (error) {
      Object.assign(state, { status: "failed", error: errorMessage(error) });
      await this.store.updateTask(runId, state);
      onEvent?.({ type: "task_updated", runId, task: copyState(state) });
      return 0;
    } finally {
      this.activeWorkers.delete(task.id);
    }
  }
}

function initialState(id: string): TaskState { return { id, status: "pending", attempts: 0, costUsd: 0 }; }

function copyState(state: TaskState): TaskState { return { ...state }; }

function composePrompt(goal: string, task: TaskDefinition, states: Map<string, TaskState>): string {
  const instruction = `Overall goal:\n${goal}\n\nCurrent task:\n${task.prompt}`;
  if (!task.dependencies.length) return instruction;
  const context = task.dependencies.map((id) => `${id}: ${states.get(id)?.output ?? "completed"}`).join("\n");
  return `${instruction}\n\nCompleted dependencies:\n${context}`;
}

function maximumCost(prompt: string, maxOutputTokens: number, model: ModelDefinition): number {
  // UTF-8 bytes are a conservative upper bound for token count for supported APIs.
  const maximumInputTokens = Buffer.byteLength(prompt, "utf8");
  return actualCost(maximumInputTokens, maxOutputTokens, model);
}

function actualCost(inputTokens: number, outputTokens: number, model: ModelDefinition): number {
  return (inputTokens * model.inputUsdPerMillionTokens + outputTokens * model.outputUsdPerMillionTokens) / 1_000_000;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Unknown error"; }

export function detectDifficulty(planOutput: string): Difficulty {
  const match = planOutput.match(/(?:^|\n)\s*(?:DIFFICULTY|ZORLUK)\s*:\s*(easy|medium|hard|basit|orta|zor)\b/i)?.[1]?.toLowerCase();
  if (match === "easy" || match === "basit") return "easy";
  if (match === "hard" || match === "zor") return "hard";
  return "medium";
}

export function validateDag(tasks: TaskDefinition[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("Task ids must be unique");
  for (const task of tasks) for (const dependency of task.dependencies) {
    if (!ids.has(dependency)) throw new Error(`Task ${task.id} has unknown dependency ${dependency}`);
    if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Task graph contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}
