import nextEnv from "@next/env";
import { defineConfig, devices } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());

const port = process.env.PAIPA_E2E_PORT ?? "3000";
const baseURL = process.env.PAIPA_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --webpack --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
