// Affiche le schéma d'entrée de l'actor Apify configuré (aucun run lancé, aucun coût).
//   APIFY_TOKEN=... APIFY_ACTOR=... node src/apify-schema.mjs
import { fetchInputSchema, costlyOptions } from './lib/apify.mjs';

const token = process.env.APIFY_TOKEN;
const actor = process.env.APIFY_ACTOR;
if (!token || !actor) {
  console.error('APIFY_TOKEN et APIFY_ACTOR requis.');
  process.exit(1);
}
const schema = await fetchInputSchema({ token, actor });
if (!schema) {
  console.error('Schéma indisponible.');
  process.exit(1);
}
for (const [key, p] of Object.entries(schema.properties || {})) {
  console.log(`${key} | ${p.type} | défaut=${JSON.stringify(p.default ?? p.prefill ?? null)} | ${p.title || ''} | ${(p.description || '').replace(/\s+/g, ' ').slice(0, 220)}`);
}
console.log('Options payantes désactivées automatiquement :', JSON.stringify(costlyOptions(schema)));
