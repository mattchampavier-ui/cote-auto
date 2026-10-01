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

// Entrées connues des actors LeBonCoin testés : pas besoin de régler APIFY_INPUT pour eux.
// (Un actor qui ne reconnaît pas ses paramètres renvoie ses résultats par défaut, hors sujet.)
export const ACTOR_INPUTS = {
  'clearpath/leboncoin-api': '{"searchUrl":"{{url}}","adLimit":{{max}}}',
  'clearpath/leboncoin-api-ppe': '{"searchUrl":"{{url}}","adLimit":{{max}}}',
};

export function inputTemplateFor(actor, override) {
  return override || ACTOR_INPUTS[String(actor).replace('~', '/').toLowerCase()] || DEFAULT_INPUT;
}

// APIFY_INPUT permet d'adapter l'entrée à n'importe quel autre actor sans toucher au code :
// {{url}} est remplacé par l'URL de recherche, {{max}} par la limite d'annonces.
export function buildInput(template, url, max) {
  const json = (template || DEFAULT_INPUT)
    .replaceAll('{{url}}', url.replace(/"/g, '\\"'))
    .replaceAll('{{max}}', String(max));
  return JSON.parse(json);
}

// Schéma d'entrée de l'actor (lecture seule, gratuit).
export async function fetchInputSchema({ token, actor, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${API}/acts/${actorPath(actor)}/builds/default?token=${token}`);
    if (!res.ok) return null;
    const build = (await res.json()).data || {};
    const raw = build.inputSchema ?? build.actorDefinition?.input;
    return typeof raw === 'string' ? JSON.parse(raw) : raw || null;
  } catch {
    return null;
  }
}

// Options facturées en plus de l'annonce et inutiles pour suivre une cote : profils vendeurs,
// numéros de téléphone, détail de chaque annonce... On les force à false (ou 0).
const COSTLY = /seller|vendeur|profil|profile|owner|phone|t[ée]l[ée]phone|contact|store|boutique/i;
export function costlyOptions(schema) {
  const off = {};
  for (const [key, p] of Object.entries(schema?.properties || {})) {
    const text = `${key} ${p.title || ''}`;
    if (!COSTLY.test(text)) continue;
    if (p.type === 'boolean') off[key] = false;
  }
  return off;
}

let costlyCache = null;

export async function runActor({ token, actor, url, max, inputTemplate, maxChargeUsd, maxWaitMs = 300000, pollMs = 5000, fetchImpl = fetch }) {
  if (costlyCache === null) {
    costlyCache = costlyOptions(await fetchInputSchema({ token, actor, fetchImpl }));
    if (Object.keys(costlyCache).length) console.log(`  options payantes désactivées : ${Object.keys(costlyCache).join(', ')}`);
  }
  const call = async (path, options = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetchImpl(`${API}${path}${sep}token=${token}`, options);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify ${res.status} sur ${path.split('?')[0]} ${body.slice(0, 200)}`);
    }
    return res.json();
  };

  // maxTotalChargeUsd : plafond de facturation du run imposé par Apify (actors payés à l'événement).
  const cap = maxChargeUsd ? `?maxTotalChargeUsd=${maxChargeUsd}` : '';
  const start = await call(`/acts/${actorPath(actor)}/runs${cap}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...buildInput(inputTemplateFor(actor, inputTemplate), url, max), ...costlyCache }),
  });
  let run = start.data;
  const deadline = Date.now() + maxWaitMs;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() > deadline) throw new Error(`run ${run.id} non terminé après ${maxWaitMs / 1000}s`);
    await sleep(pollMs);
    run = (await call(`/actor-runs/${run.id}`)).data;
  }
  const logTail = async () => {
    try {
      const res = await fetchImpl(`${API}/actor-runs/${run.id}/log?token=${token}`);
      return (await res.text()).slice(-1500);
    } catch { return ''; } // le log n'est qu'une aide au diagnostic
  };
  if (run.status !== 'SUCCEEDED') {
    const tail = await logTail();
    throw new Error(`run ${run.id} terminé en ${run.status}${tail ? `\n${tail}` : ''}`);
  }
  const items = await call(`/datasets/${run.defaultDatasetId}/items?clean=true`);
  // Réponse vide : le journal de l'actor dit pourquoi (limite d'essai, URL refusée, blocage...).
  const log = Array.isArray(items) && items.length === 0 ? await logTail() : undefined;
  // Coût : ce qu'Apify déclare, ou à défaut une estimation prudente (0,3 ct par annonce + démarrage).
  const declared = Number(run.usageTotalUsd) || 0;
  const estimate = (Array.isArray(items) ? items.length : 0) * 0.003 + 0.009;
  return { items, costUsd: Math.max(declared, estimate), log };
}
