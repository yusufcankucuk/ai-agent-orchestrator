#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createOrchestrator } from "./app.js";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const command = process.argv[2] ?? "demo";
const config = loadConfig();
const orchestrator = createOrchestrator(config);

if (command === "serve") {
  await startHttpServer(orchestrator, config.port);
  console.log(`Orchestra UI: http://127.0.0.1:${config.port}`);
} else if (command === "run") {
  const path = process.argv[3];
  if (!path) throw new Error("Usage: npm run dev -- run request.json");
  console.log(JSON.stringify(await orchestrator.run(JSON.parse(await readFile(path, "utf8"))), null, 2));
} else if (command === "demo") {
  console.log(JSON.stringify(await orchestrator.run({
    goal: "Plan, implement and review a tiny greeting feature",
    limits: { maxWorkers: 2, maxRetries: 1, maxBudgetUsd: 0.1 },
    tasks: [
      { id: "plan", role: "architecture", capability: "reasoning", prompt: "Create a short implementation plan." },
      { id: "code", role: "coding", capability: "code", prompt: "Write the core implementation.", dependencies: ["plan"] },
      { id: "review", role: "review", capability: "analysis", prompt: "Review the implementation.", dependencies: ["code"] },
    ],
  }), null, 2));
} else {
  throw new Error("Commands: demo | run <request.json> | serve");
}
