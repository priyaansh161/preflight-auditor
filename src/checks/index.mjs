// Every check is a plain function of the recorded evidence. Same evidence in, same findings out.
// A check returns one finding per issue, or a single 'pass' finding so the report shows what was verified.
import { CATEGORIES as C, PLATFORMS, funnelOf, finding, inr, countBy } from './util.mjs';
import { TEST_PARAMS } from '../session.mjs';

// ---------------- Page & shopper experience ----------------

function pageLoads({ ev }) {
  const l = ev.landing || {};
  const from = new URL(ev.url), to = l.finalUrl ? new URL(l.finalUrl) : null;
  if (l.status === 200 && to && to.pathname === from.pathname) return finding({ id: 'page-loads', category: C.page, severity: 'pass', title: 'Page loads (HTTP 200) at the address the ad points to' });
  // A redirect is only fatal when it dumps the visitor somewhere generic or broken.
  const wrongPlace = !to || l.status >= 400 || to.pathname === '/' || to.host.replace(/^www./, '') !== from.host.replace(/^www./, '');
  if (wrongPlace) return finding({
    id: 'page-loads', category: C.page, severity: 'blocker',
    title: l.status >= 400 ? `Page returned HTTP ${l.status}` : 'Ad link lands on a different page',
    finding: `Requested ${ev.url}, ended on ${l.finalUrl} with status ${l.status}.`,
    impact: 'Every paid click would land on an error or the wrong page.',
    action: 'Fix the URL or point the ad at the correct live page before launch.',
    evidence: l.redirects || [],
  });
  return finding({
    id: 'page-loads', category: C.page, severity: 'low', owner: 'Marketing / ads team',
    title: 'Ad link goes through a redirect before the page loads',
    finding: `${from.pathname} redirects to ${to.pathname} on the same site; the page then loads normally.`,
    impact: 'Adds a little load time to every paid click, and the ad depends on the redirect never being removed.',
    action: `Update the ad's final URL to ${to.origin + to.pathname}.`,
    evidence: [...(l.redirects || []), l.finalUrl],
  });
}

function inStock({ ev }) {
  const p = ev.product;
  if (!p) return [];
  const total = p.variants.length, avail = p.variants.filter(v => v.available);
  if (!avail.length) return finding({ id: 'stock', category: C.page, severity: 'blocker', owner: 'Marketing / ads team', title: 'Product is sold out in every size', finding: `All ${total} sizes are unavailable.`, impact: 'You would pay for clicks that cannot convert.', action: 'Pause ads for this product or point them to an in-stock alternative.' });
  if (total >= 3 && avail.length / total < 0.5) return finding({
    id: 'stock', category: C.page, severity: 'medium', owner: 'Marketing / ads team',
    title: `Only ${avail.length} of ${total} sizes are in stock`,
    finding: `Available: ${avail.map(v => v.title).join(', ')}.`,
    impact: 'Many visitors will not find their size, which lowers conversion rate and wastes spend.',
    action: 'Restock, or narrow targeting / swap the hero product while sizes are thin.',
  });
  return finding({ id: 'stock', category: C.page, severity: 'pass', title: `In stock (${avail.length} of ${total} sizes available)` });
}

function addToCartWorks({ ev }) {
  if (!ev.product) return [];
  const sel = ev.steps.find(s => s.name === 'select_variant');
  const v = ev.chosenVariant;
  const added = ev.cartAfter?.items?.some(i => String(i.variant_id) === String(v?.id));
  if (added) return finding({ id: 'atc-works', category: C.page, severity: 'pass', title: `Add to cart works (size ${v.title} landed in the cart)` });
  if (sel && !sel.ok) return finding({
    id: 'atc-works', category: C.page, severity: 'low', confidence: 'needs confirmation',
    title: 'Could not verify Add to cart automatically',
    finding: `The auditor could not select a size on this theme (${sel.notes.join(' ')}).`,
    impact: 'Conversion checks below are incomplete for this page.',
    action: 'Run with --headed to watch, or add this theme\'s size selector to session.mjs.',
  });
  return finding({
    id: 'atc-works', category: C.page, severity: 'blocker',
    title: 'Add to cart does not work',
    finding: `Size ${v?.title} was selected and "Add to cart" was clicked, but the cart stayed at ${ev.cartAfter?.item_count ?? '?'} items.`,
    impact: 'Paid visitors cannot buy.',
    action: 'Reproduce on a phone and fix the add-to-cart flow before launch.',
  });
}

