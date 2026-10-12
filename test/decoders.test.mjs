// Run: npm test   (no browser needed; these pin the wire-format decoding)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, isBeacon } from '../src/decoders/index.mjs';

const req = (url, post = null, step = 'landing', id = 0) => ({ id, url, post, step, t: 0 });

test('GA4: one POST can carry several events, each decoded with value and items', () => {
  const url = 'https://region1.analytics.google.com/g/collect?v=2&tid=G-TEST&sid=1&_s=4&cu=INR';
  const body = 'en=view_item&epn.value=4499&pr1=id123~nmShoe~pr4499~vaUK%206~qt1\nen=scroll';
  const evs = decode([req(url, body)]);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].event, 'view_item');
  assert.equal(evs[0].value, 4499);
  assert.equal(evs[0].currency, 'INR');
  assert.deepEqual(evs[0].items[0], { id: '123', name: 'Shoe', price: 4499, variant: 'UK 6', quantity: 1 });
});

test('GA4: a value sent as text is flagged', () => {
  const evs = decode([req('https://www.google-analytics.com/g/collect?tid=G-T&en=add_to_cart&ep.value=4499&cu=INR')]);
  assert.equal(evs[0].valueIsText, true);
});

test("Google Ads: Google's own fan-out to several endpoints counts once", () => {
  const q = 'random=111&en=add_to_cart&label=ABC&value=4499&currency_code=INR';
  const evs = decode([
    req(`https://www.googleadservices.com/pagead/conversion/123/?${q}`, null, 'add_to_cart', 1),
    req(`https://www.googleadservices.com/ccm/conversion/123/?${q}`, null, 'add_to_cart', 2),
    req(`https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/?${q}`, null, 'add_to_cart', 3),
  ]);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].destination, 'AW-123');
});

test('Google Ads: two firings with different random values are two events (a real duplicate)', () => {
  const evs = decode([
    req('https://www.googleadservices.com/pagead/conversion/123/?random=1&en=add_to_cart&label=A'),
    req('https://www.googleadservices.com/pagead/conversion/123/?random=2&en=add_to_cart&label=A'),
  ]);
  assert.equal(evs.length, 2);
});

test('Google Ads: classic GTM conversion tags (en=conversion + label) are marked legacy', () => {
  const [e] = decode([req('https://www.googleadservices.com/pagead/conversion/123/?random=9&en=conversion&label=XYZ&value=0')]);
  assert.equal(e.legacyTag, true);
  assert.equal(e.value, 0);
});

test("Meta: Shopify's sandboxed pixel sends fields in a POST body, not the URL", () => {
  const body = 'id=555&ev=AddToCart&cd%5Bvalue%5D=4499&cd%5Bcurrency%5D=INR&cd%5Bcontent_ids%5D=%5B15400021327915%5D&eid=abc&ts=1&ec=2&a=shopify_web_pixel';
  const [e] = decode([req('https://www.facebook.com/tr/', body)]);
  assert.equal(e.platform, 'meta');
  assert.equal(e.destination, '555');
  assert.equal(e.event, 'AddToCart');
  assert.equal(e.value, 4499);
  assert.equal(e.items[0].id, '15400021327915');
  assert.equal(e.eventId, 'abc');
  assert.equal(e.source, 'shopify_web_pixel');
});

test('script loads are not mistaken for tracking hits', () => {
  assert.equal(isBeacon('https://www.googletagmanager.com/gtm.js?id=GTM-X'), false);
  assert.equal(isBeacon('https://connect.facebook.net/en_US/fbevents.js'), false);
  assert.equal(isBeacon('https://www.facebook.com/tr/?id=1&ev=PageView'), true);
});
