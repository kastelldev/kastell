#!/usr/bin/env bash
# fleet_report.sh — Generate a fleet-wide server score table.
# Usage: kastell fleet --json | bash fleet_report.sh
#    OR: bash fleet_report.sh < fleet-output.json
#    OR: bash fleet_report.sh fleet-output.json
#
# Requires: node

set -euo pipefail

if [[ -n "${1:-}" && -f "$1" ]]; then
  INPUT=$(cat "$1")
elif [[ ! -t 0 ]]; then
  INPUT=$(cat)
else
  echo "Usage: kastell fleet --json | bash fleet_report.sh" >&2
  exit 1
fi

node -e "
const data = JSON.parse(process.argv[1]);
const servers = data.servers || data.fleet || data || [];

if (!Array.isArray(servers) || servers.length === 0) {
  console.log('No servers found in fleet data.');
  process.exit(0);
}

// Header
const cols = { name: 20, ip: 16, provider: 12, mode: 8, score: 6, health: 10 };
const pad = (s, n) => String(s || '-').slice(0, n).padEnd(n);
const sep = '-'.repeat(Object.values(cols).reduce((a, b) => a + b + 3, 0));

console.log('=== Kastell Fleet Report ===');
console.log('Servers: ' + servers.length);
console.log('');
console.log(
  pad('Name', cols.name) + ' | ' +
  pad('IP', cols.ip) + ' | ' +
  pad('Provider', cols.provider) + ' | ' +
  pad('Mode', cols.mode) + ' | ' +
  pad('Score', cols.score) + ' | ' +
  pad('Health', cols.health)
);
console.log(sep);

// Sort by score (lowest first = needs attention)
const sorted = [...servers].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

for (const s of sorted) {
  const score = s.score ?? s.auditScore ?? '-';
  const health = s.health ?? s.status ?? '-';
  const icon = health === 'ONLINE' ? '●' : health === 'DEGRADED' ? '◐' : '○';
  console.log(
    pad(s.name, cols.name) + ' | ' +
    pad(s.ip, cols.ip) + ' | ' +
    pad(s.provider, cols.provider) + ' | ' +
    pad(s.mode, cols.mode) + ' | ' +
    pad(score, cols.score) + ' | ' +
    icon + ' ' + pad(health, cols.health - 2)
  );
}

// Summary
const scores = sorted.map(s => s.score ?? s.auditScore).filter(s => typeof s === 'number');
if (scores.length > 0) {
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  console.log('');
  console.log('Avg: ' + avg + ' | Min: ' + min + ' | Max: ' + max);
}
" "$INPUT"
