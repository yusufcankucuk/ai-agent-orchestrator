import { spawn } from "node:child_process";
import { z } from "zod";

export type UsageWindow = {
  id: string;
  label: string;
  remainingPercent: number;
  resetsAt: string;
};

export type UsageGroup = { name: string; windows: UsageWindow[] };

const codexWindowSchema = z.object({
  usedPercent: z.number().finite(),
  windowDurationMins: z.number().finite().positive(),
  resetsAt: z.number().finite(),
});

const codexResponseSchema = z.object({
  rateLimits: z.object({
    primary: codexWindowSchema.nullable(),
    secondary: codexWindowSchema.nullable(),
  }).nullable(),
});

const antigravityResponseSchema = z.object({
  command: z.object({
    data: z.object({
      groups: z.array(z.object({
        name: z.string(),
        buckets: z.array(z.object({
          id: z.string(),
          name: z.string(),
          window: z.string(),
          remaining_fraction: z.number().finite(),
          reset_time: z.string(),
        })),
      })),
    }),
  }),
});

export async function readCodexUsage(command: string): Promise<UsageGroup[]> {
  const raw = await codexRequest(command, "account/rateLimits/read");
  return normalizeCodexUsage(raw);
}

export async function readAntigravityUsage(command: string): Promise<UsageGroup[]> {
  const raw = await runJsonCommand(command, ["--print", "/quota", "--output-format", "json", "--mode", "plan", "--sandbox"]);
  return normalizeAntigravityUsage(raw);
}

export function normalizeCodexUsage(raw: unknown): UsageGroup[] {
  const limits = codexResponseSchema.parse(raw).rateLimits;
  if (!limits) return [];
  const windows = [limits.primary, limits.secondary].flatMap((window) => {
    if (!window) return [];
    return [{
      id: `${window.windowDurationMins}m`,
      label: formatWindow(window.windowDurationMins),
      remainingPercent: clampPercent(100 - window.usedPercent),
      resetsAt: new Date(window.resetsAt * 1_000).toISOString(),
    }];
  });
  return windows.length ? [{ name: "ChatGPT", windows }] : [];
}

export function normalizeAntigravityUsage(raw: unknown): UsageGroup[] {
  const parsed = antigravityResponseSchema.parse(raw);
  return parsed.command.data.groups
    .filter((group) => group.name.toLocaleLowerCase("en-US").includes("gemini"))
    .map((group) => ({
      name: group.name,
      windows: group.buckets.map((bucket) => ({
        id: bucket.id,
        label: bucket.window === "5h" ? "5 saatlik" : bucket.window === "weekly" ? "Haftalık" : bucket.name,
        remainingPercent: clampPercent(bucket.remaining_fraction * 100),
        resetsAt: new Date(bucket.reset_time).toISOString(),
      })),
    }));
}

function codexRequest(command: string, method: string): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ["app-server"], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: subscriptionEnvironment(),
    });
    let buffer = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Kota sorgusu zaman aşımına uğradı")), 15_000);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolvePromise(value);
    };
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk.slice(0, 2_000 - stderr.length); });
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk.slice(0, 2_000_000 - buffer.length);
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (message.id === 0) {
            if (message.error) return finish(new Error(message.error.message || "Codex başlatılamadı"));
            send({ method: "initialized" });
            send({ id: 1, method, params: {} });
          }
          if (message.id === 1) {
            if (message.error) return finish(new Error(message.error.message || "Kota alınamadı"));
            return finish(undefined, message.result);
          }
        } catch { /* Ignore non-protocol output. */ }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Kota sorgusu başarısız oldu (${code ?? "unknown"})`));
    });
    send({ id: 0, method: "initialize", params: { clientInfo: { name: "orchestra", title: "Orchestra", version: "0.1.0" } } });
  });
}

function runJsonCommand(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: subscriptionEnvironment() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Kota sorgusu zaman aşımına uğradı")), 45_000);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) child.kill("SIGTERM");
      if (error) reject(error);
      else resolvePromise(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk.slice(0, 2_000_000 - stdout.length); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk.slice(0, 2_000 - stderr.length); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error(stderr.trim() || `Kota sorgusu başarısız oldu (${code ?? "unknown"})`));
      try { finish(undefined, JSON.parse(stdout)); }
      catch { finish(new Error("CLI geçerli kota bilgisi döndürmedi")); }
    });
  });
}

function formatWindow(minutes: number): string {
  if (minutes === 10_080) return "Haftalık";
  if (minutes % 60 === 0) return `${minutes / 60} saatlik`;
  return `${minutes} dakikalık`;
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const;
  return {
    ...Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : [])),
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
  };
}
