import type { Options } from "@wdio/types";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

let server: ViteDevServer | undefined;
const testRoot = fileURLToPath(new URL("./test", import.meta.url));

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./test/*.spec.ts"],
  maxInstances: process.env.CI ? 1 : 4,
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": process.env.CI
        ? {
            args: [
              "--headless",
              "--disable-gpu",
              "--no-sandbox",
              "--disable-dev-shm-usage",
            ],
          }
        : {},
    },
    {
      browserName: "firefox",
      "moz:firefoxOptions": process.env.CI ? { args: ["-headless"] } : {},
    },
  ],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  onPrepare: async () => {
    server = await createServer({ root: testRoot, server: { port: 45184 } });
    await server.listen();
  },
  onComplete: async () => {
    await server?.close();
  },
};