function jsErrors({ ev }) {
  if (!ev.pageErrors.length) return finding({ id: 'js-errors', category: C.page, severity: 'pass', title: 'No uncaught JavaScript errors' });
  const byStep = [...countBy(ev.pageErrors, e => e.step)].map(([s, n]) => `${n} during "${stepLabel(ev, s)}"`).join(', ');
  return finding({
    id: 'js-errors', category: C.page, severity: 'medium',
    title: `${ev.pageErrors.length} uncaught JavaScript error${ev.pageErrors.length > 1 ? 's' : ''} on the page`,
    finding: `Script errors were thrown: ${byStep}.`,
    impact: 'A crashing script can stop a tag (or a button) from working for some shoppers. None broke the tested journey, but they make the page fragile.',
    action: 'Have a developer trace each error to its script and fix or remove it.',
    evidence: [...new Set(ev.pageErrors.map(e => e.text))],
  });
}

function speed({ ev }) {
  const lcp = ev.vitals?.lcp, cls = ev.vitals?.cls, out = [];
  const lab = 'Measured once on an emulated phone over a fast connection — real shoppers on 4G will see it slower.';
  if (lcp != null) {
    const s = lcp > 4000 ? 'high' : lcp > 2500 ? 'medium' : 'pass';
    out.push(finding({
      id: 'lcp', category: C.page, severity: s,
      title: s === 'pass' ? `Main content appears quickly (LCP ${(lcp / 1000).toFixed(1)}s)` : `Main content is slow to appear (LCP ${(lcp / 1000).toFixed(1)}s)`,
      finding: `Largest Contentful Paint: ${(lcp / 1000).toFixed(2)}s (good ≤ 2.5s). ${lab}`,
      impact: 'Slow pages lose paid visitors before they see the product, and Google Ads gives slow pages a worse landing-page score.',
      action: 'Compress the hero image, defer non-essential third-party scripts.',
    }));
  }
  if (cls != null) {
    const s = cls > 0.25 ? 'high' : cls > 0.1 ? 'medium' : 'pass';
    out.push(finding({
      id: 'cls', category: C.page, severity: s,
      title: s === 'pass' ? `Layout is stable (CLS ${cls})` : `Page jumps around while loading (CLS ${cls})`,
      finding: `Cumulative Layout Shift: ${cls} (good ≤ 0.1). ${lab}`,
      impact: 'Content that moves under a thumb causes mis-taps and frustration on mobile.',
      action: 'Reserve space for banners, images and widgets that load late.',
    }));
  }
  return out;
}

function thirdPartyWeight({ inv }) {
  const n = inv.length;
  const named = new Set(inv.map(h => h.vendor).filter(Boolean)).size;
  if (n <= 30) return finding({ id: 'third-party', category: C.page, severity: 'pass', title: `${n} outside domains load on the page` });
  return finding({
    id: 'third-party', category: C.page, severity: 'low', owner: 'Marketing / ads team',
    title: `${n} outside domains load on this page (${named}+ separate vendors)`,
    finding: `${inv.reduce((a, h) => a + h.requests, 0)} requests went to ${n} outside domains; ${named} vendors could be named, the rest are unidentified (full list in the appendix).`,
    impact: 'Each vendor adds load time and another script that can break. Old, unused vendors are common in this list.',
    action: 'Review the vendor list with marketing and remove anything no one is using.',
  });
}

function brokenTagScripts({ ev, inv }) {
  const bad = ev.requests.filter(r => r.status >= 400 && r.type === 'script');
  if (!bad.length) return finding({ id: 'tag-scripts', category: C.page, severity: 'pass', title: 'All scripts loaded successfully' });
  return finding({
    id: 'tag-scripts', category: C.page, severity: 'medium',
    title: `${bad.length} script${bad.length > 1 ? 's' : ''} failed to load`,
    finding: 'These scripts returned an error, so whatever they do is not happening.',
    impact: 'If one of these is a tracking or checkout script, data or sales are silently lost.',
    action: 'Remove dead scripts or fix their URLs / account access.',
    evidence: bad.map(r => `HTTP ${r.status} ${r.url.slice(0, 140)}`),
  });
}

// ---------------- Tags present & firing ----------------

