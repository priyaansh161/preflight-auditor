# Pre-flight audit: Adaptis Sneakers For Men : Beige

https://neemans.com/products/adaptis-sneakers-for-men-beige
2026-10-12T10:43:19.776Z · mobile · safe mode

## Verdict: Works for shoppers, but tracking needs fixes
The page sells, but 2 high-severity tracking issues mean ad platforms would get wrong numbers. Fix (or confirm) these before scaling spend.

## High (2)
- **Two Meta pixels both report "AddToCart"** _(needs confirmation)_ — Double counting, owner: Marketing / ads team
  - Saw: Each time the shopper added to cart, the event is sent to 2 pixels: 223335195137418 (via tmgoogletagmanager) and 558552204508330 (via shopify_web_pixel).
  - Why: If both pixels sit in the same ad account or dataset, Meta counts each conversion twice and reported ROAS is overstated. If they belong to separate accounts (e.g. an agency), this is intentional.
  - Fix: Confirm in Meta Events Manager which pixel your campaigns optimise on; retire the other or remove it from this site.
- **Two Meta pixels both report "InitiateCheckout"** _(needs confirmation)_ — Double counting, owner: Marketing / ads team
  - Saw: Each time the shopper started checkout, the event is sent to 2 pixels: 558552204508330 (via shopify_web_pixel) and 223335195137418 (via tmgoogletagmanager).
  - Why: If both pixels sit in the same ad account or dataset, Meta counts each conversion twice and reported ROAS is overstated. If they belong to separate accounts (e.g. an agency), this is intentional.
  - Fix: Confirm in Meta Events Manager which pixel your campaigns optimise on; retire the other or remove it from this site.

## Medium (8)
- **2 uncaught JavaScript errors on the page** — Page & shopper experience, owner: Developer
  - Saw: Script errors were thrown: 1 during "Scrolling through the page", 1 during "Starting checkout (no order placed)".
  - Why: A crashing script can stop a tag (or a button) from working for some shoppers. None broke the tested journey, but they make the page fragile.
  - Fix: Have a developer trace each error to its script and fix or remove it.
- **Page jumps around while loading (CLS 0.177)** — Page & shopper experience, owner: Developer
  - Saw: Cumulative Layout Shift: 0.177 (good ≤ 0.1). Measured once on an emulated phone over a fast connection — real shoppers on 4G will see it slower.
  - Why: Content that moves under a thumb causes mis-taps and frustration on mobile.
  - Fix: Reserve space for banners, images and widgets that load late.
