import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const SAMPLE = path.resolve(__dirname, "../../samples/acme-secure-sdlc-overview.md");

test("assessor journey: sign in → engagement → evidence → analysis → frameworks → override → report", async ({
  page,
}) => {
  const email = `assessor-${Date.now()}@example.com`;

  // 1. Sign in (dev e-mail login)
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Secure software.");
  await page.getByLabel(/Development login/).fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Engagements." })).toBeVisible();
  await expect(page.getByTestId("user-email")).toHaveText(email);

  // 2. Create an engagement
  await page.getByRole("link", { name: "New engagement" }).click();
  await page.getByLabel("Client name").fill("Acme Corp");
  await page.getByLabel("Application").fill("Payments Platform");
  await page.getByLabel("Scope").fill("Payments API, web front end and CI/CD pipeline");
  await page.getByTestId("fw-samm").click();
  await page.getByTestId("fw-nist_ssdf").click();
  await page.getByRole("button", { name: "Create engagement" }).click();
  await expect(page).toHaveURL(/\/engagements\/[a-f0-9]+\/evidence/);
  await expect(page.getByTestId("engagement-title")).toHaveText("Payments Platform");

  // 3. Upload evidence and add interview notes
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("document-list")).toContainText("acme-secure-sdlc-overview.md");
  await page.getByLabel("Title").fill("Interview - lead developer");
  await page.getByLabel("Interviewee role").fill("Lead developer");
  await page.getByLabel("Date").fill("2026-09-01");
  await page
    .getByLabel(/Notes/)
    .fill("We run SonarQube but it does not block builds. Reach me at lead@acme.example or +1 (555) 010-2000.");
  await page.getByRole("button", { name: "Save interview" }).click();
  await expect(page.getByTestId("document-list")).toContainText("Interview - lead developer");
  await expect(page.getByTestId("document-list")).toContainText("2 redacted");

  // 4. Run the analysis (heuristic analyzer: no API key in CI)
  await page.getByRole("link", { name: "Analysis", exact: true }).click();
  await expect(page.getByTestId("analyzer-name")).toContainText("heuristic");
  await page.getByTestId("run-analysis").click();
  await expect(page.getByTestId("analysis-complete")).toBeVisible({ timeout: 60_000 });

  // 5. Results and framework toggle
  await page.getByRole("link", { name: "View results" }).click();
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(page.getByTestId("radar-chart")).toBeVisible();
  await expect(page.getByTestId("heatmap")).toBeVisible();
  await expect(page.getByTestId("practice-D-TA")).toBeVisible();
  await page.getByTestId("toggle-nist_ssdf").click();
  await expect(page.getByText(/Projected from OWASP SAMM|Projected from SAMM/)).toBeVisible();
  await expect(page.getByTestId("practice-PW.1")).toBeVisible();
  await page.getByTestId("toggle-bsimm").click();
  await expect(page.getByTestId("practice-AM")).toBeVisible();
  await page.getByTestId("toggle-samm").click();

  // 6. Override a score
  const card = page.getByTestId("practice-D-TA");
  await card.getByRole("button", { expanded: false }).click();
  await card.getByTestId("override-button").click();
  await card.getByRole("spinbutton", { name: "Score" }).fill("3");
  await card.getByLabel(/Reason/).fill("Threat models reviewed on site for three services");
  await card.getByRole("button", { name: "Save override" }).click();
  await expect(card).toContainText("Override");
  await expect(card).toContainText("Threat models reviewed on site for three services");

  // 7. Download the PowerPoint report
  await page.getByRole("link", { name: "Report", exact: true }).click();
  await expect(page.getByTestId("executive-summary")).toContainText("Payments Platform");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-report").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const file = await download.path();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(bytes.length).toBeGreaterThan(20_000);

  // 8. The override is in the audit log
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByTestId("audit-log")).toContainText("Overrode a score");
  await expect(page.getByTestId("audit-log")).toContainText("Downloaded the report");
});

test("security headers and CSP are set", async ({ request }) => {
  const res = await request.get("/signin");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  const token = await request.get("/api/token");
  expect(token.status()).toBe(401);
});