function platformsPresent({ events, installed }) {
  return Object.entries(PLATFORMS).map(([key, p]) => {
    const pv = events.filter(e => e.platform === key && e.step === 'landing');
    const dests = [...new Set(pv.map(e => e.destination))];
    const inst = installed[key] || [];
    if (pv.length) return finding({ id: `present-${key}`, category: C.tags, severity: 'pass', title: `${p.name} is installed and firing (${dests.join(', ')})` });
    return finding({
      id: `present-${key}`, category: C.tags, severity: 'high', owner: 'Marketing / ads team',
      title: `${p.name} did not fire on page load`,
      finding: inst.length ? `The tag is installed (${inst.join(', ')}) but sent nothing when the page loaded.` : 'No trace of this platform on the page.',
      impact: `Treat as a blocker if you plan to run ${p.name.replace(' Pixel', '')} campaigns to this page: it would have no data to optimise on.`,
      action: 'Check the tag and its trigger in Google Tag Manager / the Shopify app.',
    });
  });
}

function funnelEvents({ ev, events }) {
  const out = [];
  for (const f of funnelOf(ev)) {
    if (!ev.steps.some(s => s.name === f.step && s.ok)) continue; // step didn't run cleanly → don't blame tags
    for (const key of Object.keys(PLATFORMS)) {
      const name = f[key];
      const hits = events.filter(e => e.platform === key && e.event === name && e.step === f.step);
      if (hits.length) continue;
      const anyStep = events.filter(e => e.platform === key && e.event === name);
      // Google Ads may track the step with a classic conversion tag instead of the gtag event.
      const classic = key === 'gads' ? events.filter(e => e.platform === 'gads' && e.legacyTag && e.step === f.step) : [];
      out.push(finding({
        id: `funnel-${key}-${f.key}`, category: C.tags,
        severity: key !== 'gads' ? 'high' : classic.length ? 'low' : 'medium',
        confidence: key === 'gads' ? 'needs confirmation' : 'confirmed',
        title: `${PLATFORMS[key].name}: no "${name}" event when the shopper ${f.doing}`,
        finding: (anyStep.length ? `"${name}" fired, but at the wrong moment (${[...new Set(anyStep.map(e => stepLabel(ev, e.step)))].join(', ')}).` : `The shopper ${f.doing}, but ${PLATFORMS[key].name} never received "${name}".`)
          + (classic.length ? ` A classic conversion tag did fire at this step (label ${[...new Set(classic.map(e => e.label))].join(', ')}).` : ''),
        impact: key === 'gads'
          ? (classic.length ? 'Probably covered by the classic conversion tag; only matters if remarketing audiences rely on the standard event.' : 'Fine if Google Ads only optimises on purchases; a gap if you use this step for remarketing or as a micro-conversion.')
          : `${PLATFORMS[key].name} cannot see this funnel step, so it cannot optimise towards it or report drop-off.`,
        action: `Add or fix the "${name}" tag/trigger for this step.`,
      }));
    }
  }
  const ok = funnelOf(ev).filter(f => ev.steps.some(s => s.name === f.step && s.ok)).length * 3 - out.length;
  if (!out.length) out.push(finding({ id: 'funnel', category: C.tags, severity: 'pass', title: `All ${ok} funnel events fired on GA4, Meta and Google Ads` }));
  return out;
}

function phantomConversions({ ev, events }) {
  const s = ev.steps.find(x => x.name === 'atc_no_size');
  if (!s || !s.ok) return [];
  const cartChanged = (ev.cartAfterNoSize?.item_count ?? 0) !== (ev.cartBefore?.item_count ?? 0);
  const phantom = events.filter(e => e.step === 'atc_no_size' && /^(add_to_cart|AddToCart)$/.test(e.event));
  if (!phantom.length || cartChanged) return finding({ id: 'phantom', category: C.tags, severity: 'pass', title: 'No false "add to cart" when the shopper forgets to pick a size' });
  return finding({
    id: 'phantom', category: C.tags, severity: 'high',
    title: '"Add to cart" is reported even when nothing was added',
    finding: `Tapping Add to cart without a size was rejected by the store (cart unchanged), yet ${phantom.map(e => `${e.vendor} ${e.destination}`).join(', ')} reported an add-to-cart.`,
    impact: 'Ad platforms are told about carts that never existed, inflating results and teaching the algorithm the wrong audience.',
    action: 'Fire the add-to-cart tag on the store\'s success response, not on the button click.',
    evidence: phantom.map(e => `${e.event} → ${e.destination}`),
  });
}

