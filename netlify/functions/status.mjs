// GET /api/status?id=… → {state: 'queued'|'running'|'done'|'failed', step?, report?}
// Finds the workflow run by its run-name ("audit <id>"), and once it has finished,
// unzips the report artifact and returns the HTML so the page can show it.
import { unzipSync, strFromU8 } from 'fflate';
import { gh, json, handle, HttpError, WORKFLOW } from '../lib/github.mjs';

export default handle(async req => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[a-z0-9-]{6,30}$/.test(id)) throw new HttpError(400, 'Bad id.');

  const runs = await (await gh(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`)).json();
  const run = runs.workflow_runs.find(r => r.display_title === `audit ${id}`);
  if (!run) return json({ state: 'queued' });                       // GitHub takes a few seconds to register it
  if (run.status !== 'completed') return json({ state: run.status === 'in_progress' ? 'running' : 'queued', step: await currentStep(run.id), runUrl: run.html_url });
  if (run.conclusion !== 'success') return json({ state: 'failed', runUrl: run.html_url, error: `The audit run ended with "${run.conclusion}".` });

  const arts = await (await gh(`/actions/runs/${run.id}/artifacts`)).json();
  const art = arts.artifacts.find(a => a.name === 'report');
  if (!art) return json({ state: 'failed', runUrl: run.html_url, error: 'The run finished but produced no report.' });
  const zip = new Uint8Array(await (await gh(`/actions/artifacts/${art.id}/zip`)).arrayBuffer());
  const files = unzipSync(zip);
  const report = JSON.parse(strFromU8(files['report.json']));
  return json({ state: 'done', runUrl: run.html_url, html: strFromU8(files['report.html']), verdict: report.verdict });
});

async function currentStep(runId) {
  try {
    const { jobs } = await (await gh(`/actions/runs/${runId}/jobs`)).json();
    return jobs[0]?.steps?.find(s => s.status === 'in_progress')?.name || null;
  } catch { return null; }
}

export const config = { path: '/api/status' };
