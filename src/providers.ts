import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderName } from "./schemas.js";
import { readAntigravityUsage, readCodexUsage, type UsageGroup } from "./usage.js";

export type GenerateRequest = {
  model: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
  allowWorkspaceWrites?: boolean;
};

export type GenerateResponse = { text: string; inputTokens: number; outputTokens: number };

export interface ModelProvider {
  readonly name: ProviderName;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  readUsage?(): Promise<UsageGroup[]>;
  setWorkspaceDirectory?(directory: string): void;
}

type JsonRecord = Record<string, unknown>;

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<JsonRecord> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, signal });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Provider returned invalid JSON");
  return body as JsonRecord;
}

export class MockProvider implements ModelProvider {
  readonly name = "mock" as const;
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const text = `[mock:${request.model}] ${request.prompt.slice(0, 500)}`;
    return { text, inputTokens: Math.ceil(request.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}

export class CodexSubscriptionProvider implements ModelProvider {
  readonly name = "openai" as const;
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private workspaceDirectory = resolve(process.cwd(), "work", "project"),
  ) {}

  setWorkspaceDirectory(directory: string): void { this.workspaceDirectory = directory; }

  readUsage(): Promise<UsageGroup[]> { return readCodexUsage(this.command); }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    mkdirSync(this.workspaceDirectory, { recursive: true });
    const prompt = [
      "Work directly in the current project workspace. Use normal coding tools, terminal commands, dependency managers, and read-only system/dependency inspection as needed. Create, edit, or delete persistent project files only inside the current workspace. Do not return code that the user must save manually. For a requested long-running development server, start it in the background and report its URL. Finish with a concise summary of completed actions and verification.",
      request.prompt,
    ].join("\n\n");
    const text = await runProcess(this.command, [
      "--approve-for-me", "exec",
      "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
      "--color", "never", "-C", this.workspaceDirectory, "-",
    ], prompt, request.signal, this.timeoutMs);
    return {
      text: text.trim(),
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}

export class ClaudeSubscriptionProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private workspaceDirectory = resolve(process.cwd(), "work", "project"),
  ) {}

  setWorkspaceDirectory(directory: string): void { this.workspaceDirectory = directory; }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    mkdirSync(this.workspaceDirectory, { recursive: true });
    const prompt = safeSubscriptionPrompt(request.prompt);
    const text = await runProcess(this.command, [
      "--print", "--output-format", "text", "--permission-mode", "plan",
      "--tools", "", "--no-session-persistence", "--safe-mode", "--model", request.model,
    ], prompt, request.signal, this.timeoutMs, this.workspaceDirectory);
    return estimatedResponse(prompt, text);
  }
}

export class AntigravitySubscriptionProvider implements ModelProvider {
  readonly name = "gemini" as const;
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private workspaceDirectory = resolve(process.cwd(), "work", "project"),
  ) {}

  setWorkspaceDirectory(directory: string): void { this.workspaceDirectory = directory; }

  readUsage(): Promise<UsageGroup[]> { return readAntigravityUsage(this.command); }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    mkdirSync(this.workspaceDirectory, { recursive: true });
    const prompt = request.allowWorkspaceWrites
      ? writableSubscriptionPrompt(request.prompt)
      : safeSubscriptionPrompt(request.prompt);
    const output = await runProcess(this.command, [
      "--input-format", "stream-json", "--output-format", "stream-json", "--mode", request.allowWorkspaceWrites ? "accept-edits" : "plan",
      "--sandbox", "--dangerously-skip-permissions", "--model", request.model,
    ], `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`, request.signal, this.timeoutMs, this.workspaceDirectory);
    return estimatedResponse(prompt, extractAntigravityText(output));
  }
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai" as const;
  constructor(private readonly apiKey: string, private readonly timeoutMs: number) {}
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const body = await requestJson("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: request.model, input: request.prompt, max_output_tokens: request.maxOutputTokens }),
      signal: request.signal,
    }, this.timeoutMs);
    const usage = (body.usage ?? {}) as JsonRecord;
    const text = typeof body.output_text === "string" ? body.output_text : extractOpenAIText(body.output);
    return { text, inputTokens: asNumber(usage.input_tokens), outputTokens: asNumber(usage.output_tokens) };
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  constructor(private readonly apiKey: string, private readonly timeoutMs: number) {}
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const body = await requestJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens, messages: [{ role: "user", content: request.prompt }] }),
      signal: request.signal,
    }, this.timeoutMs);
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.map((item) => item && typeof item === "object" && "text" in item ? String(item.text) : "").join("");
    const usage = (body.usage ?? {}) as JsonRecord;
    return { text, inputTokens: asNumber(usage.input_tokens), outputTokens: asNumber(usage.output_tokens) };
  }
}

