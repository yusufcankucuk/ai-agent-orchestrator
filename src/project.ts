import { limitsSchema, type RunLimits, type RunRequest } from "./schemas.js";

export function createProjectRun(goal: string, limits: unknown): RunRequest {
  const safeLimits = limitsSchema.parse(limits);
  return {
    goal,
    limits: safeLimits,
    tasks: [
      {
        id: "plan",
        role: "architecture",
        capability: "reasoning",
        prompt: `Inspect the current project workspace and create a concrete execution plan. State assumptions and acceptance criteria. Classify the whole request as easy, medium, or hard based on scope, risk, and reasoning depth. End with exactly one line in this format: DIFFICULTY: easy|medium|hard\n\nProject:\n${goal}`,
        dependencies: [],
        maxOutputTokens: 1_200,
        difficulty: "easy",
      },
      {
        id: "research",
        role: "research",
        capability: "analysis",
        prompt: "Inspect the current project files. Research the constraints and identify useful approaches, risks, and trade-offs for the implementation worker.",
        dependencies: ["plan"],
        maxOutputTokens: 1_200,
        difficulty: "auto",
      },
      {
        id: "build",
        role: "coding",
        capability: "code",
        prompt: "Implement the request directly in the current project workspace using the plan and research. Create, edit, or delete files as needed and run relevant checks. Do not merely print code for the user to save.",
        dependencies: ["plan", "research"],
        maxOutputTokens: 2_000,
        difficulty: "auto",
      },
      {
        id: "review",
        role: "review",
        capability: "analysis",
        prompt: "Inspect the files produced in the current project workspace and review them for correctness, security, missing requirements, and practical improvements.",
        dependencies: ["build"],
        maxOutputTokens: 1_200,
        difficulty: "auto",
      },
      {
        id: "final",
        role: "general",
        capability: "reasoning",
        prompt: "Inspect the current workspace, apply every necessary fix identified in review directly to the files, and run relevant checks. Finish with a concise user-facing summary in the user's language covering: completed work, files changed, checks and their results, and any remaining issue. Do not output raw code for the user to save manually.",
        dependencies: ["review"],
        maxOutputTokens: 2_000,
        difficulty: "auto",
      },
    ],
  };
}

export function createAgentRun(
  goal: string,
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
  limits: unknown,
): RunRequest {
  const safeLimits = limitsSchema.parse(limits);
  const context = conversation.length
    ? `Conversation so far:\n${JSON.stringify(conversation)}\n\nCurrent request:\n${goal}`
    : `Current request:\n${goal}`;
  return {
    goal,
    limits: safeLimits,
    tasks: [{
      id: "agent",
      role: "general",
      capability: "reasoning",
      prompt: `Continue as the user's project agent. Use the conversation for context and act directly in the current workspace when needed. Do not start a multi-agent planning cycle.\n\n${context}`,
      dependencies: [],
      maxOutputTokens: 2_000,
      difficulty: "medium",
    }],
  };
}
