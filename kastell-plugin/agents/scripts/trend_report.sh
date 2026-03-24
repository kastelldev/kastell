#!/usr/bin/env bash
# trend_report.sh — Generate audit score trend from audit-history.json.
# Usage: bash trend_report.sh [server-name]
#    OR: bash trend_report.sh --all
#
# Reads ~/.kastell/audit-history.json (maintained by kastell-auditor agent).
# Shows score over time with delta indicators.
#
# Requires: node

set -euo pipefail

HISTORY_FILE="${KASTELL_HOME:-$HOME/.kastell}/audit-history.json"
SERVER="${1:-}"

if [[ ! -f "$HISTORY_FILE" ]]; then
  echo "No audit history found at: $HISTORY_FILE"
  echo "Run 'kastell audit --server <name>' to generate data."
  exit 0
fi

node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const server = process.argv[2] || '';
const showAll = server === '--all';

if (!Array.isArray(data) || data.length === 0) {
  console.log('No audit history entries found.');
  process.exit(0);
}

// Filter by server if specified
let entries = showAll ? data : server
  ? data.filter(e => e.serverName === server || e.server === server)
  : data;

if (entries.length === 0) {
  console.log('No audit history for server: ' + server);
  console.log('Available servers: ' + [...new Set(data.map(e => e.serverName || e.server))].join(', '));
  process.exit(0);
}

// Sort by date
entries.sort((a, b) => new Date(a.timestamp || a.date) - new Date(b.timestamp || b.date));

// Group by server
const byServer = {};
for (const e of entries) {
  const name = e.serverName || e.server || 'unknown';
  if (!byServer[name]) byServer[name] = [];
  byServer[name].push(e);
}

console.log('=== Audit Score Trend ===');
console.log('');

for (const [name, history] of Object.entries(byServer)) {
  console.log('Server: ' + name);
  console.log('-'.repeat(50));

  let prev = null;
  for (const e of history) {
    const score = e.overallScore ?? e.score ?? 0;
    const date = (e.timestamp || e.date || '').split('T')[0];
    let delta = '';
    if (prev !== null) {
      const diff = score - prev;
      delta = diff > 0 ? ' (+' + diff + ')' : diff < 0 ? ' (' + diff + ')' : ' (=)';
    }

    // Visual bar
    const filled = Math.round(score / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

    console.log('  ' + date + '  ' + String(score).padStart(3) + '/100 ' + bar + delta);
    prev = score;
  }

  // Latest bucket scores if available
  const latest = history[history.length - 1];
  if (latest.bucketScores) {
    console.log('');
    console.log('  Latest bucket breakdown:');
    for (const [bucket, score] of Object.entries(latest.bucketScores)) {
      console.log('    ' + bucket.padEnd(15) + ': ' + score);
    }
  }
  console.log('');
}
" "$HISTORY_FILE" "$SERVER"
