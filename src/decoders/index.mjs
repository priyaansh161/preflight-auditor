// Turns raw network requests into normalised tracking events:
//   { vendor, platform, destination, event, value, currency, items, eventId, dedupeKey, step, t, url }
// Each platform's wire format is decoded deterministically — no guessing.

// Endpoints that carry a tracking "hit" (as opposed to loading a tag's script).
const BEACONS = [
  /^https:\/\/[^/]*(google-analytics\.com|analytics\.google\.com)\/(g|j)\/collect/,
  /^https:\/\/[^/]*\/g\/collect\?.*tid=G-/,                       // GA4 via first-party / server-side endpoint
  /^https:\/\/(www\.)?(googleadservices|google)\.[a-z.]+\/pagead\/(1p-)?(conversion|viewthroughconversion)\//,
  /^https:\/\/googleads\.g\.doubleclick\.net\/pagead\/(viewthroughconversion|conversion)\//,
  /^https:\/\/[^/]*google[^/]*\/(ccm|rmkt)\/(collect|conversion|s\/collect)/,
  /^https:\/\/ad\.doubleclick\.net\/ccm\//,
  /^https:\/\/www\.facebook\.com\/(tr|privacy_sandbox\/pixel\/register\/trigger)/,
  /^https:\/\/tr\d*\.snapchat\.com\/(p|gateway)/,
  /^https:\/\/analytics\.tiktok\.com\/api\/v2\/pixel/,
  /^https:\/\/trc\.taboola\.com\/[^/]+\/log\//,
  /^https:\/\/(sslwidget|gum|widget)\.criteo\.com\/(event|.*\/event)/,
  /^https:\/\/[a-z]\.clarity\.ms\/collect/,
  /^https:\/\/ct\.pinterest\.com\//,
  /^https:\/\/px\.ads\.linkedin\.com\//,
];
export const isBeacon = url => BEACONS.some(re => re.test(url));

// Every third-party host we can name. Unknown hosts are still listed in the report.
const VENDORS = [
  [/google-analytics\.com|analytics\.google\.com/, 'Google Analytics 4'],
  [/googletagmanager\.com/, 'Google Tag Manager'],
  [/googleadservices\.com|googleads\.g\.doubleclick\.net|google\.[a-z.]+\/(pagead|ccm|rmkt)|ad\.doubleclick\.net/, 'Google Ads'],
  [/merchant-center-analytics\.goog/, 'Google Merchant Center'],
  [/facebook\.com|facebook\.net/, 'Meta (Facebook/Instagram)'],
  [/snapchat\.com|sc-static\.net/, 'Snapchat'],
  [/tiktok\.com/, 'TikTok'],
  [/taboola\.com/, 'Taboola'],
  [/criteo\.(com|net)/, 'Criteo'],
  [/clarity\.ms/, 'Microsoft Clarity'],
  [/hotjar\.(com|io)/, 'Hotjar'],
  [/webengage\.(com|co)/, 'WebEngage'],
  [/gokwik\.co/, 'GoKwik (checkout)'],
  [/razorpay\.com/, 'Razorpay'],
  [/snapmint\.com/, 'Snapmint (EMI)'],
  [/inmobi/, 'InMobi'],
  [/trackier\.com/, 'Trackier'],
  [/convertexperiments\.com/, 'Convert (A/B testing)'],
  [/nector\.io/, 'Nector (loyalty)'],
  [/judge\.me/, 'Judge.me (reviews)'],
  [/openai\.com/, 'OpenAI'],
  [/nitrocommerce\.ai/, 'NitroCommerce'],
  [/useunloq\.com/, 'Unloq'],
  [/makehook\.ws/, 'Makehook'],
  [/logisy/, 'Logisy'],
  [/dspcdn\.org/, 'DSP (ad network)'],
  [/pinterest\.com/, 'Pinterest'],
  [/linkedin\.com/, 'LinkedIn'],
  [/shopifysvc\.com|shopify\.com|shop\.app/, 'Shopify'],
  [/typekit\.net|fonts\.(googleapis|gstatic)\.com/, 'Web fonts'],
  [/translate\.(google|googleapis)\.com/, 'Google Translate'],
];
export const vendorOf = host => VENDORS.find(([re]) => re.test(host))?.[1] || null;

// ---------------- decoders ----------------

function ga4(req) {
  const u = new URL(req.url);
  if (!/\/g\/collect$/.test(u.pathname)) return [];
  const shared = u.searchParams;
  const tid = shared.get('tid');
  if (!tid?.startsWith('G-')) return [];
  // GA4 batches several events in one POST body (one per line); a GET carries one in the URL.
  const lines = req.post ? req.post.split(/\r?\n/).filter(Boolean) : [''];
  return lines.map((line, i) => {
    const p = new URLSearchParams(shared);
    for (const [k, v] of new URLSearchParams(line)) p.set(k, v);
    const items = [...p.keys()].filter(k => /^pr\d+$/.test(k)).map(k => parseGa4Item(p.get(k)));
    const value = num(p.get('epn.value') ?? p.get('ep.value'));
    return {
      platform: 'ga4', vendor: 'Google Analytics 4', destination: tid,
      event: p.get('en'), value, currency: p.get('cu') || p.get('ep.currency') || null, items,
      pageLocation: p.get('dl'), eventId: p.get('ep.event_id') || null,
      // _s is GA4's per-session hit counter: the same _s + event = the same hit seen twice.
      dedupeKey: `${tid}|${p.get('sid')}|${p.get('_s')}|${p.get('en')}|${i}`,
      // A raw string value (ep.value) means the number was sent as text.
      valueIsText: p.has('ep.value') && !p.has('epn.value'),
    };
  });
}

