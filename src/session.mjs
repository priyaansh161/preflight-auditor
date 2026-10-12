// Drives a real browser through a shopper journey and records everything observable.
// Nothing here judges the page — it only collects evidence. Judgement lives in src/checks/.
import { chromium, devices } from 'playwright-core';
import { isBeacon } from './decoders/index.mjs';

// Marker values appended to the landing URL. They let the attribution checks prove that
// click IDs and UTMs survive the landing and reach the tags, without using a real ad click.
export const TEST_PARAMS = {
  utm_source: 'preflight',
  utm_medium: 'audit',
  utm_campaign: 'preflight_test',
  gclid: 'PREFLIGHT_TEST_GCLID',
  fbclid: 'PREFLIGHT_TEST_FBCLID',
};

const QUIET_MS = 2500;      // a step is "done" once no tracking beacon has fired for this long
const STEP_MAX_MS = 15000;  // ...or after this long, whichever comes first

// Runs inside the page before any site script: timestamps every dataLayer push and
// collects Core Web Vitals, so we see the site's own intent, not just what reached vendors.
const INIT_SCRIPT = () => {
  window.__pf = { dl: [], lcp: null, cls: 0 };
  const wrap = arr => {
    if (arr.__pfWrapped) return arr;
    const push = arr.push;
    arr.push = function (...items) {
      for (const it of items) {
        try { window.__pf.dl.push({ t: Date.now(), data: JSON.parse(JSON.stringify(it, (k, v) => (v instanceof Element ? undefined : v))) }); }
        catch { window.__pf.dl.push({ t: Date.now(), data: String(it) }); }
      }
      return push.apply(this, items);
    };
    arr.__pfWrapped = true;
    return arr;
  };
  let dl = wrap(window.dataLayer || []);
  Object.defineProperty(window, 'dataLayer', { configurable: true, get: () => dl, set: v => { dl = wrap(v); } });
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__pf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__pf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
};

// Where the audit runs from matters: some stores load extra tags only for local visitors
// (on neemans.com a second GTM container with a second Meta pixel appears from India but
// not from a US server). Recorded so the report can say what kind of visitor it simulated.
async function vantage() {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(5000) });
    const kv = Object.fromEntries((await res.text()).trim().split('\n').map(l => l.split('=')));
    return { country: kv.loc || null };
  } catch { return { country: null }; }
}