function virtualPageViews({ ev, events }) {
  const realLoads = new Set(ev.navigations.map(n => n.step));
  const pv = events.filter(e => e.step !== 'landing' && !realLoads.has(e.step) && e.event === PLATFORMS[e.platform]?.pageView);
  if (!pv.length) return finding({ id: 'virtual-pv', category: C.dupes, severity: 'pass', title: 'Page views only fire on real page loads' });
  const steps = [...new Set(pv.map(e => stepLabel(ev, e.step)))];
  const historyChange = ev.dataLayer.some(d => /historyChange/.test(d.data?.event || ''));
  return finding({
    id: 'virtual-pv', category: C.dupes, severity: 'medium', owner: 'Analytics',
    title: `Extra page views counted with no new page (${steps.join(' / ').toLowerCase()})`,
    finding: `No new page loaded, but ${pv.length} page-view hits went out (${[...new Set(pv.map(e => `${e.vendor} ${e.destination}`))].join(', ')}).` + (historyChange ? ' The theme rewrites the address bar (history change) when a size is picked, and the tags treat that as a new page.' : ''),
    impact: 'Page views and sessions are inflated and engagement rate / bounce rate are distorted. Meta also receives extra PageView signals.',
    action: 'In GA4 turn off "page changes based on browser history events" (or exclude this theme\'s replaceState), and remove History Change triggers from page-view tags in GTM.',
    evidence: pv.map(e => `${stepLabel(ev, e.step)}: ${e.vendor} ${e.destination} ${e.event}`),
  });
}

function listingEvents({ ev, events }) {
  if (ev.pageType !== 'collection') return [];
  const out = [];
  const list = events.filter(e => e.platform === 'ga4' && e.event === 'view_item_list' && e.step === 'landing');
  out.push(list.length
    ? finding({ id: 'list-view', category: C.tags, severity: 'pass', title: 'GA4 records the product list being viewed (view_item_list)' })
    : finding({ id: 'list-view', category: C.tags, severity: 'medium', owner: 'Analytics', title: 'GA4 does not record the product list being viewed', finding: 'No "view_item_list" event when the collection page loaded.', impact: 'You cannot see which products in a listing get attention versus clicks, so collection-page ads are hard to optimise.', action: 'Send view_item_list with the visible products when the collection loads.' }));
  if (ev.steps.some(s => s.name === 'open_product' && s.ok)) {
    const sel = events.filter(e => e.platform === 'ga4' && e.event === 'select_item' && e.step === 'open_product');
    out.push(sel.length
      ? finding({ id: 'list-select', category: C.tags, severity: 'pass', title: 'GA4 records which product was tapped (select_item)' })
      : finding({ id: 'list-select', category: C.tags, severity: 'low', owner: 'Analytics', title: 'GA4 does not record which product was tapped in the list', finding: 'No "select_item" event when the shopper opened a product from the collection.', impact: 'List click-through rates per product are unavailable.', action: 'Fire select_item on product-card clicks.' }));
  }
  return out;
}

// ---------------- Double counting ----------------