function parseGa4Item(s) {
  const o = {};
  for (const part of (s || '').split('~')) { const k = part.slice(0, 2); o[k] = part.slice(2); }
  return { id: o.id || null, name: o.nm || null, price: num(o.pr), variant: o.va || null, quantity: num(o.qt) };
}

function googleAds(req) {
  const u = new URL(req.url);
  const m = u.pathname.match(/\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion)\/(\d+)|\/ccm\/conversion\/(\d+)/);
  if (!m) return [];
  const p = u.searchParams;
  const account = `AW-${m[1] || m[2]}`;
  // One gtag event fans out to several Google endpoints that share the same `random`
  // value; collapsing on it stops the auditor reporting Google's own fan-out as duplicates.
  // Classic GTM "Google Ads Conversion Tracking" tags send en=conversion (or nothing) plus a
  // label; label-less hits without an event name are remarketing pings.
  const en = p.get('en');
  const legacyTag = (!en || en === 'conversion') && !!p.get('label');
  const event = en || (p.get('label') ? 'conversion' : 'remarketing');
  return [{
    platform: 'gads', vendor: 'Google Ads', destination: account,
    event, label: p.get('label'), value: num(p.get('value')), legacyTag,
    currency: p.get('currency_code'), eventId: p.get('evnid') || null,
    dedupeKey: `${account}|${p.get('label')}|${p.get('en')}|${p.get('random')}`,
  }];
}

function meta(req) {
  const u = new URL(req.url);
  if (!/facebook\.com$/.test(u.host) || u.pathname !== '/tr/' && u.pathname !== '/tr') return [];
  const p = new URLSearchParams(u.search);
  // Shopify's web-pixel sandbox POSTs the same fields in the body instead of the URL.
  if (req.post && /(^|&)ev=/.test(req.post)) for (const [k, v] of new URLSearchParams(req.post)) p.set(k, v);
  else if (req.post && /name="ev"/.test(req.post)) for (const [, k, v] of req.post.matchAll(/name="([^"]+)"\r?\n\r?\n([^\r\n]*)/g)) p.set(k, v);
  const ev = p.get('ev');
  if (!ev) return [];
  const pixel = p.get('id');
  const ids = p.get('cd[content_ids]');
  return [{
    platform: 'meta', vendor: 'Meta Pixel', destination: pixel, event: ev,
    value: num(p.get('cd[value]')), currency: p.get('cd[currency]'),
    items: ids ? safeJson(ids, [ids]).map(id => ({ id: String(id) })) : [],
    contentType: p.get('cd[content_type]'), eventId: p.get('eid') || null,
    source: p.get('a') || null,                 // which integration sent it (Shopify app, GTM, ...)
    fbc: p.get('fbc') || null, location: p.get('dl'),
    dedupeKey: `${pixel}|${ev}|${p.get('ts')}|${p.get('ec')}`,
  }];
}

function snap(req) {
  if (!/snapchat\.com\/p$/.test(new URL(req.url).host + new URL(req.url).pathname)) return [];
  const body = safeJson(req.post, null);
  const evs = [].concat(body?.events || body?.e || []);
  const names = evs.map(e => e?.ev || e?.event_type || e?.n).filter(Boolean);
  // Snap's v3 payload is opaque for most event types; we record presence when we can't read a name.
  return (names.length ? names : ['(hit)']).map((n, i) => ({
    platform: 'snap', vendor: 'Snapchat Pixel', destination: body?.ctx?.bt || 'snap', event: n,
    dedupeKey: `${body?.ctx?.r || req.id}|${i}`,
  }));
}

const DECODERS = [ga4, googleAds, meta, snap];

export function decode(requests) {
  const events = [];
  const seen = new Set();
  for (const req of requests) {
    if (!isBeacon(req.url)) continue;
    for (const fn of DECODERS) {
      let out = [];
      try { out = fn(req); } catch { out = []; }
      for (const e of out) {
        // One logical event is kept once even if it was sent to several endpoints.
        if (seen.has(e.dedupeKey)) continue;
        seen.add(e.dedupeKey);
        events.push({ ...e, step: req.step, t: req.t, url: req.url, requestId: req.id });
      }
      if (out.length) break;
    }
  }
  return events;
}

export function inventory(requests, pageHost) {
  const base = pageHost.replace(/^www\./, '');
  const hosts = new Map();
  for (const r of requests) {
    let host; try { host = new URL(r.url).host; } catch { continue; }
    if (host.endsWith(base) || r.url.startsWith('data:')) continue;
    const h = hosts.get(host) || { host, vendor: vendorOf(host), requests: 0, failed: 0 };
    h.requests++;
    if (r.status >= 400) h.failed++;
    hosts.set(host, h);
  }
  return [...hosts.values()].sort((a, b) => b.requests - a.requests);
}

// Container / property IDs referenced by tag loader scripts (what is *installed*, even if silent).
export function installedIds(requests) {
  const ids = { gtm: new Set(), ga4: new Set(), gads: new Set(), meta: new Set() };
  for (const r of requests) {
    let u; try { u = new URL(r.url); } catch { continue; }
    if (/googletagmanager\.com$/.test(u.host)) {
      const id = u.searchParams.get('id') || '';
      if (id.startsWith('GTM-')) ids.gtm.add(id);
      if (id.startsWith('G-')) ids.ga4.add(id);
      if (id.startsWith('AW-')) ids.gads.add(id);
    }
    const sig = u.host === 'connect.facebook.net' && u.pathname.match(/signals\/config\/(\d+)/);
    if (sig) ids.meta.add(sig[1]);
  }
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, [...v]]));
}

function num(v) { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
