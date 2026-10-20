// Import d'un relevé manuel fait par Claude dans Chrome (voir releve.html).
//
//   node src/import.mjs imports/2026-11-01/peugeot-206-rc.json [autres fichiers...]
//
// Formats acceptés :
//   un véhicule  : { "vehicule": "peugeot-206-rc", "date": "2026-11-01", "annonces": [ ... ] }
//   plusieurs    : { "date": "2026-11-01", "vehicules": { "peugeot-206-rc": [ ... ], ... } }
// Une annonce : { "id", "titre", "prix", "km", "annee", "carburant", "boite", "ville", "cp",
//                 "pro", "publiee", "url" } — seuls id (ou url) et prix sont indispensables.
//
// Les annonces passent ensuite par exactement le même traitement que la collecte automatique :
// filtres de pertinence, suivi annonce par annonce, relevé daté, score.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, readJson, writeJson, ROOT } from './lib/io.mjs';
import { scrape } from './scrape.mjs';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const digits = String(v).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
};

// Annonce saisie (format simple, en français) → objet au format brut que comprend normalizeItem.
export function toRawItem(a) {
  const id = a.id != null ? String(a.id).replace(/\D/g, '') : (String(a.url || '').match(/(\d{6,})/) || [])[1];
  const isPro = a.pro === true || /^(pro|oui|true)$/i.test(String(a.pro ?? a.vendeur ?? ''));
  const isPrivate = a.pro === false || /^(particulier|non|false)$/i.test(String(a.pro ?? a.vendeur ?? ''));
  return {
    id,
    title: a.titre ?? a.title ?? '',
    description: a.description ?? '',
    price: num(a.prix ?? a.price),
    mileage: num(a.km ?? a.kilometrage),
    year: num(a.annee ?? a.year),
    url: a.url || (id ? `https://www.leboncoin.fr/ad/voitures/${id}` : null),
    firstPublishedAt: a.publiee ?? a.date ?? null,
    location: { city: a.ville ?? null, zipcode: a.cp ?? a.code_postal ?? null, department: a.departement ?? null },
    seller: isPro ? { type: 'pro' } : isPrivate ? { type: 'private' } : null,
    attributes: Object.fromEntries(Object.entries({ fuel: a.carburant, gearbox: a.boite }).filter(([, v]) => v)),
  };
}

// Lit les fichiers et les regroupe par date de relevé : { date: { vehicleId: [raw items] } }.
export async function readImports(files) {
  const byDate = {};
  const errors = [];
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (err) {
      errors.push(`${file} : JSON invalide (${err.message})`);
      continue;
    }
    const fromName = (file.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    const date = json.date || fromName;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`${file} : date du relevé absente (champ "date" au format AAAA-MM-JJ)`);
      continue;
    }
    const groups = json.vehicules || (json.vehicule ? { [json.vehicule]: json.annonces || [] } : null);
    if (!groups) {
      errors.push(`${file} : ni "vehicule" + "annonces", ni "vehicules"`);
      continue;
    }
    // "total" = nombre de résultats affiché par LeBonCoin pour la recherche (facultatif).
    const totals = json.totaux || (json.vehicule ? { [json.vehicule]: json.total } : {});
    for (const [id, list] of Object.entries(groups)) {
      const g = ((byDate[date] ||= {})[id] ||= { items: [], total: null });
      g.items.push(...(Array.isArray(list) ? list : []).map(toRawItem));
      const t = num(totals[id]);
      if (t != null) g.total = t;
    }
  }
  return { byDate, errors };
}

export async function importFiles(files) {
  const { models } = await readJson('models.json');
  const config = await readJson('config.json');
  const known = new Set(models.filter((m) => m.active !== false).map((m) => m.id));
  const { byDate, errors } = await readImports(files);
  const runs = [];
  for (const [date, groups] of Object.entries(byDate).sort()) {
    const unknown = Object.keys(groups).filter((id) => !known.has(id));
    for (const id of unknown) errors.push(`véhicule inconnu ou retiré : « ${id} » (identifiants : ${[...known].join(', ')})`);
    const ids = Object.keys(groups).filter((id) => known.has(id));
    if (!ids.length) continue;
    runs.push(await scrape({
      today: date,
      only: ids.join(','),
      source: 'chrome',
      max: config.releve?.annoncesParVehicule || 20,
      // Sans total connu, on considère le relevé partiel : pas de « vente » déduite d'une absence.
      fetchItems: async (m) => ({ items: groups[m.id].items, complete: groups[m.id].total != null && groups[m.id].items.length >= groups[m.id].total }),
    }));
  }
  for (const e of errors) console.error(`⚠ ${e}`);
  return { runs, errors };
}

// Fichiers de imports/ pas encore importés (la liste des fichiers traités est gardée dans
// data.json : un fichier n'est jamais importé deux fois).
export async function pendingImports() {
  const data = await readJson('data.json');
  const done = new Set(data.meta?.importedFiles || []);
  const out = [];
  const walk = async (dir) => {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.json')) {
        const rel = path.relative(ROOT, full);
        if (!done.has(rel)) out.push(rel);
      }
    }
  };
  await walk(path.join(ROOT, 'imports'));
  return out.sort();
}

async function markImported(files) {
  const data = await readJson('data.json');
  data.meta ||= {};
  data.meta.importedFiles = [...new Set([...(data.meta.importedFiles || []), ...files])].sort();
  await writeJson('data.json', data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  let rels = process.argv.slice(2).filter((a) => a.endsWith('.json'));
  if (args.pending) rels = await pendingImports();
  if (args.pending && !rels.length) {
    console.log('Aucun nouveau fichier à importer.');
    process.exit(0);
  }
  const files = rels.map((f) => path.resolve(ROOT, f));
  if (!files.length) {
    console.error('Usage : node src/import.mjs imports/AAAA-MM-JJ/<vehicule>.json ...');
    process.exit(2);
  }
  importFiles(files)
    .then(async ({ runs, errors }) => {
      await markImported(rels.map((f) => path.relative(ROOT, path.resolve(ROOT, f))));
      const ok = runs.reduce((a, r) => a + r.ok.length, 0);
      console.log(`Import terminé : ${ok} véhicule(s) importé(s)${errors.length ? `, ${errors.length} problème(s)` : ''}.`);
      if (!ok && errors.length) process.exit(1);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
