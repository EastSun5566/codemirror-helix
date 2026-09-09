import { readFileSync } from "node:fs";

const tag = process.argv[2];
const core = JSON.parse(
  readFileSync("packages/codemirror-helix-core/package.json", "utf8"),
);
const cm5 = JSON.parse(
  readFileSync("packages/codemirror-helix-cm5/package.json", "utf8"),
);

if (core.version !== cm5.version) {
  throw new Error(`core ${core.version} and cm5 ${cm5.version} must stay synchronized`);
}
if (tag !== `cm5-v${cm5.version}`) {
  throw new Error(`tag ${tag} must equal cm5-v${cm5.version}`);
}
