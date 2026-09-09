import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const temporary = mkdtempSync(join(tmpdir(), "codemirror-helix-consumer-"));
const packageDirectory = join(temporary, "packages");
const consumerDirectory = join(temporary, "consumer");

mkdirSync(packageDirectory);
cpSync(join(root, "test/consumer"), consumerDirectory, { recursive: true });
for (const workspace of ["codemirror-helix-core", "codemirror-helix-cm5"]) {
  execFileSync(
    "npm",
    ["pack", join(root, "packages", workspace), "--pack-destination", packageDirectory],
    { stdio: "inherit" },
  );
}

const tarballs = readdirSync(packageDirectory).map((name) =>
  join(packageDirectory, name),
);
execFileSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--allow-file=all",
    "--allow-directory=all",
    "--allow-remote=all",
    ...tarballs,
    "codemirror@5.65.21",
    "@types/codemirror@5.60.17",
    "typescript@6.0.3",
  ],
  { cwd: consumerDirectory, stdio: "inherit" },
);
execFileSync("npm", ["run", "typecheck"], {
  cwd: consumerDirectory,
  stdio: "inherit",
});

const css = join(consumerDirectory, "node_modules/codemirror-helix-cm5/dist/style.css");
if (!existsSync(css)) {
  throw new Error("Published package is missing the style.css export");
}
console.log(`Fresh consumer verified in ${temporary}`);
