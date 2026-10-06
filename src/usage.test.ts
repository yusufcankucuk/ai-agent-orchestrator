import { describe, expect, it } from "vitest";
import { normalizeAntigravityUsage, normalizeCodexUsage } from "./usage.js";

describe("usage normalization", () => {
  it("converts Codex used percentages into remaining percentages", () => {
    expect(normalizeCodexUsage({ rateLimits: {
      primary: { usedPercent: 87, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 14, windowDurationMins: 10_080, resetsAt: 1_800_100_000 },
    } })).toEqual([{ name: "ChatGPT", windows: [
      { id: "300m", label: "5 saatlik", remainingPercent: 13, resetsAt: "2027-01-15T08:00:00.000Z" },
      { id: "10080m", label: "Haftalık", remainingPercent: 86, resetsAt: "2027-01-16T11:46:40.000Z" },
    ] }]);
  });

  it("keeps only Gemini quota groups from Antigravity", () => {
    expect(normalizeAntigravityUsage({ command: { data: { groups: [
      { name: "Gemini Models", buckets: [{ id: "gemini-5h", name: "Five Hour", window: "5h", remaining_fraction: 0.971, reset_time: "2026-10-06T01:38:13Z" }] },
      { name: "Claude and GPT models", buckets: [{ id: "3p-5h", name: "Five Hour", window: "5h", remaining_fraction: 1, reset_time: "2026-10-06T03:09:48Z" }] },
    ] } } })).toEqual([{ name: "Gemini Models", windows: [
      { id: "gemini-5h", label: "5 saatlik", remainingPercent: 97.1, resetsAt: "2026-10-06T01:38:13.000Z" },
    ] }]);
  });
});
