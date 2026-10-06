import type { RunResult, TaskState } from "./schemas.js";

export interface RunStore {
  create(run: RunResult): Promise<void>;
  updateTask(runId: string, task: TaskState): Promise<void>;
  finish(runId: string, status: RunResult["status"], spentUsd: number): Promise<void>;
  get(runId: string): Promise<RunResult | undefined>;
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunResult>();

  async create(run: RunResult): Promise<void> { this.runs.set(run.runId, structuredClone(run)); }
  async updateTask(runId: string, task: TaskState): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const index = run.tasks.findIndex((item) => item.id === task.id);
    if (index < 0) throw new Error(`Unknown task ${task.id}`);
    run.tasks[index] = structuredClone(task);
  }
  async finish(runId: string, status: RunResult["status"], spentUsd: number): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    run.status = status;
    run.spentUsd = spentUsd;
  }
  async get(runId: string): Promise<RunResult | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }
}
