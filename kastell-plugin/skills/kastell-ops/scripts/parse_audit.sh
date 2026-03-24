#!/usr/bin/env bash
# parse_audit.sh — Parse kastell audit JSON into 5 security domain summaries.
# Usage: kastell audit --server <name> --json | bash parse_audit.sh
#    OR: bash parse_audit.sh < audit-output.json
#    OR: bash parse_audit.sh audit-output.json
#
# Requires: node (uses inline JS for JSON parsing — no jq dependency)

set -euo pipefail

# Read JSON from file arg, stdin, or pipe
if [[ -n "${1:-}" && -f "$1" ]]; then
  INPUT=$(cat "$1")
elif [[ ! -t 0 ]]; then
  INPUT=$(cat)
else
  echo "Usage: kastell audit --server <name> --json | bash parse_audit.sh" >&2
  echo "   OR: bash parse_audit.sh <audit-json-file>" >&2
  exit 1
fi

node -e "
const data = JSON.parse(process.argv[1]);
const checks = data.checks || data.results || [];

// 5 security domain mapping
const DOMAINS = {
  'Perimeter':       ['Network', 'Firewall', 'DNS Security'],
  'Authentication':  ['SSH', 'Auth', 'Crypto', 'Accounts'],
  'Runtime':         ['Docker', 'Services', 'Boot', 'Scheduling'],
  'Internals':       ['Filesystem', 'Logging', 'Kernel', 'Memory'],
  'Compliance':      ['Updates', 'File Integrity', 'Malware', 'MAC', 'Secrets',
                      'Cloud Metadata', 'Supply Chain', 'Backup Hygiene',
                      'Resource Limits', 'Incident Readiness', 'Banners', 'Time',
                      'TLS', 'HTTP Security Headers'],
};

// Map categories to domains
const catToDomain = {};
for (const [domain, cats] of Object.entries(DOMAINS)) {
  for (const cat of cats) catToDomain[cat.toLowerCase()] = domain;
}

// Bucket checks
const buckets = {};
for (const d of Object.keys(DOMAINS)) buckets[d] = { passed: 0, failed: 0, critical: [] };

for (const c of checks) {
  const cat = (c.category || '').toLowerCase();
  let domain = 'Compliance'; // default
  for (const [key, val] of Object.entries(catToDomain)) {
    if (cat.includes(key)) { domain = val; break; }
  }
  if (c.passed) buckets[domain].passed++;
  else {
    buckets[domain].failed++;
    if (c.severity === 'critical') buckets[domain].critical.push(c.id || c.name);
  }
}

// Output
const score = data.score ?? data.overallScore ?? 'N/A';
console.log('=== Kastell Audit Domain Summary ===');
console.log('Overall Score: ' + score + '/100');
console.log('');

for (const [domain, b] of Object.entries(buckets)) {
  const total = b.passed + b.failed;
  const pct = total > 0 ? Math.round(b.passed / total * 100) : 0;
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(domain + ': ' + b.passed + '/' + total + ' (' + pct + '%) ' + bar);
  if (b.critical.length > 0) {
    console.log('  Critical: ' + b.critical.slice(0, 3).join(', '));
  }
}
" "$INPUT"
