import type { ModelProvider } from "./providers.js";
import type { ModelDefinition, TaskDefinition } from "./schemas.js";

export type Route = { definition: ModelDefinition; provider: ModelProvider };

export class ModelRouter {
  constructor(private readonly models: ModelDefinition[], private readonly providers: Map<string, ModelProvider>) {}

  route(task: TaskDefinition): Route {
    return this.routes(task)[0]!;
  }

  routes(task: TaskDefinition): Route[] {
    const available = this.models
      .filter((model) => this.providers.has(model.provider))
      .filter((model) => !task.preferredProvider || model.provider === task.preferredProvider)
      .filter((model) => !task.preferredModel || model.model === task.preferredModel);
    const matching = available
      .filter((model) => matchesRole(model, task) || matchesCapability(model, task))
      .sort((a, b) => score(b, task) - score(a, task));
    const real = matching.filter((model) => model.provider !== "mock");
    const candidates = real.length ? real : matching;
    if (!candidates.length) throw new Error(`No model available for role=${task.role}, capability=${task.capability}`);
    return candidates.map((definition) => ({ definition, provider: this.providers.get(definition.provider)! }));
  }
}

function score(model: ModelDefinition, task: TaskDefinition): number {
  return model.priority
    + (model.roles.includes(task.role) ? 30 : 0)
    + (model.capabilities.includes(task.capability) ? 20 : 0)
    + difficultyScore(model.tier ?? "balanced", task.difficulty);
}

function difficultyScore(tier: NonNullable<ModelDefinition["tier"]>, difficulty: TaskDefinition["difficulty"]): number {
  if (!difficulty || difficulty === "auto") return 0;
  const scores = {
    easy: { fast: 80, balanced: 35, advanced: 0 },
    medium: { fast: 10, balanced: 60, advanced: 30 },
    hard: { fast: 0, balanced: 25, advanced: 80 },
  } as const;
  return scores[difficulty][tier];
}

function matchesRole(model: ModelDefinition, task: TaskDefinition): boolean {
  return model.roles.includes("*") || model.roles.includes(task.role);
}

function matchesCapability(model: ModelDefinition, task: TaskDefinition): boolean {
  return model.capabilities.includes("*") || model.capabilities.includes(task.capability);
}
