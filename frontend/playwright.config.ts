import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end test: starts the FastAPI backend (SQLite, heuristic analyzer) and the built
 * Next.js app (dev e-mail login), then walks the full assessor journey.
 * Run `npm run build` first with the same env (see .github/workflows/ci.yml).
 */
const AUTH_SECRET = process.env.AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e";
const API_PORT = 8000;
const WEB_PORT = 3000;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: [
    {
      command: `bash -c "rm -f e2e.db && alembic upgrade head && python -m scripts.seed && uvicorn app.main:app --port ${API_PORT}"`,
      cwd: "../backend",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: "sqlite:///./e2e.db",
        AUTH_SECRET,
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        ANTHROPIC_API_KEY: "",
        PATH: process.env.PATH ?? "",
      },
    },
    {
      command: `npx next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/signin`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        AUTH_SECRET,
        AUTH_TRUST_HOST: "true",
        ENABLE_DEV_LOGIN: "true",
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
