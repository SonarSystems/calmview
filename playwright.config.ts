import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  // A check passes as soon as it's true; the longer limit only matters on a busy machine.
  expect: { timeout: 10_000 },
  reporter: "list",
  // Test groups run side by side, each in its own headless browser; half the cores leaves headroom
  // for anything timing-sensitive. Keep speed measurements in their own run on a quiet machine.
  workers: "50%",
  use: { trace: "retain-on-failure" },
});
