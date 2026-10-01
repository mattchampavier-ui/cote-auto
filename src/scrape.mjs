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
      // L'actor fixé dans config.json prime sur la variable GitHub APIFY_ACTOR.
      const actor = config.scrape.actor || process.env.APIFY_ACTOR;
      if (!token || !actor) {
        const missing = [!token && 'APIFY_TOKEN', !actor && 'APIFY_ACTOR'].filter(Boolean).join(' et ');
        console.warn(`${missing} manquant : relevé sauté (voir README, étape 2 — APIFY_ACTOR peut être une variable ou un secret).`);
        return { skipped: true };
      }
      fetchItems = (m) => runActor({ token, actor, url: buildSearchUrl(m), max, inputTemplate: process.env.APIFY_INPUT || undefined, maxChargeUsd: config.scrape.maxChargePerRunUsd });
    }
  }

  const run = { date: today, ok: [], empty: [], failed: [], costUsd: 0 };
  let registryChanged = false;

  // Garde-fou budget : dépense Apify du mois en cours (relevés précédents + celui-ci).
  const month = today.slice(0, 7);
  const budget = Number(config.scrape.monthlyBudgetUsd) || Infinity;
  const spentBefore = (data.meta?.runs || []).filter((r) => r.date.slice(0, 7) === month).reduce((a, r) => a + (r.costUsd || 0), 0);

  for (const model of models) {
    if (spentBefore + run.costUsd >= budget) {
      console.warn(`Budget Apify du mois atteint (${round(spentBefore + run.costUsd, 2)} $ / ${budget} $) : relevé arrêté.`);
      run.budgetReached = true;
      break;
    }
    console.log(`→ ${model.name}`);
    try {
      const { items, costUsd, log } = await fetchItems(model);
      if (log) console.warn(`  --- journal de l'actor (réponse vide) ---\n${log}\n  ---`);
      if (costUsd) run.costUsd += costUsd;
      const listings = (Array.isArray(items) ? items : []).map(normalizeItem);
      // Contrôle du format : part des annonces pour lesquelles prix, km et année ont été lus.
      if (listings.length) {
        const share = (k) => Math.round((100 * listings.filter((l) => l[k] != null).length) / listings.length);
        console.log(`  lus : prix ${share('price')} %, km ${share('km')} %, année ${share('year')} %, id ${share('id')} %`);
        if (share('km') < 50 || share('year') < 50) {
          console.log(`  champs reçus : ${Object.keys(items[0]).join(', ')}`);
          console.log(`  attributs (extrait) : ${JSON.stringify(items[0].attributes ?? null).slice(0, 600)} | ${JSON.stringify(items[0].attributesRaw ?? null).slice(0, 600)}`);
        }
      }
      const { kept, rejected } = filterRelevant(listings, model, config.filters);
      if (kept.length === 0) {
        console.warn(`  0 annonce retenue sur ${listings.length} reçues — vérifier les critères de recherche ou le format de l'actor.`);
        if (items?.length) {
          // Diagnostic : de quoi est faite la réponse de l'actor, pour ajuster APIFY_INPUT ou le mapping.
          const reasons = {};
          for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
          const raw = items[0];
          console.warn(`  raisons : ${JSON.stringify(reasons)}`);
          console.warn(`  champs reçus : ${Object.keys(raw).join(', ')}`);
          console.warn(`  exemple normalisé : ${JSON.stringify({ ...listings[0], body: listings[0].body.slice(0, 80) })}`);
          console.warn(`  exemple brut : ${JSON.stringify(raw).slice(0, 1200)}`);
        }
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
