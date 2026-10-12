// Shared helpers for the two web functions. The GitHub token lives only in Netlify's
// environment (GH_AUDIT_TOKEN): a fine-grained token limited to this repo's Actions.
export const REPO = process.env.GH_AUDIT_REPO || 'priyaansh161/preflight-auditor';
export const WORKFLOW = 'audit.yml';

// The public page only audits the assignment's test site, so it can't be used to point a
// browser at arbitrary URLs. Run the CLI yourself to audit anything else.
export const ALLOWED_HOSTS = ['neemans.com', 'www.neemans.com'];

export async function gh(path, init = {}) {
  const token = process.env.GH_AUDIT_TOKEN;
  if (!token) throw new HttpError(500, 'The server is missing its GitHub token (GH_AUDIT_TOKEN).');
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...init.headers },
  });
  // GitHub has brief 5xx / rate-limit blips; mark them retryable so the page keeps waiting.
  if (!res.ok && res.status !== 302) throw new HttpError(res.status >= 500 || res.status === 429 ? 503 : 502, `GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const handle = fn => async req => {
  try { return await fn(req); }
  catch (e) { return json({ error: e.message }, e.status || 500); }
};
