#!/usr/bin/env node
/**
 * Refuses to let obvious secrets reach the repository.
 *
 * Not a replacement for a real scanner — it catches the specific mistakes this
 * project is prone to: a populated .env committed, or a live key pasted into
 * source. Runs in CI and is worth running before any push.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Razorpay live key', re: /rzp_live_[A-Za-z0-9]+/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]+/ },
  { name: 'Postgres URL with a password', re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{3,}@/ },
];

/** Files the repository must never track at all. */
const FORBIDDEN = [/^\.env$/, /^\.env\.local$/, /^\.env\.production$/, /userlist\.txt$/];

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

for (const file of tracked) {
  if (FORBIDDEN.some((re) => re.test(file))) {
    problems.push(`${file}: this file must never be committed`);
    continue;
  }
  if (!/\.(ts|tsx|js|jsx|mjs|json|ya?ml|sql|md)$|\.env\.example$/.test(file)) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const { name, re } of PATTERNS) {
    const match = content.match(re);
    if (!match) continue;
    // Example files are allowed to show placeholder shapes.
    const placeholder = /USER:PASSWORD|replace-me|localhost:5432\/skyup_auth\?/.test(match[0]);
    if (file.endsWith('.env.example') && placeholder) continue;
    problems.push(`${file}: possible ${name} — ${match[0].slice(0, 28)}…`);
  }
}

if (problems.length) {
  console.error('Secret scan FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

console.log(`Secret scan clean (${tracked.length} tracked files).`);
