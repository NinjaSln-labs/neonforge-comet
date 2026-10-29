import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  ["private-key", /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["api-key-shape", /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ["bearer-secret", /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["home-linux", /\/home\/[A-Za-z0-9._-]+\//],
  ["home-macos", /\/Users\/[A-Za-z0-9._-]+\//],
  ["home-windows", /[A-Za-z]:\\+Users\\+/],
  [
    "generic-secret-assignment",
    /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/i
  ]
];

const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const path of paths) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    for (const [kind, pattern] of patterns) {
      if (pattern.test(line)) {
        findings.push({ path, line: lineIndex + 1, kind });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(
    findings
      .map((finding) => `${finding.path}:${finding.line}: ${finding.kind}`)
      .join("\n")
  );
  process.exit(1);
}
console.log(`PASS: ${paths.length} public-tree files contain no detected secrets or local home paths.`);
