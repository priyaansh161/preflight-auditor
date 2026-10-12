# Landing Page Pre-Flight Auditor

Before ad money goes behind a landing page, this tool opens the page in a **real browser**, behaves like a shopper arriving from an ad, and checks that every analytics and ad tag reports what actually happened: once, with the right price, and with the click credited to the right ad. It ends with a plain-English report and a verdict: *Ready*, *Ready with caveats*, *Fix tracking first*, or *Not ready*.

- **Sample reports (Neeman's):** [`reports/sample-product/report.html`](reports/sample-product/report.html) · [`reports/sample-collection/report.html`](reports/sample-collection/report.html) (Markdown versions sit alongside them)
- **Approach, assumptions, trade-offs, and where the LLM fits:** [`NOTE.md`](NOTE.md)

## What it does

```
Real browser (Edge/Chrome, phone emulation)
  1  Land from a simulated ad click   (UTMs + test gclid/fbclid on the URL)
  2  Scroll the page
  3  Tap "Add to cart" with no size   (should NOT report a conversion)
  4  Choose an in-stock size          (ground truth from Shopify's product JSON)
  5  Add to cart, confirm the cart really changed
  6  Start checkout                   (never places an order)
        │  every network request, every dataLayer push, console errors, Core Web Vitals
        ▼
Decoders   GA4 · Google Ads · Meta Pixel · Snap  → one normalised event list
        ▼
~25 deterministic checks in 6 groups → findings with severity, owner, fix
        ▼
Verdict (rule-based) → report.html / report.md / report.json  (+ optional AI summary)
```

On a collection page it first checks the listing's own tracking, then taps the first product and continues the same journey.

## Quick start

Requires **Node 22+** and **Microsoft Edge or Google Chrome** installed (it drives your installed browser, so there's no 300 MB browser download).

```bash
npm install
node src/cli.mjs https://neemans.com/products/adaptis-sneakers-for-men-beige
```

The report is written to `reports/<host>-<time>/report.html`. Open it in any browser.

| Option | What it does |
|---|---|
| `--desktop` | Audit as a desktop visitor (default is mobile, where most paid social traffic lands) |
| `--explain` | Add an AI-written executive summary (needs `ANTHROPIC_API_KEY`); the audit is complete without it |
| `--live` | Let tracking hits reach the real platforms. The default **safe mode** captures each hit but answers it locally, so audits never pollute the client's analytics or ad optimisation |
| `--headed` | Show the browser while it works |
| `--browser chrome` | Use Chrome instead of Edge (`chromium` after `npx playwright install chromium` on Linux/macOS) |
| `--replay <dir>/evidence.json` | Re-run every check on saved evidence without opening a browser |
| `--out <dir>` | Output folder |

Exit code is `2` when the verdict is *Not ready*, so it can gate a CI/CD or launch checklist.

```bash
npm test          # decoder + rule tests, no browser needed
```

## Output

- **report.html**: for a marketing lead. Verdict, a "did each platform hear about each step" grid, issues ranked by severity (each with *what we saw / why it matters / what to do / owner*), passed checks, and an appendix of tag IDs, vendors and every decoded event.
- **report.md**: the same findings as text, to paste into Slack or Jira.
- **report.json**: machine-readable, for dashboards or diffing two audits.
- **evidence.json**: everything the browser observed, so a report can be reproduced or re-checked after a rule changes.

## Layout

```
src/
  cli.mjs              command line
  audit.mjs            collect() = browser · analyse() = pure checks + verdict
  session.mjs          Playwright journey + recording (no judgement here)
  decoders/index.mjs   wire formats → normalised events; vendor inventory
  checks/index.mjs     every rule, one function each
  checks/util.mjs      severities, funnel definition, shared vocabulary
  llm.mjs              optional Claude summary (structured output, cannot change the verdict)
  report/html.mjs      stakeholder report
  report/markdown.mjs  text report
test/                  node:test suites for decoders and rules
reports/               sample audits of neemans.com
```
