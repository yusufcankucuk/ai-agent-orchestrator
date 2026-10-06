import { describe, expect, it } from "vitest";
import { createAgentRun, createProjectRun } from "./project.js";

describe("createProjectRun", () => {
  it("turns one prompt into a validated five-stage DAG", () => {
    const run = createProjectRun("Build a notes app", { maxWorkers: 2, maxRetries: 1, maxBudgetUsd: 0.5 });
    expect(run.tasks.map((task) => task.id)).toEqual(["plan", "research", "build", "review", "final"]);
    expect(run.tasks.at(-1)?.dependencies).toEqual(["review"]);
    expect(run.tasks.at(-1)?.prompt).toContain("files changed");
    expect(run.tasks.at(-1)?.prompt).toContain("checks and their results");
    expect(run.tasks[0]?.prompt).toContain("Build a notes app");
  });

  it("rejects unsafe limits", () => {
    expect(() => createProjectRun("x", { maxWorkers: 1000, maxRetries: 1, maxBudgetUsd: 1 })).toThrow();
  });
});

describe("createAgentRun", () => {
  it("creates one provider-neutral task with bounded conversation context", () => {
    const run = createAgentRun("Start the project", [{ role: "user", content: "Use port 4000" }], {
      maxWorkers: 1,
      maxRetries: 1,
      maxBudgetUsd: 0.5,
    });
    expect(run.tasks).toHaveLength(1);
    expect(run.tasks[0]).toMatchObject({ id: "agent", difficulty: "medium", dependencies: [] });
    expect(run.tasks[0]?.preferredProvider).toBeUndefined();
    expect(run.tasks[0]?.prompt).toContain("Use port 4000");
  });
});