export class GeminiProvider implements ModelProvider {
  readonly name = "gemini" as const;
  constructor(private readonly apiKey: string, private readonly timeoutMs: number) {}
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = encodeURIComponent(request.model);
    const body = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: request.prompt }] }], generationConfig: { maxOutputTokens: request.maxOutputTokens } }),
      signal: request.signal,
    }, this.timeoutMs);
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const first = (candidates[0] ?? {}) as JsonRecord;
    const content = (first.content ?? {}) as JsonRecord;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map((part) => part && typeof part === "object" && "text" in part ? String(part.text) : "").join("");
    const usage = (body.usageMetadata ?? {}) as JsonRecord;
    return { text, inputTokens: asNumber(usage.promptTokenCount), outputTokens: asNumber(usage.candidatesTokenCount) };
  }
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractOpenAIText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
    return item.content.map((part: unknown) => part && typeof part === "object" && "text" in part ? String(part.text) : "");
  }).join("");
}

function safeSubscriptionPrompt(prompt: string): string {
  return [
    "Inspect the current project workspace and any read-only dependency information needed for the task. Do not modify files or run destructive commands. Return the requested planning or review result for the implementation worker.",
    prompt,
  ].join("\n\n");
}

function writableSubscriptionPrompt(prompt: string): string {
  return [
    "Work directly in the current project workspace. You may create, edit, or delete persistent files only inside this workspace and may run the checks needed for the task. Do not modify files outside the workspace or run destructive system commands. Do not return code that the user must save manually.",
    prompt,
  ].join("\n\n");
}

function estimatedResponse(prompt: string, text: string): GenerateResponse {
  return {
    text: text.trim(),
    inputTokens: Math.ceil(prompt.length / 4),
    outputTokens: Math.ceil(text.length / 4),
  };
}

export function extractAntigravityText(output: string): string {
  const events = output.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line) as JsonRecord]; }
    catch { return []; }
  });
  const result = [...events].reverse().find((event) => event.event === "result")?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Antigravity CLI returned invalid output");
  const record = result as JsonRecord;
  if (record.status !== "SUCCESS" || typeof record.response !== "string") {
    throw new Error(typeof record.error === "string" ? `Antigravity CLI failed: ${record.error.slice(0, 300)}` : "Antigravity CLI failed");
  }
  return record.response;
}

function runProcess(command: string, args: string[], input: string, signal: AbortSignal, timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
      env: subscriptionEnvironment(),
      cwd,
    });
    let stdout = "";
    let stderr = "";
    const timeout = timeoutMs > 0 ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk.slice(0, 2_000_000 - stdout.length); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk.slice(0, 8_000 - stderr.length); });
    child.on("error", reject);
    child.on("close", (code, processSignal) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0 && stdout.trim()) resolvePromise(stdout);
      else {
        const loginRequired = /log(?:ged)?\s*out|not\s*logged\s*in|auth(?:entication)?\s*(?:is\s*)?required|login\s*required/i.test(stderr);
        reject(new Error(processSignal ? "Subscription model timed out" : `Subscription model failed (${code ?? "unknown"})${loginRequired ? ": login required" : ""}`));
      }
    });
    child.stdin.end(input);
  });
}

function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const;
  return {
    ...Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : [])),
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
  };
}
