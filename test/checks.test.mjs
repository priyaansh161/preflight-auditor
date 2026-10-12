// Rule tests on small hand-built evidence. Each one pins a judgement the auditor makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/checks/index.mjs';
import { verdictOf } from '../src/audit.mjs';

// Minimal evidence for a product page where every journey step succeeded.
function baseEv(over = {}) {
  const variant = { id: 2, title: 'UK 7', price: 449900, available: true, options: ['UK 7'], sku: 'SKU-7' };
  return {
    url: 'https://shop.test/products/shoe', device: 'mobile',
    landing: { status: 200, finalUrl: 'https://shop.test/products/shoe?utm_source=preflight&utm_medium=audit&utm_campaign=preflight_test&gclid=PREFLIGHT_TEST_GCLID&fbclid=PREFLIGHT_TEST_FBCLID', redirects: [] },
    steps: ['landing', 'scroll', 'atc_no_size', 'select_variant', 'add_to_cart', 'begin_checkout'].map(name => ({ name, label: name, ok: true, notes: [] })),
    product: { id: 1, price: 449900, variants: [variant] }, chosenVariant: variant, productStep: 'landing', pageType: 'product',
    cartBefore: { item_count: 0 }, cartAfterNoSize: { item_count: 0 }, cartAfter: { item_count: 1, items: [{ variant_id: 2 }] },
    navigations: [{ step: 'landing' }], requests: [], console: [], pageErrors: [],
    dataLayer: [{ data: { 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'denied' } } }, { data: { 0: 'consent', 1: 'update', 2: { ad_storage: 'granted', analytics_storage: 'granted' } } }],
    cookies: [{ name: '_gcl_aw', value: 'GCL.1.PREFLIGHT_TEST_GCLID' }, { name: '_fbc', value: 'fb.1.1.PREFLIGHT_TEST_FBCLID' }],
    vitals: { lcp: 1500, cls: 0.02 },
    ...over,
  };
}
const ev = (platform, destination, event, step, extra = {}) => ({ platform, vendor: platform, destination, event, step, value: 4499, currency: 'INR', items: [{ id: '1' }], eventId: 'x', ...extra });
const clean = [
  ev('ga4', 'G-1', 'page_view', 'landing', { pageLocation: 'https://shop.test/products/shoe?utm_source=preflight', items: [] }),
  ev('meta', 'P1', 'PageView', 'landing'), ev('gads', 'AW-1', 'page_view', 'landing'),
  ...[['view_item', 'ViewContent', 'landing'], ['add_to_cart', 'AddToCart', 'add_to_cart'], ['begin_checkout', 'InitiateCheckout', 'begin_checkout']]
    .flatMap(([g, m, s]) => [ev('ga4', 'G-1', g, s), ev('meta', 'P1', m, s), ev('gads', 'AW-1', g, s)]),
];
const run = (evidence, events) => runChecks({ ev: evidence, events, inv: [], installed: { gtm: [], ga4: [], gads: [], meta: [] } });
const issues = fs => fs.filter(f => f.severity !== 'pass');

test('a clean implementation produces no issues and a READY verdict', () => {
  const fs = run(baseEv(), clean);
  assert.deepEqual(issues(fs).map(f => f.id), []);
  assert.equal(verdictOf(fs).level, 'ready');
});

test('the same conversion sent twice to one account is a high-severity duplicate', () => {
  const fs = run(baseEv(), [...clean, ev('ga4', 'G-1', 'add_to_cart', 'add_to_cart')]);
  const d = fs.find(f => f.id === 'dupe-ga4-add_to_cart-add_to_cart');
  assert.equal(d?.severity, 'high');
});

test('add-to-cart reported when the store rejected the add is a phantom conversion', () => {
  const fs = run(baseEv(), [...clean, ev('meta', 'P1', 'AddToCart', 'atc_no_size')]);
  assert.equal(fs.find(f => f.id === 'phantom')?.severity, 'high');
});

test('page views with no real page load are flagged as virtual', () => {
  const fs = run(baseEv(), [...clean, ev('ga4', 'G-1', 'page_view', 'select_variant', { items: [] })]);
  assert.equal(fs.find(f => f.id === 'virtual-pv')?.severity, 'medium');
});

test('a value that differs from the store price is high severity', () => {
  const events = clean.map(e => (e.platform === 'meta' && e.event === 'AddToCart' ? { ...e, value: 449900 } : e));
  assert.ok(run(baseEv(), events).some(f => f.id === 'value-meta-add_to_cart' && f.severity === 'high'));
});

test('a same-site redirect is low; a redirect to the homepage is a blocker', () => {
  const moved = baseEv({ url: 'https://shop.test/products/old', landing: { status: 200, finalUrl: 'https://shop.test/products/shoe', redirects: ['https://shop.test/products/old'] } });
  assert.equal(run(moved, clean).find(f => f.id === 'page-loads').severity, 'low');
  const home = baseEv({ landing: { status: 200, finalUrl: 'https://shop.test/', redirects: [] } });
  assert.equal(run(home, clean).find(f => f.id === 'page-loads').severity, 'blocker');
});

test('a stripped click ID breaks attribution', () => {
  const fs = run(baseEv({ cookies: [] }), clean);
  assert.equal(fs.find(f => f.id === 'gclid').severity, 'high');
  assert.equal(fs.find(f => f.id === 'fbclid').severity, 'high');
});

test('if the auditor could not select a size, tags are not blamed for missing events', () => {
  const evd = baseEv({ cartAfter: { item_count: 0, items: [] } });
  evd.steps.find(s => s.name === 'select_variant').ok = false;
  evd.steps.find(s => s.name === 'select_variant').notes.push('could not select');
  const fs = run(evd, clean.filter(e => e.step !== 'add_to_cart'));
  assert.equal(fs.find(f => f.id === 'atc-works').severity, 'low');
});
