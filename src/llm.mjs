// Optional LLM layer. It is given the deterministic findings and the list of event names
// observed, and does two narrow jobs that rules do badly:
//   1. Write the executive summary a marketing lead reads first (prioritising, plain English).
//   2. Review custom event names (e.g. "ADD-TO-CART-GA4-V2", "buy_now") and say which look
//      like a standard funnel event under another name — fuzzy naming is where rules break.
// It cannot add findings, change severities or the verdict. Without an API key the audit is
// complete; this section is simply omitted.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODEL = 'claude-opus-5-5';

const Output = z.object({
  executive_summary: z.string().describe('3-5 sentences for a marketing head. Plain English, no jargon, no new facts.'),
  top_actions: z.array(z.object({ action: z.string(), why: z.string() })).describe('The 3 fixes that matter most before spending, in order.'),
  event_name_review: z.array(z.object({
    platform: z.string(),
    event: z.string(),
    looks_like: z.string().describe('The standard funnel event it duplicates (view_item, add_to_cart, begin_checkout, purchase), or "none".'),
    note: z.string(),
  })),
});

const SYSTEM = `You are a senior marketing-analytics consultant reviewing an automated pre-launch audit of an ecommerce landing page.
You receive findings produced by deterministic checks. They are facts; do not dispute them, do not invent new issues, do not change severities.
Write for a marketing head who does not know what a pixel or dataLayer is. Use rupee and business language (wasted spend, inflated ROAS, wrong credit).
Where a finding is marked "needs confirmation", say what to confirm rather than asserting it is broken.
For event_name_review, look only at the custom event names provided and flag ones that appear to record the same shopper action as a standard funnel event. Leave out names that are clearly unrelated (engagement, loyalty widgets, performance timings).`;

export async function explain({ verdict, findings, events, page }) {
  const client = new Anthropic();
  const issues = findings.filter(f => f.severity !== 'pass').map(({ evidence, ...f }) => f);
  const standard = new Set(['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase', 'conversion', 'remarketing', '(hit)']);
  const custom = [...new Set(events.filter(e => e.event && !standard.has(e.event)).map(e => `${e.platform}: ${e.event}`))];

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(Output) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: JSON.stringify({ page: page.title, url: page.url, verdict, findings: issues, custom_event_names: custom }, null, 1),
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The model declined to summarise this audit.');
  if (!response.parsed_output) throw new Error(`No structured output (stop reason: ${response.stop_reason}).`);
  return { model: response.model, ...response.parsed_output };
}
