import { execFileSync } from "node:child_process";

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;
if (!base || !head) {
  throw new Error("BASE_SHA and HEAD_SHA are required");
}

const commits = execFileSync("git", ["rev-list", `${base}..${head}`], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const unsigned = commits.filter((commit) => {
  const message = execFileSync("git", ["show", "-s", "--format=%B", commit], {
    encoding: "utf8",
  });
  return !/^Signed-off-by:\s+.+\s+<[^>]+>\s*$/imu.test(message);
});

if (unsigned.length > 0) {
  console.error(`Missing Signed-off-by trailer: ${unsigned.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`DCO check passed for ${commits.length} commit(s).`);
}
