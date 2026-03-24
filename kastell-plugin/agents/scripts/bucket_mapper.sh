#!/usr/bin/env bash
# bucket_mapper.sh — Map kastell audit JSON checks to 5 security buckets.
# Usage: kastell audit --server <name> --json | bash bucket_mapper.sh
#    OR: bash bucket_mapper.sh < audit-output.json
#    OR: bash bucket_mapper.sh audit-output.json
#
# Output: Per-bucket check list with pass/fail status and severity.
# Used by kastell-auditor agent for structured analysis.
#
# Requires: node

set -euo pipefail

if [[ -n "${1:-}" && -f "$1" ]]; then
  INPUT=$(cat "$1")
elif [[ ! -t 0 ]]; then
  INPUT=$(cat)
else
  echo "Usage: kastell audit --server <name> --json | bash bucket_mapper.sh" >&2
  exit 1
fi

node -e "
const data = JSON.parse(process.argv[1]);
const checks = data.checks || data.results || [];

const BUCKETS = {
  '1_Perimeter': {
    match: ['network', 'firewall', 'dns'],
    checks: []
  },
  '2_Authentication': {
    match: ['ssh', 'auth', 'crypto', 'accounts'],
    checks: []
  },
  '3_Runtime': {
    match: ['docker', 'services', 'boot', 'scheduling'],
    checks: []
  },
  '4_Internals': {
    match: ['filesystem', 'logging', 'kernel', 'memory'],
    checks: []
  },
  '5_Compliance': {
    match: [], // catchall
    checks: []
  }
};

function getBucket(category) {
  const cat = (category || '').toLowerCase();
  for (const [name, bucket] of Object.entries(BUCKETS)) {
    if (name === '5_Compliance') continue;
    if (bucket.match.some(m => cat.includes(m))) return name;
  }
  return '5_Compliance';
}

// Map checks to buckets
for (const c of checks) {
  const bucket = getBucket(c.category);
  BUCKETS[bucket].checks.push({
    id: c.id || 'unknown',
    name: c.name || '',
    severity: c.severity || 'info',
    passed: !!c.passed,
    category: c.category || ''
  });
}

// Output
const score = data.score ?? data.overallScore ?? 'N/A';
console.log('Score: ' + score + '/100');
console.log('Total checks: ' + checks.length);
console.log('');

for (const [name, bucket] of Object.entries(BUCKETS)) {
  const label = name.replace(/^[0-9]_/, '');
  const passed = bucket.checks.filter(c => c.passed).length;
  const total = bucket.checks.length;
  const critFail = bucket.checks.filter(c => !c.passed && c.severity === 'critical');

  console.log('--- ' + label + ' (' + passed + '/' + total + ') ---');

  // Show failed checks (critical first, then warning)
  const failed = bucket.checks
    .filter(c => !c.passed)
    .sort((a, b) => {
      const sev = { critical: 0, warning: 1, info: 2 };
      return (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
    });

  for (const c of failed.slice(0, 5)) {
    const icon = c.severity === 'critical' ? '!!' : c.severity === 'warning' ? '! ' : '  ';
    console.log('  [FAIL] ' + icon + c.id + ' — ' + c.name);
  }
  if (failed.length > 5) console.log('  ... and ' + (failed.length - 5) + ' more');
  if (failed.length === 0) console.log('  All checks passed');
  console.log('');
}
" "$INPUT"
