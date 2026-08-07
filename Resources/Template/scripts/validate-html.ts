import { validateDist } from "./markup-validate.ts";

const distDir = process.argv[2] ?? "dist";
const problems = validateDist(distDir);

if (problems.length > 0) {
  console.error(`✗ HTML markup validation failed (${problems.length} problem(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("✓ HTML markup validation passed");
