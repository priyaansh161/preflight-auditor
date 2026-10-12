// Renders the audit as one self-contained HTML file a non-technical stakeholder can read.
import { funnelOf, PLATFORMS, inr } from '../checks/util.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV = {
  blocker: { label: 'Blocker', hint: 'Do not spend until fixed' },
  high: { label: 'High', hint: 'Numbers will be wrong — fix or confirm before scaling' },
  medium: { label: 'Medium', hint: 'Fix soon; reporting is distorted' },
  low: { label: 'Low', hint: 'Housekeeping' },
  pass: { label: 'Passed', hint: '' },
};

export function renderHtml(r) {
  const issues = r.findings.filter(f => f.severity !== 'pass');
  const passes = r.findings.filter(f => f.severity === 'pass');
  const count = s => r.findings.filter(f => f.severity === s).length;
  const date = new Date(r.meta.startedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-flight Audit</title>
<style>${CSS}</style></head>
<body><main>
<header>
  <p class="eyebrow">Landing page pre-flight audit</p>
  <h1>${esc(r.page?.title || r.meta.url)}</h1>
  <p class="meta"><a href="${esc(r.meta.url)}">${esc(r.meta.url)}</a><br>${esc(date)} IST · ${r.meta.device === 'desktop' ? 'Desktop' : 'Mobile (Pixel 7)'} · ${r.meta.live ? 'Live mode' : 'Safe mode (no data sent to ad platforms)'}</p>
</header>

<section class="verdict v-${r.verdict.level}">
  <div class="verdict-label">${esc(r.verdict.label)}</div>
  <p>${esc(r.verdict.summary)}</p>
  <ul class="counts">
    ${['blocker', 'high', 'medium', 'low', 'pass'].map(s => `<li class="c-${s}"><b>${count(s)}</b> ${SEV[s].label}</li>`).join('')}
  </ul>
</section>

${aiBlock(r.ai)}

<section>
  <h2>What the auditor did</h2>
  <p class="lead">A real browser (Microsoft Edge, emulating a phone) visited the page as if from an ad click, then behaved like a shopper while recording every message sent to analytics and ad platforms.</p>
  <div class="journey">
    <ol class="steps">${r.steps.map(s => `<li class="${s.ok ? 'ok' : 'skip'}"><span>${s.ok ? '✓' : '–'}</span><div>${esc(s.label)}${s.notes.length ? `<small>${esc(s.notes.join(' '))}</small>` : ''}</div></li>`).join('')}</ol>
    ${r.screenshot ? `<figure><img alt="The landing page as the auditor saw it" src="data:image/jpeg;base64,${r.screenshot}"><figcaption>First screen a paid visitor sees</figcaption></figure>` : ''}
  </div>
  ${r.product ? `<p class="note">Product: <b>${esc(r.product.title)}</b> · ${inr(r.product.price)} · size tested: ${esc(r.chosenVariant?.title || '—')}</p>` : ''}
</section>

<section>
  <h2>Did each platform hear about each step?</h2>
  <p class="lead">Each cell counts how many times a platform was told about that shopper action. <b>1</b> is right. <b>0</b> means it was missed; <b>2+</b> means it was counted more than once. <b>—</b> means that account only collects page views.</p>
  ${matrix(r)}
</section>

<section>
  <h2>Issues to fix <span class="sub">${issues.length}</span></h2>
  ${issues.length ? issues.map(card).join('') : '<p>No issues found.</p>'}
</section>

<section>
  <h2>What passed <span class="sub">${passes.length}</span></h2>
  <ul class="passes">${passes.map(f => `<li><span>✓</span>${esc(f.title)}<em>${esc(f.category)}</em></li>`).join('')}</ul>
</section>

<section class="appendix">
  <h2>Appendix</h2>
  <details><summary>Tracking IDs installed on the page</summary>
    <table><tr><th>Platform</th><th>IDs</th></tr>
    <tr><td>Google Tag Manager</td><td>${esc(r.installed.gtm.join(', ') || '—')}</td></tr>
    <tr><td>Google Analytics 4</td><td>${esc(r.installed.ga4.join(', ') || '—')}</td></tr>
    <tr><td>Google Ads</td><td>${esc(r.installed.gads.join(', ') || '—')}</td></tr>
    <tr><td>Meta Pixel</td><td>${esc(r.installed.meta.join(', ') || '—')}</td></tr></table>
  </details>
  <details><summary>Third-party services (${r.inventory.length})</summary>
    <table><tr><th>Domain</th><th>Service</th><th>Requests</th><th>Errors</th></tr>
    ${r.inventory.map(h => `<tr><td>${esc(h.host)}</td><td>${esc(h.vendor || 'Unidentified')}</td><td>${h.requests}</td><td>${h.failed || ''}</td></tr>`).join('')}</table>
  </details>
  <details><summary>Every decoded tracking event (${r.events.length})</summary>
    <table><tr><th>Step</th><th>Platform</th><th>Account</th><th>Event</th><th>Value</th></tr>
    ${r.events.map(e => `<tr><td>${esc(stepLabel(r, e.step))}</td><td>${esc(e.vendor)}</td><td>${esc(e.destination)}${e.label ? `<br><small>${esc(e.label)}</small>` : ''}</td><td>${esc(e.event)}</td><td>${e.value != null ? esc(e.value + ' ' + (e.currency || '')) : ''}</td></tr>`).join('')}</table>
  </details>
  <p class="note">How to read severities: ${['blocker', 'high', 'medium', 'low'].map(s => `<b>${SEV[s].label}</b> — ${SEV[s].hint}`).join('; ')}. "Needs confirmation" means the browser proves what happens, but only someone with access to the ad account can confirm whether it is intended.</p>
</section>
</main></body></html>`;
}

function aiBlock(ai) {
  if (!ai) return '';
  if (ai.error) return `<section class="ai muted"><p>${esc(ai.error)}</p></section>`;
  const names = (ai.event_name_review || []).filter(x => x.looks_like && x.looks_like !== 'none');
  return `<section class="ai">
  <p class="eyebrow">AI-written summary · ${esc(ai.model)} · based only on the findings below</p>
  <p>${esc(ai.executive_summary)}</p>
  ${ai.top_actions?.length ? `<h3>Do these first</h3><ol>${ai.top_actions.map(a => `<li><b>${esc(a.action)}</b> — ${esc(a.why)}</li>`).join('')}</ol>` : ''}
  ${names.length ? `<h3>Custom events that look like duplicates (AI suggestion — verify)</h3><ul>${names.map(n => `<li><code>${esc(n.event)}</code> (${esc(n.platform)}) ≈ <code>${esc(n.looks_like)}</code> — ${esc(n.note)}</li>`).join('')}</ul>` : ''}
</section>`;
}

function matrix(r) {
  // Columns: every account that received a funnel event, grouped by platform.
  const cols = [];
  for (const key of Object.keys(PLATFORMS)) {
    const dests = [...new Set(r.events.filter(e => e.platform === key && (e.event === PLATFORMS[key].pageView || funnelOf(r).some(f => f[key] === e.event))).map(e => e.destination))];
    // An account that never receives a shopping event is a page-view-only setup, not a failure.
    for (const d of dests) cols.push({ key, d, funnel: r.events.some(e => e.platform === key && e.destination === d && funnelOf(r).some(f => f[key] === e.event)) });
  }
  if (!cols.length) return '<p>No analytics or ad platform events were observed.</p>';
  const rows = [
    { label: 'Page viewed', step: 'landing', name: k => PLATFORMS[k].pageView, pageView: true },
    ...funnelOf(r).map(f => ({ label: f.label, step: f.step, name: k => f[k] })),
  ];
  const ran = s => r.steps.some(x => x.name === s && x.ok);
  const virtual = r.events.filter(e => e.event === PLATFORMS[e.platform]?.pageView && e.step !== 'landing' && !r.realLoadSteps.includes(e.step));
  const cell = (n, c, isPageView) => (!n && !isPageView && !c.funnel)
    ? '<td class="na" title="This account only receives page views">—</td>'
    : `<td class="${n === 1 ? 'ok' : n === 0 ? 'miss' : 'dup'}">${n === 1 ? '✓' : n === 0 ? '✗ 0' : '⚠ ' + n}</td>`;
  return `<div class="scroll"><table class="matrix">
  <tr><th></th>${cols.map(c => `<th>${esc(PLATFORMS[c.key].name)}<small>${esc(c.d)}</small></th>`).join('')}</tr>
  ${rows.filter(row => ran(row.step)).map(row => `<tr><th>${esc(row.label)}</th>${cols.map(c => cell(r.events.filter(e => e.platform === c.key && e.destination === c.d && e.step === row.step && e.event === row.name(c.key)).length, c, row.pageView)).join('')}</tr>`).join('')}
  ${virtual.length ? `<tr class="extra"><th>Extra page views<small>no new page loaded</small></th>${cols.map(c => { const n = virtual.filter(e => e.platform === c.key && e.destination === c.d).length; return `<td class="${n ? 'dup' : 'ok'}">${n ? '⚠ ' + n : '—'}</td>`; }).join('')}</tr>` : ''}
  </table></div>`;
}

function card(f) {
  return `<article class="card s-${f.severity}">
  <div class="tags"><span class="pill p-${f.severity}">${SEV[f.severity].label}</span><span>${esc(f.category)}</span><span>Owner: ${esc(f.owner)}</span>${f.confidence !== 'confirmed' ? '<span class="confirm">Needs confirmation</span>' : ''}</div>
  <h3>${esc(f.title)}</h3>
  ${f.finding ? `<p><b>What we saw.</b> ${esc(f.finding)}</p>` : ''}
  ${f.impact ? `<p><b>Why it matters.</b> ${esc(f.impact)}</p>` : ''}
  ${f.action ? `<p><b>What to do.</b> ${esc(f.action)}</p>` : ''}
  ${f.evidence?.length ? `<details><summary>Evidence</summary><ul class="ev">${f.evidence.map(e => `<li><code>${esc(e)}</code></li>`).join('')}</ul></details>` : ''}
</article>`;
}

function stepLabel(r, name) { return r.steps.find(s => s.name === name)?.label || name; }

const CSS = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e4e2dc;
--blocker:#b42318;--high:#c4320a;--medium:#b54708;--low:#475467;--pass:#067647;
--blocker-bg:#fef3f2;--high-bg:#fff4ed;--medium-bg:#fffaeb;--low-bg:#f2f4f7;--pass-bg:#ecfdf3}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe7;--muted:#a3a29c;--line:#33322f;
--blocker:#f97066;--high:#fb8a5c;--medium:#fdb022;--low:#98a2b3;--pass:#47cd89;
--blocker-bg:#3a1714;--high-bg:#3a1f12;--medium-bg:#352a10;--low-bg:#262a31;--pass-bg:#11301f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
a{color:inherit}h1{font-size:26px;line-height:1.25;margin:4px 0 8px}h2{font-size:19px;margin:0 0 6px}h3{font-size:16px;margin:6px 0}
.eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0}
.meta,.lead,.note{color:var(--muted)}.meta a{word-break:break-all}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
header{margin-bottom:8px}.sub{color:var(--muted);font-weight:400}
.verdict{border-width:2px}.verdict-label{font-size:22px;font-weight:700}
.v-not-ready{border-color:var(--blocker);background:var(--blocker-bg)}.v-not-ready .verdict-label{color:var(--blocker)}
.v-fix-first{border-color:var(--high);background:var(--high-bg)}.v-fix-first .verdict-label{color:var(--high)}
.v-ready-caveats{border-color:var(--medium);background:var(--medium-bg)}.v-ready-caveats .verdict-label{color:var(--medium)}
.v-ready{border-color:var(--pass);background:var(--pass-bg)}.v-ready .verdict-label{color:var(--pass)}
.counts{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:12px 0 0}
.counts li{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px}
.counts b{font-size:16px}.c-blocker b{color:var(--blocker)}.c-high b{color:var(--high)}.c-medium b{color:var(--medium)}.c-low b{color:var(--low)}.c-pass b{color:var(--pass)}
.ai{border-left:4px solid var(--low)}.ai.muted{color:var(--muted)}.ai ol,.ai ul{padding-left:20px}
.journey{display:grid;grid-template-columns:1fr 220px;gap:20px;align-items:start}
.steps{list-style:none;padding:0;margin:0}.steps li{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}
.steps li>span{width:20px;font-weight:700;color:var(--pass)}.steps li.skip>span{color:var(--muted)}
.steps small{display:block;color:var(--muted)}
figure{margin:0}figure img{width:100%;border-radius:10px;border:1px solid var(--line)}figcaption{font-size:12px;color:var(--muted);text-align:center}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
th small,td small{display:block;color:var(--muted);font-weight:400;word-break:break-all}
.matrix td{text-align:center;font-weight:600;white-space:nowrap}
.matrix td.ok{color:var(--pass);background:var(--pass-bg)}.matrix td.miss{color:var(--blocker);background:var(--blocker-bg)}.matrix td.na{color:var(--muted)}.matrix td.dup{color:var(--medium);background:var(--medium-bg)}
.card{border:1px solid var(--line);border-left:4px solid;border-radius:10px;padding:14px 16px;margin:12px 0}
.card p{margin:6px 0}.s-blocker{border-left-color:var(--blocker)}.s-high{border-left-color:var(--high)}.s-medium{border-left-color:var(--medium)}.s-low{border-left-color:var(--low)}
.tags{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--muted)}
.tags span{border:1px solid var(--line);border-radius:999px;padding:1px 9px}
.pill{font-weight:700;border:none!important}.p-blocker{background:var(--blocker-bg);color:var(--blocker)}.p-high{background:var(--high-bg);color:var(--high)}.p-medium{background:var(--medium-bg);color:var(--medium)}.p-low{background:var(--low-bg);color:var(--low)}
.confirm{border-style:dashed!important}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
.ev{padding-left:18px}code{font:12px ui-monospace,Consolas,monospace;word-break:break-all}
.passes{list-style:none;padding:0;margin:0}.passes li{padding:6px 0;border-bottom:1px solid var(--line)}
.passes span{color:var(--pass);font-weight:700;margin-right:8px}.passes em{color:var(--muted);font-style:normal;font-size:12px;margin-left:8px}
.appendix table{margin-top:8px}
@media (max-width:640px){.journey{grid-template-columns:1fr}figure{max-width:240px}h1{font-size:21px}}
`;
