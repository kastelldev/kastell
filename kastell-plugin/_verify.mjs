import { readFileSync } from 'fs';
const p = JSON.parse(readFileSync('kastell-plugin/.claude-plugin/plugin.json', 'utf8'));
const fields = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'keywords'];
const missing = fields.filter(f => !p[f]);
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
console.log('All fields present:', fields.join(', '));
console.log('name:', p.name, '| version:', p.version);
