// POST /api/start {url, device} → starts the audit workflow, returns {id} to poll with.
import { gh, json, handle, HttpError, WORKFLOW, ALLOWED_HOSTS } from '../lib/github.mjs';

const MAX_RUNNING = 3;

export default handle(async req => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const { url, device } = await req.json().catch(() => ({}));

  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, 'That is not a valid link.'); }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.host)) throw new HttpError(400, 'This demo only checks neemans.com pages. Paste a neemans.com product or collection link.');

  // A small brake so the page can't queue up dozens of browser runs at once.
  const busy = await (await gh(`/actions/workflows/${WORKFLOW}/runs?status=in_progress&per_page=10`)).json();
  const queued = await (await gh(`/actions/workflows/${WORKFLOW}/runs?status=queued&per_page=10`)).json();
  if (busy.total_count + queued.total_count >= MAX_RUNNING) throw new HttpError(429, 'A few checks are already running. Try again in a couple of minutes.');

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { url: u.href, request_id: id, device: device === 'desktop' ? 'desktop' : 'mobile' } }),
  });
  return json({ id });
});

export const config = { path: '/api/start' };
