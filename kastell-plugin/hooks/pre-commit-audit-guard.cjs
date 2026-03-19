#!/usr/bin/env node
// PreToolUse hook: Block git commit if audit score dropped since previous audit run

const fs = require('fs');
const path = require('path');
const os = require('os');

const HISTORY_FILE = path.join(os.homedir(), '.kastell', 'audit-history.json');

// MANDATORY stdin guard — exit silently if stdin unavailable
if (!process.stdin || process.stdin.destroyed || !process.stdin.readable) {
  process.exit(0);
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => process.exit(0));
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const cwd = process.cwd();

    // Kastell project guard
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.name !== 'kastell') process.exit(0);
    } catch { process.exit(0); }

    // Parse tool input — only act on git commit commands
    const data = JSON.parse(input);
    const cmd = (data.tool_input && data.tool_input.command) || '';

    if (!/\bgit\s+commit\b/.test(cmd)) {
      process.exit(0);
    }

    // Read audit history — fail-open if unavailable
    let history;
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
      // History missing or unreadable — allow commit
      process.exit(0);
    }

    // Check each server for score regression between last two audit runs
    for (const serverIp of Object.keys(history)) {
      const entries = history[serverIp];
      if (!Array.isArray(entries) || entries.length < 2) continue;

      const current = entries[entries.length - 1].overallScore;
      const previous = entries[entries.length - 2].overallScore;

      if (current < previous) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `Audit score dropped: ${previous} -> ${current} (${entries[entries.length - 1].serverName}). Run \`kastell audit\` to investigate before committing.`,
        }));
        process.exit(0);
      }
    }

    // No score drop detected — allow commit
  } catch {}

  // Fail-open: any unexpected error allows the commit through
  process.exit(0);
});
