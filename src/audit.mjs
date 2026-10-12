// Orchestrates one audit: browser session → decode → checks → verdict (→ optional LLM summary).
// collect() needs a browser; analyse() is pure, so saved evidence can be re-checked offline.
import { runSession } from './session.mjs';
import { decode, inventory, installedIds } from './decoders/index.mjs';
import { runChecks } from './checks/index.mjs';
import { SEVERITY } from './checks/util.mjs';

// The verdict is a rule, not a score: one blocker means don't spend.
export function verdictOf(findings) {
  const n = s => findings.filter(f => f.severity === s).length;
  if (n('blocker')) return { level: 'not-ready', label: 'Not ready for paid traffic', summary: `${n('blocker')} blocker${n('blocker') > 1 ? 's' : ''}: shoppers or tracking would fail. Fix before spending.` };
  if (n('high')) return { level: 'fix-first', label: 'Works for shoppers, but tracking needs fixes', summary: `The page sells, but ${n('high')} high-severity tracking issue${n('high') > 1 ? 's' : ''} mean ad platforms would get wrong numbers. Fix (or confirm) these before scaling spend.` };
  if (n('medium')) return { level: 'ready-caveats', label: 'Ready, with caveats', summary: 'Safe to launch. Clean up the medium items so reporting stays trustworthy.' };
  return { level: 'ready', label: 'Ready for paid traffic', summary: 'Every check passed.' };
}

export async function collect({ url, device, live, headed, channel, log = () => {} }) {
  log(`Opening ${url} in a real browser (${device}${live ? ', LIVE beacons' : ', safe mode'})`);
  return runSession({ url, device, live, headed, channel, log });
}

export async function analyse(ev, { explainWithLLM = false, log = () => {} } = {}) {
  const url = ev.url;
  const events = decode(ev.requests);
  const inv = inventory(ev.requests, new URL(url).host);
  const installed = installedIds(ev.requests);

  log('Running checks');
  const findings = runChecks({ ev, events, inv, installed })
    .sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity));
  const verdict = verdictOf(findings);

  let ai = null;
  if (explainWithLLM) {
    if (!process.env.ANTHROPIC_API_KEY) ai = { error: 'AI summary skipped: set ANTHROPIC_API_KEY to add it.' };
    else {
      log('Asking Claude for the plain-English summary');
      const { explain } = await import('./llm.mjs');
      try { ai = await explain({ verdict, findings, events, page: { title: ev.page?.title, url } }); }
      catch (e) { ai = { error: `AI summary unavailable: ${e.message}` }; }
    }
  }

  return {
    meta: { url, device: ev.device, live: ev.live, startedAt: ev.startedAt, finishedAt: ev.finishedAt, auditor: 'preflight-auditor 1.0' },
    verdict, findings, ai,
    page: ev.page, product: ev.product && { id: ev.product.id, title: ev.product.title, price: ev.product.price / 100, variants: ev.product.variants.length },
    chosenVariant: ev.chosenVariant && { id: ev.chosenVariant.id, title: ev.chosenVariant.title, price: ev.chosenVariant.price / 100 },
    steps: ev.steps, vitals: ev.vitals, landing: ev.landing,
    realLoadSteps: [...new Set(ev.navigations.map(n => n.step))],
    pageType: ev.pageType, productStep: ev.productStep, productUrl: ev.productUrl || null,
    installed, inventory: inv,
    events: events.map(({ url, dedupeKey, ...e }) => e),
    screenshot: ev.screenshot,
    raw: { requestCount: ev.requests.length, console: ev.console, pageErrors: ev.pageErrors },
  };
}
