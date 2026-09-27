// node:test reporter that writes a Markdown summary: results per test file, failures, and coverage.
// CI adds it next to the normal output (see .github/workflows/test.yml); it isn't needed locally.
import { readdirSync } from 'node:fs';
import { relative } from 'node:path';

const pct = (x) => (x === 100 ? '100%' : `${x.toFixed(1)}%`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** [1, 2, 3, 7, 9, 10] -> "1-3, 7, 9-10" */
function ranges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

export default async function* summary(source) {
  const files = new Map();  // test file -> {pass, fail, skip, ms}
  const names = new Map();  // test file -> names of the enclosing suites, by nesting level
  const failures = [];
  let coverage = null, counts = null, total = 0;

  for await (const { type, data } of source) {
    const file = data.file ? relative(process.cwd(), data.file) : null;
    if (type === 'test:start' && file) {
      const stack = names.get(file) || [];
      stack.length = data.nesting;
      stack.push(data.name);
      names.set(file, stack);
    } else if ((type === 'test:pass' || type === 'test:fail') && file) {
      const f = files.get(file) || { pass: 0, fail: 0, skip: 0, ms: 0 };
      files.set(file, f);
      if (data.nesting === 0) f.ms += data.details.duration_ms;
      if (data.details.type === 'suite') continue;
      if (type === 'test:fail') {
        f.fail++;
        const err = data.details.error?.cause ?? data.details.error;
        const path = [...(names.get(file) || []).slice(0, data.nesting), data.name].join(' › ');
        failures.push({ file, path, message: String(err?.message ?? err ?? 'failed') });
      } else if (data.skip || data.todo) f.skip++;
      else f.pass++;
    } else if (type === 'test:summary' && !data.file) {
      counts = data.counts; total = data.duration_ms;
    } else if (type === 'test:coverage') {
      coverage = data.summary;
    }
  }

  const c = counts || { passed: 0, failed: 0, skipped: 0 };
  const icon = c.failed ? '❌' : '✅';
  let md = `### ${icon} App (JavaScript): ${c.passed} passed`;
  if (c.failed) md += ` · ${c.failed} failed`;
  if (c.skipped) md += ` · ${c.skipped} skipped`;
  md += ` · ${secs(total)}\n\n`;

  for (const f of failures) {
    md += `**❌ ${f.path}** (\`${f.file}\`)\n\n\`\`\`\n${f.message.slice(0, 1500)}\n\`\`\`\n\n`;
  }

  if (coverage) {
    const t = coverage.totals;
    md += `Coverage of the modules the tests load: **${pct(t.coveredLinePercent)} of lines**, ${pct(t.coveredBranchPercent)} of branches, ${pct(t.coveredFunctionPercent)} of functions.\n\n`;
    md += '| Module | Lines | Branches | Functions | Uncovered lines |\n|---|---:|---:|---:|---|\n';
    const covered = new Set();
    for (const f of coverage.files) {
      const name = relative(coverage.workingDirectory, f.path);
      covered.add(name);
      const missing = ranges(f.lines.filter((l) => l.count === 0).map((l) => l.line));
      md += `| \`${name}\` | ${pct(f.coveredLinePercent)} | ${pct(f.coveredBranchPercent)} | ${pct(f.coveredFunctionPercent)} | ${missing || '–'} |\n`;
    }
    let untested = [];
    try { untested = readdirSync('app').filter((f) => f.endsWith('.js') && f !== 'pieces.js' && !covered.has(`app/${f}`)); } catch { /* no app/ */ }
    if (untested.length) md += `\nNot loaded by any test (0%): ${untested.map((f) => `\`app/${f}\``).join(', ')}.\n`;
  }

  md += '\n<details><summary>Results by test file</summary>\n\n| File | Passed | Failed | Skipped | Time |\n|---|---:|---:|---:|---:|\n';
  for (const [file, f] of [...files].sort()) md += `| \`${file}\` | ${f.pass} | ${f.fail || '–'} | ${f.skip || '–'} | ${secs(f.ms)} |\n`;
  md += '\n</details>\n';
  yield md;
}
