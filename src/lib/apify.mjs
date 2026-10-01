// Appel d'un actor Apify en 3 temps (Run actor → Get run → Get dataset items) : ces trois
// endpoints existent pour tous les actors, contrairement au raccourci run-sync.

const API = 'https://api.apify.com/v2';
const DEFAULT_INPUT = '{"startUrls":[{"url":"{{url}}"}],"maxItems":{{max}}}';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// L'API attend « utilisateur~nom-actor » ; la marketplace affiche « utilisateur/nom-actor ».
export function actorPath(actor) {
  return encodeURIComponent(actor.replace('/', '~')).replace('%7E', '~');
}

// APIFY_INPUT permet d'adapter l'entrée à n'importe quel actor sans toucher au code :
// {{url}} est remplacé par l'URL de recherche, {{max}} par la limite d'annonces.
export function buildInput(template, url, max) {
  const json = (template || DEFAULT_INPUT)
    .replaceAll('{{url}}', url.replace(/"/g, '\\"'))
    .replaceAll('{{max}}', String(max));
  return JSON.parse(json);
}

export async function runActor({ token, actor, url, max, inputTemplate, maxWaitMs = 300000, pollMs = 5000, fetchImpl = fetch }) {
  const call = async (path, options = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetchImpl(`${API}${path}${sep}token=${token}`, options);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify ${res.status} sur ${path.split('?')[0]} ${body.slice(0, 200)}`);
    }
    return res.json();
  };

  const start = await call(`/acts/${actorPath(actor)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInput(inputTemplate, url, max)),
  });
  let run = start.data;
  const deadline = Date.now() + maxWaitMs;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() > deadline) throw new Error(`run ${run.id} non terminé après ${maxWaitMs / 1000}s`);
    await sleep(pollMs);
    run = (await call(`/actor-runs/${run.id}`)).data;
  }
  if (run.status !== 'SUCCEEDED') {
    let tail = '';
    try {
      const res = await fetchImpl(`${API}/actor-runs/${run.id}/log?token=${token}`);
      tail = (await res.text()).slice(-1200);
    } catch { /* le log n'est qu'une aide au diagnostic */ }
    throw new Error(`run ${run.id} terminé en ${run.status}${tail ? `\n${tail}` : ''}`);
  }
  const items = await call(`/datasets/${run.defaultDatasetId}/items?clean=true`);
  return { items, costUsd: run.usageTotalUsd ?? null };
}