export async function runSession({ url, device = 'mobile', live = false, headed = false, channel = 'msedge', log = () => {} }) {
  const from = await vantage();
  // 'chromium' = Playwright's own build (npx playwright install chromium); otherwise an installed Edge/Chrome.
  const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: !headed });
  const profile = device === 'desktop' ? { viewport: { width: 1366, height: 850 } } : devices['Pixel 7'];
  const context = await browser.newContext({ ...profile, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  await context.addInitScript(INIT_SCRIPT);

  const ev = {
    startedAt: new Date().toISOString(), device, live, url, vantage: from,
    steps: [], requests: [], console: [], pageErrors: [], failed: [],
  };
  let step = 'landing';
  let lastBeacon = Date.now();

  // Context-level listener: also sees requests from sandboxed iframes (Shopify web pixels
  // run Meta/Snap inside an about:blank sandbox that a page-level listener misses).
  context.on('request', r => {
    const rec = { id: ev.requests.length, step, t: Date.now(), url: r.url(), method: r.method(), type: r.resourceType(), post: safe(() => r.postData()) || null, status: null };
    r.__pf = rec;
    ev.requests.push(rec);
    if (isBeacon(rec.url)) lastBeacon = rec.t;
  });
  context.on('response', res => { const rec = res.request().__pf; if (rec) rec.status = res.status(); });
  context.on('requestfailed', r => { const rec = r.__pf; if (rec) ev.failed.push({ url: rec.url, step: rec.step, error: r.failure()?.errorText }); });

  // Safe mode: answer tracking beacons locally so the audit never pollutes the client's
  // production analytics or ad optimisation. The browser still builds and sends each beacon,
  // which is the thing being audited. --live lets them through to the real vendors.
  if (!live) await context.route(u => isBeacon(u.toString()), route => route.fulfill({ status: 204, body: '' }));

  const page = await context.newPage();
  // Real page loads only (a new document requested by the top frame). A theme that rewrites the
  // address bar with history.replaceState does NOT appear here — that is how genuine page views
  // are told apart from virtual ones.
  ev.navigations = [];
  page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) ev.navigations.push({ step, t: Date.now(), url: r.url() }); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') ev.console.push({ step, type: m.type(), text: m.text().slice(0, 400) }); });
  page.on('pageerror', e => ev.pageErrors.push({ step, text: String(e.message || e).slice(0, 400) }));

  // minMs: some steps hand off to slow third parties (GoKwik checkout fires its events
  // 5-10s after the click), and a short quiet window would wrongly report them missing.
  const settle = async (minMs = 1200) => {
    const start = Date.now();
    await page.waitForTimeout(minMs);
    while (Date.now() - start < STEP_MAX_MS + minMs && Date.now() - lastBeacon < QUIET_MS) await page.waitForTimeout(400);
  };
  const begin = (name, label) => { step = name; const s = { name, label, startedAt: Date.now(), ok: true, notes: [] }; ev.steps.push(s); log(`  - ${label}`); return s; };
  const cartJs = () => page.evaluate(() => fetch('/cart.js', { headers: { accept: 'application/json' } }).then(r => r.json()).catch(() => null));

  try {
    // 1. Landing — as if arriving from an ad click.
    const s1 = begin('landing', 'Landing from a simulated ad click');
    const landingUrl = withParams(url, TEST_PARAMS);
    const nav = await page.goto(landingUrl, { waitUntil: 'load', timeout: 60000 });
    ev.landing = {
      requestedUrl: landingUrl, finalUrl: page.url(), status: nav?.status() ?? null,
      redirects: chainOf(nav?.request()),
    };
    await settle();
    ev.screenshot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
    ev.page = await page.evaluate(() => ({
      title: document.title,
      canonical: document.querySelector('link[rel=canonical]')?.href || null,
      robots: document.querySelector('meta[name=robots]')?.content || null,
      shopify: !!window.Shopify, theme: window.Shopify?.theme?.name || null,
      productHandle: (location.pathname.match(/\/products\/([^/?#]+)/) || [])[1] || null,
      nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; })(),
    }));
    if (ev.page.productHandle) {
      ev.product = await page.evaluate(h => fetch(`/products/${h}.js`).then(r => r.json()).catch(() => null), ev.page.productHandle);
    }
    s1.endedAt = Date.now();

    // 2. Engagement — scroll the page like a reader, which triggers lazy-loaded tags.
    const s2 = begin('scroll', 'Scrolling through the page');
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(350); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle();
    s2.endedAt = Date.now();

    // Collection (listing) pages: tap the first product and continue the journey from there.
    ev.pageType = ev.product ? 'product' : /\/collections\//.test(new URL(page.url()).pathname) ? 'collection' : 'other';
    ev.productStep = 'landing';
    if (!ev.product && ev.page.shopify) {
      const s = begin('open_product', 'Tapping the first product in the list');
      const link = page.locator('main a[href*="/products/"]:visible, a[href*="/products/"]:visible').first();
      if (await link.count()) {
        await link.scrollIntoViewIfNeeded().catch(() => {});
        await link.click({ timeout: 5000 }).catch(() => {});
        await page.waitForURL(/\/products\//, { timeout: 20000, waitUntil: 'load' }).catch(() => {});
        await settle();
        const handle = (new URL(page.url()).pathname.match(/\/products\/([^/?#]+)/) || [])[1];
        if (handle) {
          ev.product = await page.evaluate(h => fetch(`/products/${h}.js`).then(r => r.json()).catch(() => null), handle);
          ev.productStep = 'open_product';
          ev.productUrl = page.url();
          s.notes.push(`Opened ${ev.product?.title || handle}.`);
        } else { s.ok = false; s.notes.push('Tapping the product did not open a product page.'); }
      } else { s.ok = false; s.notes.push('No product links found on the page.'); }
      s.endedAt = Date.now();
    }

    const isShopifyPdp = ev.page.shopify && ev.product;
    if (!isShopifyPdp) {
      const s = begin('journey_skipped', 'Shopper journey skipped (no Shopify product page reached)');
      s.ok = false; s.notes.push('Interaction checks need a product page; page-load checks still ran.');
      s.endedAt = Date.now();
    } else {
      ev.cartBefore = await cartJs();

      // 3. Add to cart with NO size chosen — a real shopper mistake. The add should be
      //    rejected, and no tag should report a conversion that never happened.
      const s3 = begin('atc_no_size', 'Tapping "Add to cart" before choosing a size');
      // Only the form whose Add to cart button the shopper can see matters (themes keep hidden copies).
      const pre = await page.evaluate(() => [...document.querySelectorAll('form[action*="/cart/add"]')]
        .filter(f => [...f.querySelectorAll('button[type=submit]')].some(b => b.getClientRects().length))
        .map(f => f.querySelector('input[name=id]')?.value));
      ev.sizePreselected = pre.some(v => v);
      if (ev.sizePreselected) { s3.ok = false; s3.notes.push('A size is pre-selected on load, so this test does not apply.'); }
      else if (!(await clickAddToCart(page))) { s3.ok = false; s3.notes.push('Could not find a visible Add to cart button.'); }
      await settle();
      ev.cartAfterNoSize = await cartJs();
      await dismissOverlays(page);
      s3.endedAt = Date.now();

      // 4. Choose the first size that is actually in stock (ground truth from Shopify).
      const s4 = begin('select_variant', 'Choosing an in-stock size');
      const variant = ev.product.variants.find(v => v.available);
      ev.chosenVariant = variant || null;
      if (!variant) { s4.ok = false; s4.notes.push('No size is in stock.'); }
      else {
        const picked = await pickVariant(page, variant);
        if (!picked) { s4.ok = false; s4.notes.push(`Could not select "${variant.title}" on the page.`); }
      }
      await settle();
      s4.endedAt = Date.now();

      // 5. Add to cart for real, then confirm the cart actually changed.
      const s5 = begin('add_to_cart', 'Adding the item to the cart');
      if (!(await clickAddToCart(page))) { s5.ok = false; s5.notes.push('Could not find a visible Add to cart button.'); }
      await settle();
      ev.cartAfter = await cartJs();
      s5.endedAt = Date.now();

      // 6. Start checkout (stops at the checkout screen — no order is ever placed).
      const s6 = begin('begin_checkout', 'Starting checkout (no order placed)');
      const clicked = await clickCheckout(page);
      if (!clicked) { s6.ok = false; s6.notes.push('No visible checkout button found after adding to cart.'); }
      await settle(12000);
      s6.endedAt = Date.now();
    }

    ev.cookies = (await context.cookies()).map(c => ({ name: c.name, value: c.value.slice(0, 200), domain: c.domain }));
    const pf = await page.evaluate(() => window.__pf).catch(() => null);
    ev.dataLayer = pf?.dl || [];
    ev.vitals = { lcp: pf?.lcp ?? null, cls: pf ? Math.round(pf.cls * 1000) / 1000 : null };
  } finally {
    ev.finishedAt = new Date().toISOString();
    await browser.close();
  }
  return ev;
}

// ---------- page interaction helpers (Shopify conventions, tolerant of theme differences) ----------

async function clickAddToCart(page) {
  const btn = page.locator('form[action*="/cart/add"] button[type=submit]:visible, button[name=add]:visible')
    .filter({ hasText: /add to (cart|bag)/i }).first();
  if (!(await btn.count())) return false;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 5000 }).catch(() => btn.evaluate(b => b.click()));
  return true;
}

async function pickVariant(page, variant) {
  // Try each option value of the variant (e.g. "UK 7") as a radio/label/button/select.
  for (const value of variant.options) {
    const done = await page.evaluate(val => {
      // Themes label options differently ("UK 6" in data, "6" on the button), so match on
      // the exact text first, then on the label being one whole word of the option value.
      const words = s => (s || '').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
      const exact = t => words(t).join(' ') === words(val).join(' ');
      const partial = t => { const w = words(t); return w.length > 0 && w.every(x => words(val).includes(x)); };
      const shown = el => !!el && el.getClientRects().length > 0;
      const scope = document.querySelector('variant-picker, variant-radios, variant-selects') || document.querySelector('form[action*="/cart/add"]')?.closest('section') || document;
      const candidates = [
        ...[...scope.querySelectorAll('input[type=radio]')].map(i => ({ el: i.labels?.[0] || i, text: i.value === val ? val : (i.labels?.[0]?.innerText || i.value), target: i })),
        ...[...scope.querySelectorAll('button, [role=radio], [data-value]')].map(b => ({ el: b, text: b.dataset.value || b.innerText, target: b })),
      ].filter(c => shown(c.el) && !c.target.disabled);
      const hit = candidates.find(c => exact(c.text)) || candidates.find(c => partial(c.text));
      if (hit) { hit.el.click(); return true; }
      const sel = [...scope.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === val || exact(o.text)));
      if (sel) { sel.value = [...sel.options].find(o => o.value === val || exact(o.text)).value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      return false;
    }, value);
    if (!done) return false;
    await page.waitForTimeout(400);
  }
  // Confirm the add-to-cart form now carries this variant (themes update it asynchronously).
  return page.waitForFunction(id => [...document.querySelectorAll('form[action*="/cart/add"]')]
    .filter(f => [...f.querySelectorAll('button[type=submit]')].some(b => b.getClientRects().length))
    .some(f => String(f.querySelector('input[name=id]')?.value) === String(id)), variant.id, { timeout: 5000 })
    .then(() => true, () => false);
}

async function clickCheckout(page) {
  // Cart drawers usually open after adding; if not, open the cart page.
  // "Buy now" is deliberately not used: it adds the item a second time, which would muddy
  // the add-to-cart duplicate check.
  let btn = page.locator('button:visible, a:visible, input[type=submit]:visible').filter({ hasText: /check ?out|place order/i }).first();
  if (!(await btn.count())) {
    await page.goto(new URL('/cart', page.url()).href, { waitUntil: 'load' }).catch(() => {});
    btn = page.locator('button:visible, a:visible, input[type=submit]:visible').filter({ hasText: /check ?out/i }).first();
  }
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000, noWaitAfter: true }).catch(() => btn.evaluate(b => b.click()));
  return true;
}

async function dismissOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

function chainOf(req) {
  const chain = [];
  for (let r = req?.redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift(r.url());
  return chain;
}

function safe(fn) { try { return fn(); } catch { return null; } }