- **Extra page views counted with no new page (choosing an in-stock size)** — Double counting, owner: Analytics
  - Saw: No new page loaded, but 6 page-view hits went out (Meta Pixel 223335195137418, Meta Pixel 558552204508330, Google Analytics 4 G-3042L5GP9T, Google Ads AW-766814719, Google Analytics 4 G-5RYZDGXEFH, Google Analytics 4 G-VDE0ZFZ4LP). The theme rewrites the address bar (history change) when a size is picked, and the tags treat that as a new page.
  - Why: Page views and sessions are inflated and engagement rate / bounce rate are distorted. Meta also receives extra PageView signals.
  - Fix: In GA4 turn off "page changes based on browser history events" (or exclude this theme's replaceState), and remove History Change triggers from page-view tags in GTM.
- **2 Google Analytics properties track this page** _(needs confirmation)_ — Double counting, owner: Analytics
  - Saw: Page views go to G-3042L5GP9T, G-VDE0ZFZ4LP. Ecommerce events go to: G-3042L5GP9T.
  - Why: Teams reading different properties will see different numbers; any property linked to Google Ads must have complete ecommerce data.
  - Fix: Document which property is the source of truth and which is linked to Google Ads; remove stale ones.
- **3 Google Ads conversion actions fire when the shopper viewed the product** _(needs confirmation)_ — Double counting, owner: Marketing / ads team
  - Saw: One shopper action triggered: AW-766814719 u-vGCKSF3_YbEP_T0u0C; AW-766814719 CXh7CI2gxvoaEP_T0u0C; AW-766814719 Lej_CISgxvoaEP_T0u0C.
  - Why: If more than one is set as a "Primary" conversion, Google Ads counts this action several times and bids on inflated numbers.
  - Fix: In Google Ads → Goals → Conversions, keep exactly one of these as Primary for this action; mark the rest Secondary or remove them.
- **3 Google Ads conversion actions fire when the shopper added to cart** _(needs confirmation)_ — Double counting, owner: Marketing / ads team
  - Saw: One shopper action triggered: AW-766814719 lwnICJ6F3_YbEP_T0u0C; AW-766814719 q-ZgCJzr64UYEP_T0u0C; AW-766814719 zbObCJD0uPoaEP_T0u0C.
  - Why: If more than one is set as a "Primary" conversion, Google Ads counts this action several times and bids on inflated numbers.
  - Fix: In Google Ads → Goals → Conversions, keep exactly one of these as Primary for this action; mark the rest Secondary or remove them.
- **3 Google Ads conversion tags report a value of ₹0** _(needs confirmation)_ — Data accuracy, owner: Marketing / ads team
  - Saw: Older GTM conversion tags fire on shopper actions with value 0: Adding the item to the cart → label q-ZgCJzr64UYEP_T0u0C; Adding the item to the cart → label zbObCJD0uPoaEP_T0u0C; Starting checkout (no order placed) → label ubtwCIegxvoaEP_T0u0C.
  - Why: If any of these are used in Max Conversion Value / Target ROAS bidding, Google learns that these conversions are worth nothing.
  - Fix: Pass the cart value into these tags, or confirm they are Secondary (observation-only) conversions.
- **Meta Pixel reports its own errors in the browser** — Data accuracy, owner: Developer
  - Saw: [Meta Pixel] - Invalid parameter format for currency.
  - Why: Meta rejects or ignores the malformed parameter, so the affected event loses value or matching data.
  - Fix: Find the custom event sending the bad parameter (Meta Pixel Helper shows it) and fix its format.

## Low (4)
- **85 outside domains load on this page (28+ separate vendors)** — Page & shopper experience, owner: Marketing / ads team
  - Saw: 456 requests went to 85 outside domains; 28 vendors could be named, the rest are unidentified (full list in the appendix).
  - Why: Each vendor adds load time and another script that can break. Old, unused vendors are common in this list.
  - Fix: Review the vendor list with marketing and remove anything no one is using.
- **Google Ads: no "begin_checkout" event when the shopper started checkout** _(needs confirmation)_ — Tags present & firing, owner: Developer
  - Saw: The shopper started checkout, but Google Ads never received "begin_checkout". A classic conversion tag did fire at this step (label ubtwCIegxvoaEP_T0u0C).
  - Why: Probably covered by the classic conversion tag; only matters if remarketing audiences rely on the standard event.
  - Fix: Add or fix the "begin_checkout" tag/trigger for this step.
- **Same action tracked under two event names in GA4** — Double counting, owner: Analytics
  - Saw: Alongside the standard events, GA4 also receives: ADD-TO-CART-GA4-V2 (≈ add_to_cart).
  - Why: Harmless on its own, but if someone marks the custom one as a key event or imports it into Google Ads, the action is counted twice.
  - Fix: Retire the legacy custom events, or make sure only the standard event is a key event.
- **All tracking is switched on before the visitor agrees to anything** _(needs confirmation)_ — Privacy & consent, owner: Marketing / ads team
  - Saw: Consent Mode default is "granted" for ad_storage, ad_user_data, ad_personalization, analytics_storage, and no consent banner changed it.
  - Why: Good for measurement: nothing is held back. The risk is regulatory: India's DPDP Act requires consent for processing personal data, with its rules being phased in. A legal call, not a launch blocker.
  - Fix: Confirm the policy with legal; if a banner is added later, re-run this audit to make sure tags still fire after "Accept".

## Passed (17)
- Page loads (HTTP 200) at the address the ad points to
- In stock (6 of 6 sizes available)
- Add to cart works (size UK 6 landed in the cart)
- Main content appears quickly (LCP 1.2s)
- All scripts loaded successfully
- Google Analytics 4 is installed and firing (G-3042L5GP9T, G-VDE0ZFZ4LP)
- Meta Pixel is installed and firing (558552204508330, 223335195137418)
- Google Ads is installed and firing (AW-766814719, AW-876772125)
- No false "add to cart" when the shopper forgets to pick a size
- No event fired twice to the same account for one action
- Prices and currency match the store on every platform (₹4,499 INR)
- Product IDs in tags match the Shopify catalogue
- Meta conversion events carry an event ID (safe to combine with server-side tracking)
- UTM and click-ID parameters survive the landing
- Google Ads click ID (gclid) is stored for later conversions
- Meta click ID (fbclid) is stored for later conversions
- GA4 receives the campaign (UTM) parameters
