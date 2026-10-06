import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider, AntigravitySubscriptionProvider, ClaudeSubscriptionProvider, CodexSubscriptionProvider, extractAntigravityText, GeminiProvider, MockProvider, OpenAIProvider } from "./providers.js";

const request = { model: "model", prompt: "hello", maxOutputTokens: 20, signal: new AbortController().signal };

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })));
}

describe("provider adapters", () => {
  it("maps OpenAI responses to the common result", async () => {
    response({ output_text: "openai", usage: { input_tokens: 4, output_tokens: 2 } });
    await expect(new OpenAIProvider("secret", 1_000).generate(request)).resolves.toEqual({ text: "openai", inputTokens: 4, outputTokens: 2 });
  });

  it("extracts OpenAI text from nested response content", async () => {
    response({ output: [{ content: [{ type: "output_text", text: "nested" }] }], usage: {} });
    await expect(new OpenAIProvider("secret", 1_000).generate(request)).resolves.toEqual({ text: "nested", inputTokens: 0, outputTokens: 0 });
  });

  it("maps Anthropic responses to the common result", async () => {
    response({ content: [{ type: "text", text: "anthropic" }], usage: { input_tokens: 5, output_tokens: 3 } });
    await expect(new AnthropicProvider("secret", 1_000).generate(request)).resolves.toEqual({ text: "anthropic", inputTokens: 5, outputTokens: 3 });
  });

  it("maps Gemini responses to the common result", async () => {
    response({ candidates: [{ content: { parts: [{ text: "gemini" }] } }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 } });
    await expect(new GeminiProvider("secret", 1_000).generate(request)).resolves.toEqual({ text: "gemini", inputTokens: 6, outputTokens: 4 });
  });

  it("rejects provider HTTP errors without exposing response content", async () => {
    response({ secret: "provider detail" }, 401);
    await expect(new OpenAIProvider("secret", 1_000).generate(request)).rejects.toThrow("Provider HTTP 401");
  });

  it("rejects non-object provider JSON", async () => {
    response("invalid");
    await expect(new OpenAIProvider("secret", 1_000).generate(request)).rejects.toThrow("invalid JSON");
  });

  it("provides a deterministic offline mock", async () => {
    await expect(new MockProvider().generate(request)).resolves.toMatchObject({ text: "[mock:model] hello" });
  });

  it("runs the subscription provider without a shell", async () => {
    const result = await new CodexSubscriptionProvider("/bin/echo", 0).generate(request);
    expect(result.text).toContain("--ephemeral");
    expect(result.text).toContain("--approve-for-me");
  });

  it("keeps Claude subscription workers in restricted mode", async () => {
    const claude = await new ClaudeSubscriptionProvider("/bin/echo", 1_000).generate(request);
    expect(claude.text).toContain("--permission-mode plan");
    expect(claude.text).toContain("--safe-mode");
  });

  it("keeps Antigravity subscription workers in restricted mode", async () => {
    await expect(new AntigravitySubscriptionProvider("/bin/echo", 1_000).generate(request)).rejects.toThrow("invalid output");
  });

  it("extracts a successful Antigravity CLI result event", () => {
    expect(extractAntigravityText(JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "ready" } }))).toBe("ready");
  });

  it("surfaces a bounded Antigravity CLI error", () => {
    const output = JSON.stringify({ event: "result", result: { status: "ERROR", error: "login required" } });
    expect(() => extractAntigravityText(output)).toThrow("login required");
  });
});
