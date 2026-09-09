import { execFileSync } from "node:child_process";

for (const name of ["codemirror-helix-core", "codemirror-helix-cm5"]) {
  try {
    const owners = execFileSync("npm", ["owner", "ls", name], { encoding: "utf8" });
    if (!owners.includes("eastsun5566")) {
      throw new Error(`${name} exists but eastsun5566 is not an owner`);
    }
    console.log(`${name}: eastsun5566 ownership confirmed`);
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (/E404|not found/i.test(output)) {
      throw new Error(`${name} is unclaimed; complete the manual bootstrap first`);
    }
    throw error;
  }
}