const STANDARD = new Set(['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);

function duplicates({ ev, events }) {
  const groups = countBy(events.filter(e => STANDARD.has(e.event)), e => `${e.platform}|${e.destination}|${e.event}|${e.step}`);
  const out = [];
  for (const [k, n] of groups) {
    if (n < 2) continue;
    const [platform, dest, name, step] = k.split('|');
    const conv = !/view/i.test(name);
    out.push(finding({
      id: `dupe-${platform}-${name}-${step}`, category: C.dupes, severity: conv ? 'high' : 'medium',
      title: `${PLATFORMS[platform]?.name || platform} ${dest} receives "${name}" ${n}× for one action`,
      finding: `During "${stepLabel(ev, step)}" the same event reached the same account ${n} times.`,
      impact: conv ? 'Conversions are over-counted, so reported ROAS is inflated and bidding is trained on fake volume.' : 'Inflated views make funnel conversion rates look worse than they are.',
      action: 'Find the two tags sending it (often a Shopify app plus a GTM tag) and keep one.',
    }));
  }
  if (!out.length) out.push(finding({ id: 'dupes', category: C.dupes, severity: 'pass', title: 'No event fired twice to the same account for one action' }));
  return out;
}

function parallelDestinations({ ev, events }) {
  const out = [];
  // Two Meta pixels both receiving conversions.
  for (const f of funnelOf(ev)) {
    const metaDests = [...new Set(events.filter(e => e.platform === 'meta' && e.event === f.meta).map(e => e.destination))];
    if (metaDests.length > 1) {
      const src = metaDests.map(d => `${d} (via ${events.find(e => e.destination === d)?.source || 'unknown'})`).join(' and ');
      out.push(finding({
        id: `meta-multi-${f.key}`, category: C.dupes, severity: 'high', confidence: 'needs confirmation', owner: 'Marketing / ads team',
        title: `Two Meta pixels both report "${f.meta}"`,
        finding: `Each time the shopper ${f.doing}, the event is sent to ${metaDests.length} pixels: ${src}.`,
        impact: 'If both pixels sit in the same ad account or dataset, Meta counts each conversion twice and reported ROAS is overstated. If they belong to separate accounts (e.g. an agency), this is intentional.',
        action: 'Confirm in Meta Events Manager which pixel your campaigns optimise on; retire the other or remove it from this site.',
      }));
    }
  }
  // Several GA4 properties.
  const ga4 = [...new Set(events.filter(e => e.platform === 'ga4' && e.step === 'landing' && e.event === 'page_view').map(e => e.destination))];
  if (ga4.length > 1) out.push(finding({
    id: 'ga4-multi', category: C.dupes, severity: 'medium', confidence: 'needs confirmation', owner: 'Analytics',
    title: `${ga4.length} Google Analytics properties track this page`,
    finding: `Page views go to ${ga4.join(', ')}. Ecommerce events go to: ${[...new Set(events.filter(e => e.platform === 'ga4' && e.event === 'add_to_cart').map(e => e.destination))].join(', ') || 'none'}.`,
    impact: 'Teams reading different properties will see different numbers; any property linked to Google Ads must have complete ecommerce data.',
    action: 'Document which property is the source of truth and which is linked to Google Ads; remove stale ones.',
  }));
  // Several Google Ads conversion actions for one shopper action.
  for (const f of funnelOf(ev)) {
    const g = events.filter(e => e.platform === 'gads' && e.step === f.step && (e.event === f.gads || e.legacyTag));
    const actions = [...new Set(g.map(e => `${e.destination} ${e.label || e.event}`))];
    if (actions.length > 1) out.push(finding({
      id: `gads-multi-${f.key}`, category: C.dupes, severity: 'medium', confidence: 'needs confirmation', owner: 'Marketing / ads team',
      title: `${actions.length} Google Ads conversion actions fire when the shopper ${f.doing}`,
      finding: `One shopper action triggered: ${actions.join("; ")}.`,
      impact: 'If more than one is set as a "Primary" conversion, Google Ads counts this action several times and bids on inflated numbers.',
      action: 'In Google Ads → Goals → Conversions, keep exactly one of these as Primary for this action; mark the rest Secondary or remove them.',
    }));
  }
  return out;
}

function synonymEvents({ events }) {
  const norm = s => String(s).toLowerCase().replace(/ga4|v\d+|[^a-z]/g, '');
  const std = { addtocart: 'add_to_cart', begincheckout: 'begin_checkout', viewitem: 'view_item', purchase: 'purchase' };
  const hits = events.filter(e => e.platform === 'ga4' && !STANDARD.has(e.event) && std[norm(e.event)]);
  const names = [...new Set(hits.map(e => `${e.event} (≈ ${std[norm(e.event)]})`))];
  if (!names.length) return [];
  return finding({
    id: 'synonyms', category: C.dupes, severity: 'low', owner: 'Analytics',
    title: 'Same action tracked under two event names in GA4',
    finding: `Alongside the standard events, GA4 also receives: ${names.join(', ')}.`,
    impact: 'Harmless on its own, but if someone marks the custom one as a key event or imports it into Google Ads, the action is counted twice.',
    action: 'Retire the legacy custom events, or make sure only the standard event is a key event.',
  });
}

// ---------------- Data accuracy ----------------

function values({ ev, events }) {
  const out = [];
  const variantPrice = ev.chosenVariant ? ev.chosenVariant.price / 100 : null;
  const productPrice = ev.product ? ev.product.price / 100 : null;
  const expected = { view_item: productPrice, add_to_cart: variantPrice, begin_checkout: variantPrice };
  for (const f of funnelOf(ev)) {
    const exp = expected[f.key];
    if (exp == null) continue;
    for (const key of ['ga4', 'meta', 'gads']) {
      for (const e of events.filter(x => x.platform === key && x.event === f[key] && x.step === f.step)) {
        if (e.value == null) out.push(bad(e, f, `sent no value`, exp));
        else if (Math.abs(e.value - exp) > 1) out.push(bad(e, f, `sent value ${inr(e.value)}`, exp));
        if (!/^[A-Z]{3}$/.test(e.currency || '')) out.push(finding({
          id: `currency-${key}-${f.key}`, category: C.data, severity: 'high',
          title: `${e.vendor} "${e.event}" has ${e.currency ? `an invalid currency "${e.currency}"` : 'no currency'}`,
          finding: `Expected a 3-letter currency code such as INR.`,
          impact: 'Platforms may drop the value or convert it wrongly, breaking revenue and ROAS reporting.',
          action: 'Pass currency: "INR" with every ecommerce event.',
        }));
        if (e.valueIsText) out.push(finding({ id: `valtype-${f.key}`, category: C.data, severity: 'medium', title: `GA4 "${e.event}" sends the value as text`, finding: 'value was sent as a string, not a number.', impact: 'GA4 ignores text values in revenue metrics.', action: 'Send value as a number.' }));
      }
    }
  }
  if (!out.length) out.push(finding({ id: 'values', category: C.data, severity: 'pass', title: `Prices and currency match the store on every platform (${inr(variantPrice)} INR)` }));
  // Classic GTM Google Ads conversion tags sending ₹0.
  const zero = events.filter(e => e.platform === 'gads' && e.legacyTag && (e.value === 0 || e.value == null) && e.step !== 'landing');
  if (zero.length) out.push(finding({
    id: 'gads-zero', category: C.data, severity: 'medium', confidence: 'needs confirmation', owner: 'Marketing / ads team',
    title: `${zero.length} Google Ads conversion tag${zero.length > 1 ? 's' : ''} report a value of ₹0`,
    finding: `Older GTM conversion tags fire on shopper actions with value 0: ${[...new Set(zero.map(e => `${stepLabel(ev, e.step)} → label ${e.label}`))].join('; ')}.`,
    impact: 'If any of these are used in Max Conversion Value / Target ROAS bidding, Google learns that these conversions are worth nothing.',
    action: 'Pass the cart value into these tags, or confirm they are Secondary (observation-only) conversions.',
  }));
  return dedupeFindings(out);

  function bad(e, f, what, exp) {
    return finding({
      id: `value-${e.platform}-${f.key}`, category: C.data, severity: 'high',
      title: `${e.vendor} "${e.event}" ${what} (store price ${inr(exp)})`,
      finding: `The store says ${inr(exp)}; ${e.vendor} ${e.destination} received ${e.value == null ? 'nothing' : inr(e.value)}.`,
      impact: 'Revenue, ROAS and value-based bidding are wrong by this amount for every conversion.',
      action: 'Read the price from the selected variant in the add-to-cart / view-item tag.',
    });
  }
}

function productIds({ ev, events }) {
  if (!ev.product) return [];
  const pid = String(ev.product.id), vid = String(ev.chosenVariant?.id || ''), sku = ev.chosenVariant?.sku || '';
  const out = [];
  const funnelHits = events.filter(x => x.items?.length && /^(view_item|add_to_cart|begin_checkout|ViewContent|AddToCart|InitiateCheckout)$/.test(x.event));
  for (const e of funnelHits) {
    const id = String(e.items[0].id || '');
    if (!id.includes(pid) && !(vid && id.includes(vid)) && !(sku && id === sku)) out.push(finding({
      id: `ids-${e.platform}`, category: C.data, severity: 'high',
      title: `${e.vendor} "${e.event}" sends a product ID that doesn't match the store`,
      finding: `Sent "${id}"; Shopify product ${pid}, variant ${vid}.`,
      impact: 'Dynamic product ads and catalogue reporting cannot match this event to a product.',
      action: 'Use the same product/variant ID format as your product catalogue feed.',
    }));
  }
  // The same product should carry the same ID format through the whole funnel of one account.
  const kind = id => (id === sku ? 'SKU code' : /^shopify_/.test(id) ? 'Shopify feed ID' : id === vid ? 'variant ID' : id === pid ? 'product ID' : 'other');
  for (const [dest, hits] of Map.groupBy(funnelHits, e => `${e.vendor}|${e.destination}`)) {
    const kinds = new Map(hits.map(e => [kind(String(e.items[0].id)), e]));
    if (kinds.size < 2) continue;
    const [vendor, id] = dest.split('|');
    out.push(finding({
      id: `ids-mixed-${id}`, category: C.data, severity: 'medium', owner: 'Analytics',
      title: `${vendor} sees the same product under ${kinds.size} different IDs across the funnel`,
      finding: [...kinds].map(([k, e]) => `"${e.event}" uses the ${k} (${e.items[0].id})`).join('; ') + '.',
      impact: 'Product-level reports cannot connect the steps, e.g. how many carts of this product reached checkout. Often caused by a third-party checkout app sending its own events.',
      action: 'Make the checkout integration send the same item_id format as the store\'s own events.',
    }));
  }
  const ga4Variant = events.find(e => e.platform === 'ga4' && e.event === 'add_to_cart' && e.step === 'add_to_cart')?.items?.[0]?.variant;
  if (ga4Variant && ev.chosenVariant && ga4Variant !== ev.chosenVariant.title) out.push(finding({
    id: 'variant', category: C.data, severity: 'medium',
    title: 'GA4 records the wrong size on add to cart',
    finding: `Shopper chose ${ev.chosenVariant.title}; GA4 received ${ga4Variant}.`,
    impact: 'Size-level demand reporting is wrong.', action: 'Read the variant from the selected option, not the page default.',
  }));
  if (!out.length) out.push(finding({ id: 'ids', category: C.data, severity: 'pass', title: 'Product IDs in tags match the Shopify catalogue' }));
  return dedupeFindings(out);
}

function metaDedupIds({ events }) {
  const conv = events.filter(e => e.platform === 'meta' && /^(AddToCart|InitiateCheckout|Purchase)$/.test(e.event));
  if (!conv.length) return [];
  const missing = conv.filter(e => !e.eventId);
  if (!missing.length) return finding({ id: 'meta-eid', category: C.data, severity: 'pass', title: 'Meta conversion events carry an event ID (safe to combine with server-side tracking)' });
  return finding({
    id: 'meta-eid', category: C.data, severity: 'medium',
    title: 'Some Meta conversion events have no event ID',
    finding: `${missing.map(e => `${e.event} → ${e.destination}`).join(', ')} were sent without an event ID.`,
    impact: 'If the same conversions are also sent server-side (Conversions API), Meta cannot match the pair and counts them twice.',
    action: 'Send a shared event_id from both the browser pixel and the server event.',
  });
}

function consoleWarnings({ ev }) {
  const meta = ev.console.filter(m => /\[Meta Pixel\]|fbevents/i.test(m.text));
  if (!meta.length) return [];
  return finding({
    id: 'meta-warnings', category: C.data, severity: 'medium',
    title: 'Meta Pixel reports its own errors in the browser',
    finding: [...new Set(meta.map(m => m.text.replace(/ Please refer.*$/, '')))].join(' · '),
    impact: 'Meta rejects or ignores the malformed parameter, so the affected event loses value or matching data.',
    action: 'Find the custom event sending the bad parameter (Meta Pixel Helper shows it) and fix its format.',
    evidence: meta.map(m => `[${m.step}] ${m.text}`),
  });
}

// ---------------- Attribution ----------------

function attribution({ ev, events }) {
  const out = [];
  const final = new URL(ev.landing?.finalUrl || ev.url);
  const lost = Object.keys(TEST_PARAMS).filter(k => final.searchParams.get(k) !== TEST_PARAMS[k]);
  out.push(lost.length
    ? finding({ id: 'params', category: C.attribution, severity: 'high', title: `Landing strips ad tracking parameters (${lost.join(', ')})`, finding: `Arrived with ${Object.keys(TEST_PARAMS).join(', ')}; after redirects the page URL no longer has ${lost.join(', ')}.`, impact: 'Sales from these clicks get credited to "direct" or "organic" instead of the ad.', action: 'Make every redirect preserve the query string.', evidence: [ev.landing?.requestedUrl, ev.landing?.finalUrl] })
    : finding({ id: 'params', category: C.attribution, severity: 'pass', title: 'UTM and click-ID parameters survive the landing' }));

  const cookie = n => ev.cookies.find(c => c.name === n)?.value || '';
  out.push(cookie('_gcl_aw').includes(TEST_PARAMS.gclid)
    ? finding({ id: 'gclid', category: C.attribution, severity: 'pass', title: 'Google Ads click ID (gclid) is stored for later conversions' })
    : finding({ id: 'gclid', category: C.attribution, severity: 'high', title: 'Google Ads click ID (gclid) is not stored', finding: 'No _gcl_aw cookie carrying the click ID after landing.', impact: 'A purchase later in the visit cannot be tied back to the Google ad click.', action: 'Enable the Conversion Linker tag (GTM) / gtag on all pages, and check consent settings.' }));
  out.push(cookie('_fbc').includes(TEST_PARAMS.fbclid)
    ? finding({ id: 'fbclid', category: C.attribution, severity: 'pass', title: 'Meta click ID (fbclid) is stored for later conversions' })
    : finding({ id: 'fbclid', category: C.attribution, severity: 'high', title: 'Meta click ID (fbclid) is not stored', finding: 'No _fbc cookie carrying the click ID after landing.', impact: 'Meta matches fewer conversions to ad clicks, lowering reported results and optimisation quality.', action: 'Ensure the Meta pixel loads on the landing page before any redirect.' }));

  const ga4pv = events.filter(e => e.platform === 'ga4' && e.event === 'page_view' && e.step === 'landing');
  const noUtm = ga4pv.filter(e => !(e.pageLocation || '').includes(`utm_source=${TEST_PARAMS.utm_source}`));
  if (ga4pv.length) out.push(noUtm.length
    ? finding({ id: 'ga4-utm', category: C.attribution, severity: 'high', title: 'GA4 does not see the campaign tags', finding: `${noUtm.map(e => e.destination).join(', ')} received a page location without the UTM parameters.`, impact: 'GA4 attributes the session to the wrong source.', action: 'Do not override page_location with a cleaned URL on landing.' })
    : finding({ id: 'ga4-utm', category: C.attribution, severity: 'pass', title: 'GA4 receives the campaign (UTM) parameters' }));
  return out;
}

// ---------------- Privacy & consent ----------------

function consent({ ev, events }) {
  const cmds = ev.dataLayer.map(d => d.data).filter(d => d && d[0] === 'consent');
  const def = cmds.find(c => c[1] === 'default')?.[2];
  const updated = cmds.some(c => c[1] === 'update');
  if (!def) return finding({
    id: 'consent', category: C.consent, severity: 'low', confidence: 'needs confirmation', owner: 'Marketing / ads team',
    title: 'No Google Consent Mode signal found',
    finding: 'Tags fire without any consent state being declared.',
    impact: 'Not required for Indian traffic today, but Google requires Consent Mode for EEA users, and India\'s DPDP Act will tighten consent rules for marketing data as its rules phase in.',
    action: 'Decide with legal whether a consent banner is needed for your audience.',
  });
  const granted = Object.values(def).every(v => v === 'granted');
  if (granted) return finding({
    id: 'consent', category: C.consent, severity: 'low', confidence: 'needs confirmation', owner: 'Marketing / ads team',
    title: 'All tracking is switched on before the visitor agrees to anything',
    finding: `Consent Mode default is "granted" for ${Object.keys(def).join(', ')}${updated ? '' : ', and no consent banner changed it'}.`,
    impact: 'Good for measurement: nothing is held back. The risk is regulatory: India\'s DPDP Act requires consent for processing personal data, with its rules being phased in. A legal call, not a launch blocker.',
    action: 'Confirm the policy with legal; if a banner is added later, re-run this audit to make sure tags still fire after "Accept".',
  });
  const denied = Object.entries(def).filter(([, v]) => v === 'denied').map(([k]) => k);
  return finding({
    id: 'consent', category: C.consent, severity: updated ? 'pass' : 'high',
    title: updated ? 'Consent Mode is set up (default denied, updated on choice)' : `Tracking is blocked by default (${denied.join(', ')}) and nothing switches it on`,
    finding: updated ? '' : 'No consent update happened during the visit (the auditor does not click consent banners).',
    impact: updated ? '' : 'Visitors who ignore the banner send limited or no conversion data.',
    action: updated ? '' : 'Check the banner fires a consent update on Accept.',
  });
}

// ---------------- runner ----------------

const CHECKS = [pageLoads, inStock, addToCartWorks, jsErrors, speed, thirdPartyWeight, brokenTagScripts,
  platformsPresent, funnelEvents, listingEvents, phantomConversions,
  virtualPageViews, duplicates, parallelDestinations, synonymEvents,
  values, productIds, metaDedupIds, consoleWarnings,
  attribution, consent];

export function runChecks(ctx) {
  const out = [];
  for (const check of CHECKS) {
    try { out.push(...[].concat(check(ctx) || [])); }
    catch (err) { out.push(finding({ id: `error-${check.name}`, category: 'Auditor', severity: 'low', title: `Check "${check.name}" could not run`, finding: String(err.message), confidence: 'needs confirmation' })); }
  }
  return out;
}

function stepLabel(ev, name) { return ev.steps.find(s => s.name === name)?.label || name; }
function dedupeFindings(arr) { const seen = new Set(); return arr.filter(f => !seen.has(f.id + f.title) && seen.add(f.id + f.title)); }
