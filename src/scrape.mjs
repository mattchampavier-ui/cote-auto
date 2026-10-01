// Relevé des annonces : pour chaque véhicule actif de models.json, lance l'actor Apify sur
// l'URL de recherche générée, filtre les annonces hors sujet, met à jour le suivi annonce par
// annonce (listings.json) et ajoute un relevé daté dans data.json.
//
//   node src/scrape.mjs                     tous les véhicules
//   node src/scrape.mjs --only id1,id2      seulement ceux-là (ex. véhicule tout juste ajouté)
//   node src/scrape.mjs --fixture dossier   rejoue des réponses enregistrées (<id>.json), sans Apify
//
// Un échec sur un véhicule n'interrompt jamais les autres.

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, todayISO, parseArgs } from './lib/io.mjs';
import { runActor } from './lib/apify.mjs';
import { buildSearchUrl } from './lib/search.mjs';
import { normalizeItem, filterRelevant } from './lib/listings.mjs';
import { updateTracking, buildSnapshot } from './lib/market.mjs';
import { round } from './lib/stats.mjs';

export async function scrape({ only, fixture, today = todayISO(), fetchItems } = {}) {
  const config = await readJson('config.json');
  const registry = await readJson('models.json');
  const data = await readJson('data.json');
  const tracking = await readJson('listings.json');
  const max = Number(process.env.MAX_ITEMS_PER_MODEL || config.scrape.maxItemsPerModel || 60);

  const wanted = only ? new Set(String(only).split(',').map((s) => s.trim())) : null;
  const models = registry.models.filter((m) => m.active !== false && (!wanted || wanted.has(m.id)));

  if (!fetchItems) {
    if (fixture) {
      fetchItems = async (m) => ({ items: JSON.parse(await fs.readFile(path.join(fixture, `${m.id}.json`), 'utf-8')) });
    } else {
      const token = process.env.APIFY_TOKEN;
      const actor = process.env.APIFY_ACTOR;
      if (!token || !actor) {
        console.warn('APIFY_TOKEN ou APIFY_ACTOR manquant : relevé sauté (voir README, étape 2).');
        return { skipped: true };
      }
      fetchItems = (m) => runActor({ token, actor, url: buildSearchUrl(m), max, inputTemplate: process.env.APIFY_INPUT || undefined });
    }
  }

  const run = { date: today, ok: [], empty: [], failed: [], costUsd: 0 };
  let registryChanged = false;

  for (const model of models) {
    console.log(`→ ${model.name}`);
    try {
      const { items, costUsd } = await fetchItems(model);
      if (costUsd) run.costUsd += costUsd;
      const listings = (Array.isArray(items) ? items : []).map(normalizeItem);
      const { kept, rejected } = filterRelevant(listings, model, config.filters);
      if (kept.length === 0) {
        console.warn(`  0 annonce retenue sur ${listings.length} reçues — vérifier les critères de recherche ou le format de l'actor.`);
        run.empty.push(model.id);
        continue;
      }
      if (!model.refKm) {
        const kms = kept.map((l) => l.km).filter(Boolean).sort((a, b) => a - b);
        if (kms.length) {
          model.refKm = round(kms[Math.floor(kms.length / 2)], -4);
          registryChanged = true;
        }
      }
      const truncated = listings.length >= max;
      const state = (tracking[model.id] ||= {});
      const t = updateTracking(state, kept, today, { complete: !truncated });
      const snap = buildSnapshot(kept, rejected, model, t, { today, truncated, bargainThreshold: config.scrape.bargainThreshold });
      const history = (data.snapshots[model.id] ||= []);
      // Relancé le même jour : on remplace le relevé du jour au lieu d'en empiler un second.
      const same = history.findIndex((s) => s.date === today && s.source !== 'manuel');
      if (same >= 0) history[same] = snap;
      else history.push(snap);
      history.sort((a, b) => a.date.localeCompare(b.date));
      run.ok.push(model.id);
      console.log(`  ${kept.length} retenues / ${listings.length} reçues, médiane ${snap.median} €, ${snap.newListings} nouvelles, ${snap.sold} parties`);
    } catch (err) {
      console.error(`  échec : ${err.message}`);
      run.failed.push({ id: model.id, error: err.message.split('\n')[0].slice(0, 300) });
    }
  }

  run.costUsd = round(run.costUsd, 3);
  data.meta ||= {};
  data.meta.lastRun = today;
  data.meta.runs = [...(data.meta.runs || []), run].slice(-30);
  await writeJson('data.json', data);
  await writeJson('listings.json', tracking);
  if (registryChanged) await writeJson('models.json', registry);
  console.log(`Terminé : ${run.ok.length} ok, ${run.empty.length} vides, ${run.failed.length} en échec.`);
  return run;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  scrape({ only: args.only, fixture: args.fixture, today: args.date || undefined })
    .then((run) => {
      // Échec du job seulement si TOUT a échoué : un véhicule en erreur ne doit pas masquer les autres.
      if (run && !run.skipped && run.ok.length === 0 && run.failed.length > 0) process.exit(1);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
