// Affiche le schéma d'entrée de l'actor Apify configuré (aucun run lancé, aucun coût).
//   APIFY_TOKEN=... APIFY_ACTOR=... node src/apify-schema.mjs
import { fetchInputSchema, fetchActorInfo, costlyOptions } from './lib/apify.mjs';

const token = process.env.APIFY_TOKEN;
const actor = process.env.APIFY_ACTOR;
if (!token || !actor) {
  console.error('APIFY_TOKEN et APIFY_ACTOR requis.');
  process.exit(1);
}
console.log(`Actor : ${actor}`);
const schema = await fetchInputSchema({ token, actor });
if (!schema) {
  console.error('Schéma indisponible.');
  process.exit(1);
}
for (const [key, p] of Object.entries(schema.properties || {})) {
  console.log(`${key} | ${p.type} | défaut=${JSON.stringify(p.default ?? p.prefill ?? null)} | ${p.title || ''} | ${(p.description || '').replace(/\s+/g, ' ').slice(0, 220)}`);
}
console.log('Options payantes désactivées automatiquement :', JSON.stringify(costlyOptions(schema)));
// Tarification (pay-per-event / pay-per-result) et exemple de sortie, pour estimer le coût.
const info = await fetchActorInfo({ token, actor });
if (info) {
  console.log('Tarification :', JSON.stringify(info.pricingInfos?.at(-1) ?? info.pricingInfo ?? null).slice(0, 1500));
  const ds = info.dataset ? JSON.stringify(info.dataset).slice(0, 1500) : null;
  if (ds) console.log('Format de sortie :', ds);
}
