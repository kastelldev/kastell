const data = require('../coverage/coverage-summary.json');
const entries = Object.entries(data).filter(([k]) => k !== 'total');
const norm = (p) => p.replace(/\\/g, '/');

function calcGroup(match) {
  const files = entries.filter(([k]) => norm(k).includes(match));
  let tb = 0, cb = 0, tf = 0, cf = 0, tl = 0, cl = 0, ts = 0, cs = 0;
  files.forEach(([, v]) => {
    tb += v.branches.total; cb += v.branches.covered;
    tf += v.functions.total; cf += v.functions.covered;
    tl += v.lines.total; cl += v.lines.covered;
    ts += v.statements.total; cs += v.statements.covered;
  });
  return {
    branches: tb ? (cb / tb * 100).toFixed(2) : 'N/A',
    functions: tf ? (cf / tf * 100).toFixed(2) : 'N/A',
    lines: tl ? (cl / tl * 100).toFixed(2) : 'N/A',
    stmts: ts ? (cs / ts * 100).toFixed(2) : 'N/A',
    files: files.length,
  };
}

// Global excl audit/prov/mcp
const globalFiles = entries.filter(([k]) => {
  const n = norm(k);
  return !n.includes('src/core/audit/') && !n.includes('src/providers/') && !n.includes('src/mcp/');
});
let gtb = 0, gcb = 0, gtf = 0, gcf = 0, gtl = 0, gcl = 0;
globalFiles.forEach(([, v]) => {
  gtb += v.branches.total; gcb += v.branches.covered;
  gtf += v.functions.total; gcf += v.functions.covered;
  gtl += v.lines.total; gcl += v.lines.covered;
});

const t = data.total;
const audit = calcGroup('src/core/audit/');
const prov = calcGroup('src/providers/');
const mcp = calcGroup('src/mcp/');

console.log('| Scope | Branches | Functions | Lines | Stmts | Threshold | Status |');
console.log('|-------|----------|-----------|-------|-------|-----------|--------|');
console.log(`| **All files** | ${t.branches.pct}% | ${t.functions.pct}% | ${t.lines.pct}% | ${t.statements.pct}% | — | — |`);
console.log(`| **Global** (excl audit/prov/mcp) | ${(gcb/gtb*100).toFixed(2)}% | ${(gcf/gtf*100).toFixed(2)}% | ${(gcl/gtl*100).toFixed(2)}% | — | 90% | ${(gcb/gtb*100) >= 90 ? 'PASS' : 'FAIL'} |`);
console.log(`| **Audit** (${audit.files} files) | ${audit.branches}% | ${audit.functions}% | ${audit.lines}% | ${audit.stmts}% | 95% | ${parseFloat(audit.branches) >= 95 ? 'PASS' : 'FAIL'} |`);
console.log(`| **Providers** (${prov.files} files) | ${prov.branches}% | ${prov.functions}% | ${prov.lines}% | ${prov.stmts}% | 90% | ${parseFloat(prov.branches) >= 90 ? 'PASS' : 'FAIL'} |`);
console.log(`| **MCP** (${mcp.files} files) | ${mcp.branches}% | ${mcp.functions}% | ${mcp.lines}% | ${mcp.stmts}% | 90% | ${parseFloat(mcp.branches) >= 90 ? 'PASS' : 'FAIL'} |`);
console.log('');
console.log(`Tests: ${5087} | Suites: 197 | Snapshots: 11`);
