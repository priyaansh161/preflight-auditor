#!/usr/bin/env node
// Usage: node src/cli.mjs <url> [--desktop] [--live] [--headed] [--explain] [--browser chrome] [--out dir]
//        node src/cli.mjs --replay <dir>/evidence.json [--explain]   (re-run checks on saved evidence, no browser)
import fs from 'node:fs';
import path from 'node:path';
import { collect, analyse } from './audit.mjs';
import { renderHtml } from './report/html.mjs';
import { renderMarkdown } from './report/markdown.mjs';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const url = args.find(a => /^https?:\/\//.test(a));

const replay = opt('--replay');

if ((!url && !replay) || flag('--help')) {
  console.log(`Landing Page Pre-Flight Auditor

  node src/cli.mjs <url> [options]

  --desktop        audit as a desktop visitor (default: mobile, where most ad traffic lands)
  --live           let tracking hits reach the real platforms (default: captured, not delivered)
  --explain        add an AI-written executive summary (needs ANTHROPIC_API_KEY)
  --headed         show the browser window while it works
  --browser <ch>   msedge (default), chrome, or chromium (after: npx playwright install chromium)
  --out <dir>      where to write the report (default: reports/<host>-<time>)
  --replay <file>  re-run the checks on a saved evidence.json without opening a browser`);
  process.exit(url || replay ? 0 : 1);
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const log = m => console.log(m);

// Evidence = everything the browser observed. Saved with every report so any result can be
// reproduced and re-checked offline (--replay) after a rule changes.
const ev = replay
  ? JSON.parse(fs.readFileSync(replay, 'utf8'))
  : await collect({ url, device: flag('--desktop') ? 'desktop' : 'mobile', live: flag('--live'), headed: flag('--headed'), channel: opt('--browser', 'msedge'), log });
const out = opt('--out', replay ? path.dirname(replay) : path.join('reports', `${new URL(url).host}-${stamp}`));
fs.mkdirSync(out, { recursive: true });
if (!replay) fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(ev));

const result = await analyse(ev, { explainWithLLM: flag('--explain'), log });

const { screenshot, ...json } = result;
fs.writeFileSync(path.join(out, 'report.html'), renderHtml(result));
fs.writeFileSync(path.join(out, 'report.md'), renderMarkdown(result));
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(json, null, 2));

const n = s => result.findings.filter(f => f.severity === s).length;
console.log(`\n${result.verdict.label.toUpperCase()}\n${result.verdict.summary}`);
console.log(`blockers ${n('blocker')} · high ${n('high')} · medium ${n('medium')} · low ${n('low')} · passed ${n('pass')}`);
console.log(`\nReport: ${path.resolve(out, 'report.html')}`);
process.exitCode = result.verdict.level === 'not-ready' ? 2 : 0;
