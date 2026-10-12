# Approach note

## The problem as I framed it

"Is this page safe to put ad spend behind?" splits into two questions with different owners:

1. **Will a paid visitor be able to buy?** The page loads, the product is in stock, Add to cart works, checkout opens.
2. **Will the ad platforms learn the truth about what that visitor did?** Every platform hears about each step once, with the right price and product, and the sale is credited to the ad that caused it.

Most tracking audits stop at "is the pixel installed?". That isn't what loses money. Money is lost when a conversion is counted twice (inflated ROAS, budget moved to the wrong campaigns), sent with the wrong value (value-based bidding learns nonsense), reported when nothing happened, or credited to "direct" because a redirect dropped the click ID. So the tool is built around a **shopper journey with known ground truth**, and every check compares what the tags *said* against what *actually happened*.

## Architecture

```
collect()  ── Playwright drives installed Edge/Chrome (phone emulation)
   │          records: every request (context-level), dataLayer pushes, console/page errors,
   │          real page loads, cookies, LCP/CLS, Shopify product + cart JSON (ground truth)
   ▼
evidence.json   (saved; analyse() can be replayed offline)
   ▼
analyse()  ── decoders: GA4 / Google Ads / Meta / Snap wire formats → normalised events
           ── checks: ~25 pure functions → findings {severity, owner, confidence, what/why/fix}
           ── verdict: a rule over severities
           ── optional llm.mjs: executive summary + fuzzy event-name review
   ▼
report.html · report.md · report.json
```

The browser layer only observes. All judgement lives in pure functions, so the rules are unit-tested without a browser and any report can be regenerated from its evidence.

## Decisions that came from the real page

Neeman's is a production Shopify store with roughly 90 third-party domains, two GTM containers, three GA4 properties, two Meta pixels, two Google Ads accounts and a third-party checkout (GoKwik). Several design choices exist because a simpler approach gave a wrong answer on this page:

| What a naive tool does | What happened on neemans.com | What the auditor does |
|---|---|---|
| Listens to the page's requests | Shopify's Meta pixel runs in a sandboxed `about:blank` iframe, so it looked like Meta never fired | Records at the **browser-context level**, which includes sandboxed frames |
| Counts Google Ads hits | One gtag event fans out to 3 Google endpoints, so every event looked tripled | Collapses hits that share Google's per-event `random` value; a genuine double-fire has two values |
| Waits for "network idle" | GoKwik's checkout sends GA4 `begin_checkout` 5–10 s after the click; the first version reported it missing | Each step waits for tracking to go quiet; checkout gets a longer minimum window |
| Treats every page_view as a page | Choosing a size calls `history.replaceState`; GA4, GTM and both Meta pixels each logged a new page view | Compares page-view beacons against **real document loads** and flags the rest as virtual |
| Trusts the tag's value | n/a (values were correct here) | Compares every value against Shopify's own product JSON and the real cart |
| Calls a renamed URL broken | `/collections/sneakers` 301-redirects to `/collections/sneakers-1`, keeping all params | Blocker only if the redirect lands on the homepage, an error or another site; otherwise Low ("update the ad URL") |

A **negative test** is part of the journey: tap Add to cart before choosing a size. The store rejects it. If any tag still reports AddToCart, that's a phantom conversion. Neeman's passes this.

## What the sample audit found on Neeman's

Verdict on both sample pages: **works for shoppers, but tracking needs fixes**. No blockers: the pages load fast (lab LCP about 1–2 s across runs), stock is fine, Add to cart and checkout work, click IDs and UTMs survive, and prices match the store on every platform.

The issues are all about double counting and data quality:
- **Two Meta pixels** (one via the Shopify app, one via GTM) both receive AddToCart and InitiateCheckout, and usually ViewContent too. If both sit in the same ad account, Meta counts each conversion twice.
- **Three Google Ads conversion actions fire on a single Add to cart**, and the classic GTM ones send a value of **₹0**. That's harmless if they're Secondary conversions, damaging if any is Primary under value-based bidding.
- **Choosing a size creates a page view** on the GA4 properties, both Meta pixels and Google Ads (virtual page views from `replaceState`).
- Smaller items: duplicate custom event names (`ADD-TO-CART-GA4-V2` next to `add_to_cart`), Meta's own "invalid currency" console warning, uncaught JS errors, CLS ≈ 0.18 on the product page (mobile), 85–90 outside domains, consent defaulting to granted.
- In one development run, GoKwik's GA4 `begin_checkout` identified the product by SKU while earlier steps used the Shopify feed ID. That check is built in, but the samples didn't reproduce it (see "One run is a snapshot" below).

## What is deterministic (all of the verdict)

Every check that decides severity or the verdict is a rule over recorded evidence:

| Group | Checks |
|---|---|
| Page & shopper | HTTP status and redirect target · stock (Shopify JSON) · Add to cart really changes the cart · uncaught JS errors · failed scripts · LCP / CLS thresholds · number of third-party domains |
| Tags firing | GA4 / Meta / Google Ads fire on load · each funnel event reaches each platform at the right step · list events on collection pages · no phantom add-to-cart on a rejected add |
| Double counting | same event twice to one account in one step · virtual page views · one action sent to several Meta pixels / GA4 properties / Ads conversion actions · synonym custom events (name normalisation) |
| Data accuracy | value equals store price · ISO currency · numeric value · product ID matches catalogue (product ID, variant ID or SKU) · consistent ID format across the funnel · Meta event IDs for CAPI dedup · Meta's own console errors · ₹0 classic conversion tags |
| Attribution | UTMs / gclid / fbclid survive the landing · `_gcl_aw` and `_fbc` cookies carry the click IDs · GA4 page_location keeps the UTMs |
| Consent | Consent Mode default state and whether anything updates it |

These are counting, comparing and matching problems. They have exact answers, and an LLM would only make them less reliable. The verdict gates money, so it must give the same answer for the same evidence.

**"Needs confirmation"** is the honest middle ground. The browser can prove that two Meta pixels both receive AddToCart. Whether that double-counts depends on account structure the tool can't see (same dataset, or an agency's separate account?). Those findings keep their impact-based severity but say exactly what a person with account access should confirm.

## Where an LLM adds value, and where it doesn't

It's used in two narrow places, both optional (`--explain`):

1. **Executive summary and top three actions.** Turning 15 findings into "here's what to fix first, in business terms" is a writing and prioritising task, not a measurement. The model receives only the findings JSON, is told not to add or dispute facts, and returns schema-validated JSON. It can't touch severities or the verdict.
2. **Fuzzy event-name review.** Real implementations accumulate names like `ADD-TO-CART-GA4-V2`, `atc`, `ua_add_to_cart`, `kp_atc`, `buy_now`. A rule catches the obvious ones; deciding whether `kp_atc` or `buy_now` means "added to cart" is open-ended semantics, which a model does better. Its output is labelled "AI suggestion, verify" and never changes the verdict.

Where it would add **more** value next (not built, deliberately):
- **Ad-to-page message match**: given the ad creative, does the landing page deliver on its promise (price, offer, product shown)? This needs vision and language judgement, and a mismatch wastes spend as surely as a broken pixel.
- **Root-cause hints** from a GTM container export: which tag and trigger produced a duplicate.
- **Naming unknown third-party domains** in the vendor inventory.

Where it should **not** be used: detecting whether something fired, counting, comparing prices or IDs, or deciding the verdict.

## Key assumptions

- **Shopify storefront.** The journey uses Shopify conventions (`/products/<handle>.js`, `/cart.js`, `form[action*="/cart/add"]`) with tolerant, text-based matching for size pickers and buttons. Page-load, tag, attribution and consent checks work on any site; on a non-Shopify page the shopper journey is skipped and the report says so.
- **Mobile by default.** Paid social traffic in India is overwhelmingly mobile; `--desktop` is available.
- **GA4, Meta and Google Ads are the platforms that decide spend**, so they are judged. Snap, Taboola, Criteo, Clarity and others are inventoried, not judged.
- **No purchase is placed.** The `purchase` event, the one that matters most, is not exercised. Testing it needs a test-order route (100%-off code, staging store or a payment provider's test mode), which a pre-flight tool shouldn't do against production without agreement.
- **Consent "granted by default" is reported as a legal question, not a defect.** India's DPDP Act requires consent for personal data processing and its rules are being phased in; that's a call for legal, so it's Low with "needs confirmation".

## Trade-offs

- **Safe mode by default.** Captured beacons are answered locally (HTTP 204) so audits don't add fake sessions, add-to-carts or click IDs to the client's data. Cost: vendor-side rejections (e.g. a 4xx from Meta) are only visible with `--live`.
- **One run is a snapshot.** Real stores are not perfectly repeatable: across runs, the GTM Meta pixel's ViewContent and GoKwik's GA4 item format varied. The tool reports what it saw. A `--runs N` mode that reports *flaky* tags separately would be the next step.
- **Lab, not field, performance.** LCP/CLS come from one emulated-phone load on a fast connection, so they're labelled as such. Field data (Chrome UX Report) would be a better launch gate for speed.
- **Network observation vs vendor debug tools.** GA4 DebugView, Meta Test Events and Tag Assistant need account access. Reading the wire works from the outside with zero credentials, which is what an independent pre-flight check needs. The cost is reverse-engineering each vendor's format; decoders are isolated and unit-tested for that reason.
- **Rules over a score.** A "78/100" invites arguing about weights. A verdict with an explicit rule (any blocker, so not ready) is easier to act on and defend.
- **Playwright with installed browsers** (`playwright-core`, Edge or Chrome) rather than a bundled browser: a lighter install and the same engine real users run.
