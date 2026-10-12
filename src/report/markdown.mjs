// Plain-text version of the report for pasting into Slack, Jira or a PR.
const ORDER = ['blocker', 'high', 'medium', 'low'];

export function renderMarkdown(r) {
  const lines = [
    `# Pre-flight audit: ${r.page?.title || r.meta.url}`,
    '',
    `${r.meta.url}`,
    `${r.meta.startedAt} · ${r.meta.device} · ${r.meta.live ? 'live' : 'safe mode'}`,
    '',
    `## Verdict: ${r.verdict.label}`,
    r.verdict.summary,
    '',
  ];
  if (r.ai?.executive_summary) lines.push('**AI summary:** ' + r.ai.executive_summary, '');
  for (const s of ORDER) {
    const fs = r.findings.filter(f => f.severity === s);
    if (!fs.length) continue;
    lines.push(`## ${s[0].toUpperCase() + s.slice(1)} (${fs.length})`);
    for (const f of fs) {
      lines.push(`- **${f.title}**${f.confidence !== 'confirmed' ? ' _(needs confirmation)_' : ''} — ${f.category}, owner: ${f.owner}`);
      if (f.finding) lines.push(`  - Saw: ${f.finding}`);
      if (f.impact) lines.push(`  - Why: ${f.impact}`);
      if (f.action) lines.push(`  - Fix: ${f.action}`);
    }
    lines.push('');
  }
  lines.push(`## Passed (${r.findings.filter(f => f.severity === 'pass').length})`);
  for (const f of r.findings.filter(f => f.severity === 'pass')) lines.push(`- ${f.title}`);
  return lines.join('\n') + '\n';
}
