import { z } from "zod";

export const providerNameSchema = z.enum(["openai", "anthropic", "gemini", "mock"]);
export type ProviderName = z.infer<typeof providerNameSchema>;
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const taskSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  role: z.string().trim().min(1).max(80),
  capability: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(100_000),
  dependencies: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  preferredProvider: providerNameSchema.optional(),
  preferredModel: z.string().trim().min(1).max(120).optional(),
  difficulty: z.union([difficultySchema, z.literal("auto")]).optional(),
  maxOutputTokens: z.number().int().min(1).max(32_000).default(1_000),
});
export type TaskDefinition = z.infer<typeof taskSchema>;

export const limitsSchema = z.object({
  maxWorkers: z.number().int().min(1).max(32).default(3),
  maxRetries: z.number().int().min(0).max(10).default(2),
  maxBudgetUsd: z.number().positive().max(10_000).default(1),
});
export type RunLimits = z.infer<typeof limitsSchema>;

export const runRequestSchema = z.object({
  goal: z.string().trim().min(1).max(10_000),
  tasks: z.array(taskSchema).min(1).max(200).optional(),
  limits: limitsSchema.default({ maxWorkers: 3, maxRetries: 2, maxBudgetUsd: 1 }),
}).transform((request) => ({
  ...request,
  tasks: request.tasks ?? [{
    id: "main",
    role: "general",
    capability: "reasoning",
    prompt: request.goal,
    dependencies: [],
    maxOutputTokens: 1_000,
  }],
}));
export type RunRequest = z.infer<typeof runRequestSchema>;

export const modelSchema = z.object({
  provider: providerNameSchema,
  model: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  inputUsdPerMillionTokens: z.number().nonnegative(),
  outputUsdPerMillionTokens: z.number().nonnegative(),
  priority: z.number().int().default(0),
  tier: z.enum(["fast", "balanced", "advanced"]).optional(),
});
export type ModelDefinition = z.infer<typeof modelSchema>;

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";
export type TaskState = {
  id: string;
  status: TaskStatus;
  attempts: number;
  provider?: ProviderName;
  model?: string;
  output?: string;
  error?: string;
  routeHistory?: Array<{ provider: ProviderName; model: string; error: string }>;
  difficulty?: Difficulty;
  costUsd: number;
};

export type RunResult = {
  runId: string;
  goal: string;
  status: "succeeded" | "failed";
  spentUsd: number;
  tasks: TaskState[];
};

export type RunEvent =
  | { type: "run_started"; runId: string; goal: string; tasks: TaskState[] }
  | { type: "task_updated"; runId: string; task: TaskState }
  | { type: "run_finished"; runId: string; status: RunResult["status"]; spentUsd: number };
