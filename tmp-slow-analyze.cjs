const r = JSON.parse(require('fs').readFileSync('/tmp/jest-results.json', 'utf8'));
const slow = r.testResults
  .flatMap(s => s.testResults.map(t => ({
    duration: t.duration ?? 0,
    file: s.testFilePath.split('/').pop(),
    title: t.title
  })))
  .filter(t => t.duration > 1000)
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 30);
slow.forEach(t => console.log(t.duration + 'ms | ' + t.file + ' | ' + t.title));