import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/{app,cli,http,config,index}.ts", "src/**/*.test.ts"],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
  },
});
