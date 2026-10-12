// Shared vocabulary for checks.

export const SEVERITY = ['blocker', 'high', 'medium', 'low', 'pass'];

export const CATEGORIES = {
  page: 'Page & shopper experience',
  tags: 'Tags present & firing',
  dupes: 'Double counting',
  data: 'Data accuracy',
  attribution: 'Attribution (who gets credit)',
  consent: 'Privacy & consent',
};

// The three platforms that decide ad spend. Everything else is inventoried, not judged.
export const PLATFORMS = {
  ga4: { name: 'Google Analytics 4', pageView: 'page_view' },
  meta: { name: 'Meta Pixel', pageView: 'PageView' },
  gads: { name: 'Google Ads', pageView: 'page_view' },
};

// The shopper funnel, in each platform's own event names, and the journey step that should trigger it.
export const FUNNEL = [
  { key: 'view_item', label: 'Product viewed', doing: 'viewed the product', step: 'landing', ga4: 'view_item', meta: 'ViewContent', gads: 'view_item' },
  { key: 'add_to_cart', label: 'Added to cart', doing: 'added to cart', step: 'add_to_cart', ga4: 'add_to_cart', meta: 'AddToCart', gads: 'add_to_cart' },
  { key: 'begin_checkout', label: 'Checkout started', doing: 'started checkout', step: 'begin_checkout', ga4: 'begin_checkout', meta: 'InitiateCheckout', gads: 'begin_checkout' },
];

export const finding = f => ({ confidence: 'confirmed', evidence: [], owner: 'Developer', ...f });

export const inr = n => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));

export const countBy = (arr, keyFn) => arr.reduce((m, x) => m.set(keyFn(x), (m.get(keyFn(x)) || 0) + 1), new Map());

// On a collection page the product is viewed after tapping through, not on landing.
export const funnelOf = ev => FUNNEL.map(f => (f.key === 'view_item' ? { ...f, step: ev.productStep || 'landing' } : f));
