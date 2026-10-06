import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { MasterOrchestrator } from "./orchestrator.js";
import { createAgentRun, createProjectRun } from "./project.js";

const MAX_BODY_BYTES = 1_000_000;
const execFileAsync = promisify(execFile);
const guiRequestSchema = z.object({
  goal: z.string().trim().min(1).max(10_000),
  limits: z.unknown(),
});
const providerToggleSchema = z.object({ enabled: z.boolean() }).strict();
const conversationSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(10_000),
}).strict()).max(20).default([]);
const agentRequestSchema = guiRequestSchema.extend({ conversation: conversationSchema }).strict();
const workspaceSchema = z.object({ path: z.string().trim().min(1).max(4_096) }).strict();
const staticFiles = new Map([
  ["/", { path: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { path: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { path: "app.js", type: "text/javascript; charset=utf-8" }],
]);

export function startHttpServer(orchestrator: MasterOrchestrator, port: number) {
  const server = createServer(async (request, response) => {
    try {
      const staticPath = request.url ? new URL(request.url, "http://127.0.0.1").pathname : "";
      const staticFile = request.method === "GET" ? staticFiles.get(staticPath) : undefined;
      if (staticFile) return file(response, staticFile.path, staticFile.type);
      if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true });
      if (request.method === "GET" && request.url === "/providers") {
        return json(response, 200, { providers: orchestrator.getProviderStatuses() });
      }
      if (request.method === "GET" && request.url === "/usage") {
        return json(response, 200, { providers: await orchestrator.getUsageStatuses(), updatedAt: new Date().toISOString() });
      }
      if (request.method === "GET" && request.url === "/workspace") {
        return json(response, 200, { path: orchestrator.getWorkspaceDirectory() });
      }
      if (request.method === "POST" && request.url === "/workspace") {
        const input = workspaceSchema.parse(await readJson(request));
        const path = await existingProjectDirectory(input.path);
        orchestrator.setWorkspaceDirectory(path);
        return json(response, 200, { path });
      }
      if (request.method === "POST" && request.url === "/workspace/pick") {
        const path = await pickProjectDirectory();
        orchestrator.setWorkspaceDirectory(path);
        return json(response, 200, { path });
      }
      if (request.method === "POST" && request.url === "/cancel") {
        return json(response, 200, { cancelled: orchestrator.terminateAllWorkers() });
      }
      const providerMatch = request.url?.match(/^\/providers\/(openai|anthropic|gemini)$/);
      if (request.method === "POST" && providerMatch) {
        const input = providerToggleSchema.parse(await readJson(request));
        const provider = providerMatch[1] as "openai" | "anthropic" | "gemini";
        orchestrator.setProviderEnabled(provider, input.enabled);
        return json(response, 200, { providers: orchestrator.getProviderStatuses() });
      }
      if (request.method === "POST" && request.url === "/runs") {
        const body = await readJson(request);
        return json(response, 200, await orchestrator.run(body));
      }
      if (request.method === "POST" && request.url === "/project-runs") {
        const input = guiRequestSchema.parse(await readJson(request));
        return json(response, 200, await orchestrator.run(createProjectRun(input.goal, input.limits)));
      }
      if (request.method === "POST" && request.url === "/project-runs/stream") {
        const input = guiRequestSchema.parse(await readJson(request));
        response.writeHead(200, securityHeaders({ "content-type": "application/x-ndjson; charset=utf-8" }));
        const send = (value: unknown) => response.write(`${JSON.stringify(value)}\n`);
        const result = await orchestrator.run(createProjectRun(input.goal, input.limits), send);
        send({ type: "result", result });
        return response.end();
      }
      if (request.method === "POST" && request.url === "/agent-runs/stream") {
        const input = agentRequestSchema.parse(await readJson(request));
        response.writeHead(200, securityHeaders({ "content-type": "application/x-ndjson; charset=utf-8" }));
        const send = (value: unknown) => response.write(`${JSON.stringify(value)}\n`);
        const result = await orchestrator.run(createAgentRun(input.goal, input.conversation, input.limits), send);
        send({ type: "result", result });
        return response.end();
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return json(response, message === "Request body too large" ? 413 : 400, { error: message });
    }
  });
  return new Promise<typeof server>((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

async function existingProjectDirectory(input: string): Promise<string> {
  const path = await realpath(resolve(input));
  if (!(await stat(path)).isDirectory()) throw new Error("Seçilen yol bir klasör değil");
  if (path === parse(path).root || path === homedir()) throw new Error("Disk kökü veya ana klasör proje olarak seçilemez");
  return path;
}

async function pickProjectDirectory(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Klasör seçici yalnızca macOS üzerinde kullanılabilir");
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Proje klasörünü seç")',
    ], { timeout: 300_000, maxBuffer: 4_096 });
    return existingProjectDirectory(stdout.trim());
  } catch {
    throw new Error("Klasör seçimi iptal edildi");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(body));
}

async function file(response: ServerResponse, name: string, type: string): Promise<void> {
  const content = await readFile(resolve(process.cwd(), "public", name));
  response.writeHead(200, securityHeaders({ "content-type": type }));
  response.end(content);
}

function securityHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self' * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src *; img-src 'self' data:;",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}
