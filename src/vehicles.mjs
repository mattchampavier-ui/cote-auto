// Ajout / retrait de véhicules, appelé par le workflow « Véhicules » quand un formulaire
// GitHub (issue) est soumis — ou à la main :
//
//   node src/vehicles.mjs add --body-file issue.md [--comment-out reponse.md]
//   node src/vehicles.mjs add --name "BMW Z3 1.9i" --text "bmw z3" --year-min 1996 --year-max 2002
//   node src/vehicles.mjs remove --body-file issue.md
//
// Les champs laissés vides (catégorie, scores, mots exclus...) sont estimés par Claude si
// ANTHROPIC_API_KEY est disponible, sinon remplis avec des valeurs neutres.

import fs from 'node:fs/promises';
import { readJson, writeJson, writeText, todayISO, parseArgs } from './lib/io.mjs';
import { slugify, buildSearchUrl, parseSearchUrl } from './lib/search.mjs';
import { askClaude, extractJson } from './lib/claude.mjs';

// Libellés exacts des champs des formulaires .github/ISSUE_TEMPLATE/*.yml
export const FIELDS = {
  'Nom du véhicule': 'name',
  'URL de recherche LeBonCoin': 'url',
  'Texte de recherche LeBonCoin': 'text',
  'Année minimum': 'yearMin',
  'Année maximum': 'yearMax',
  'Kilométrage maximum': 'kmMax',
  'Prix maximum': 'priceMax',
  'Mots obligatoires': 'mustInclude',
  'Variantes acceptées': 'anyOf',
  'Mots à exclure': 'exclude',
  'Catégorie': 'categorie',
  'Rareté (0-100)': 'rarete',
  '« Dernier de » (0-100)': 'dernierDe',
  'Désirabilité (0-100)': 'desirabilite',
  'Notes': 'notes',
  'Véhicule à retirer': 'target',
};

export function parseIssueBody(body) {
  const out = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl === -1 ? undefined : nl).trim();
    const value = nl === -1 ? '' : part.slice(nl + 1).trim();
    const key = FIELDS[label];
    if (!key || !value || value === '_No response_' || value === 'None') continue;
    out[key] = value;
  }
  return out;
}

const list = (v) => (v ? String(v).split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean) : []);
const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : undefined;
};
const score = (v) => {
  const n = num(v);
  return n === undefined ? undefined : Math.max(0, Math.min(100, Math.round(n)));
};

export function draftModel(fields, today = todayISO()) {
  if (!fields.name) throw new Error('Le nom du véhicule est obligatoire.');
  const search = {
    text: fields.text || fields.name,
    yearMin: num(fields.yearMin),
    yearMax: num(fields.yearMax),
    kmMax: num(fields.kmMax),
    priceMax: num(fields.priceMax),
  };
  Object.keys(search).forEach((k) => search[k] === undefined && delete search[k]);
  // URL LeBonCoin collée : elle sert telle quelle pour la collecte, et ses filtres complètent
  // les critères (sans écraser ce qui a été saisi à la main).
  let lbcSearchUrl;
  if (fields.url) {
    const parsed = parseSearchUrl(fields.url);
    if (!parsed) throw new Error('L’URL fournie n’est pas une recherche leboncoin.fr (elle doit commencer par https://www.leboncoin.fr/recherche?).');
    lbcSearchUrl = parsed.url;
    for (const [k, v] of Object.entries(parsed.search)) if (search[k] === undefined || (k === 'text' && !fields.text)) search[k] = v;
  }
  const model = {
    id: slugify(fields.name),
    name: fields.name.trim(),
    categorie: fields.categorie,
    search,
    ...(lbcSearchUrl ? { lbcSearchUrl } : {}),
    mustInclude: list(fields.mustInclude),
    anyOf: list(fields.anyOf),
    exclude: list(fields.exclude),
    rarete: score(fields.rarete),
    dernierDe: score(fields.dernierDe),
    desirabilite: score(fields.desirabilite),
    notes: fields.notes,
    addedAt: today,
  };
  return model;
}

async function enrich(model, config) {
  const missing = ['categorie', 'rarete', 'dernierDe', 'desirabilite', 'notes'].filter((k) => model[k] === undefined);
  const needsYears = !model.search.yearMin && !model.search.yearMax;
  if (!missing.length && !needsYears && model.exclude.length) return { model, ai: false };

  const prompt = `On ajoute ce véhicule à un outil de suivi de cote d'occasion (annonces LeBonCoin, France) :
« ${model.name} » — texte de recherche : « ${model.search.text} ».

Réponds UNIQUEMENT par un objet JSON avec ces clés :
{
  "categorie": "étiquette courte, ex. Hot-hatch youngtimer 2000-2005",
  "rarete": 0-100 (production faible / édition limitée = haut),
  "dernierDe": 0-100 (dernière génération avant une rupture technique ou stylistique = haut),
  "desirabilite": 0-100 (aura, héritage, demande des passionnés),
  "yearMin": année de début de production (nombre),
  "yearMax": année de fin de production (nombre),
  "exclude": ["mots du titre d'annonce qui signalent une AUTRE version ou génération à écarter", "..."],
  "notes": "une ou deux phrases utiles à l'achat (points de vigilance, ce qui fait la valeur)"
}
Les mots exclus doivent être en minuscules, sans accents, et ne jamais exclure la version recherchée.`;
  const json = extractJson(await askClaude(prompt, { model: config.ai?.model, maxTokens: 600 }));
  if (json) {
    for (const k of missing) if (json[k] !== undefined) model[k] = ['rarete', 'dernierDe', 'desirabilite'].includes(k) ? score(json[k]) : json[k];
    if (needsYears && Number.isFinite(json.yearMin)) model.search.yearMin = json.yearMin;
    if (needsYears && Number.isFinite(json.yearMax)) model.search.yearMax = json.yearMax;
    if (!model.exclude.length && Array.isArray(json.exclude)) model.exclude = json.exclude.map((s) => String(s).toLowerCase()).slice(0, 10);
  }
  // Valeurs neutres pour ce qui reste vide : le score fonctionne, à affiner plus tard.
  model.categorie ??= 'À classer';
  model.rarete ??= 50;
  model.dernierDe ??= 50;
  model.desirabilite ??= 50;
  model.notes ??= '';
  return { model, ai: !!json };
}

export async function addVehicle(fields, { today = todayISO() } = {}) {
  const config = await readJson('config.json');
  const registry = await readJson('models.json');
  const draft = draftModel(fields, today);
  const existing = registry.models.find((m) => m.id === draft.id);
  if (existing && existing.active !== false) {
    return { ok: false, message: `« ${existing.name} » est déjà suivi (identifiant \`${existing.id}\`).` };
  }
  const { model, ai } = await enrich(draft, config);
  for (const k of ['mustInclude', 'anyOf', 'exclude']) if (!model[k].length) delete model[k];
  if (existing) {
    // Véhicule archivé puis redemandé : on le réactive en gardant son historique.
    Object.assign(existing, model, { active: true, addedAt: existing.addedAt });
  } else {
    registry.models.push(model);
  }
  await writeJson('models.json', registry);
  const m = existing || model;
  const message = [
    `✅ **${m.name}** ajouté au suivi (identifiant \`${m.id}\`)${existing ? ' — réactivé avec son historique' : ''}.`,
    '',
    `- Recherche : [${m.search.text}${m.search.yearMin || m.search.yearMax ? `, ${m.search.yearMin || '…'}-${m.search.yearMax || '…'}` : ''}](${buildSearchUrl(m)})`,
    `- Catégorie : ${m.categorie}`,
    `- Rareté ${m.rarete} · « Dernier de » ${m.dernierDe} · Désirabilité ${m.desirabilite}${ai ? ' _(estimés par Claude — modifiables dans `models.json`)_' : ''}`,
    m.exclude?.length ? `- Mots exclus : ${m.exclude.join(', ')}` : null,
    m.notes ? `- Notes : ${m.notes}` : null,
    '',
    'Un premier relevé est lancé dans la foulée ; le véhicule apparaît sur le dashboard dans quelques minutes et dans le prochain récap mensuel.',
  ].filter((x) => x !== null).join('\n');
  return { ok: true, id: m.id, message };
}

export async function removeVehicle(fields) {
  const registry = await readJson('models.json');
  const target = slugify(fields.target || fields.name || '');
  if (!target) return { ok: false, message: 'Indique le nom ou l’identifiant du véhicule à retirer.' };
  const suivis = registry.models.filter((m) => m.active !== false);
  const exact = suivis.filter((m) => m.id === target || slugify(m.name) === target);
  const matches = exact.length ? exact : suivis.filter((m) => m.id.includes(target) || slugify(m.name).includes(target));
  if (matches.length !== 1) {
    const names = registry.models.filter((m) => m.active !== false).map((m) => `\`${m.id}\``).join(', ');
    return { ok: false, message: `${matches.length ? 'Plusieurs véhicules correspondent' : 'Aucun véhicule ne correspond'} à « ${fields.target} ». Identifiants suivis : ${names}.` };
  }
  matches[0].active = false;
  await writeJson('models.json', registry);
  return { ok: true, id: matches[0].id, message: `🗄️ **${matches[0].name}** n'est plus suivi. Son historique est conservé : redemander son ajout le réactive.` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const fields = args['body-file']
    ? parseIssueBody(await fs.readFile(args['body-file'], 'utf-8'))
    : { name: args.name, text: args.text, yearMin: args['year-min'], yearMax: args['year-max'], kmMax: args['km-max'], exclude: args.exclude, target: args.target };
  const run = action === 'remove' ? removeVehicle : action === 'add' ? addVehicle : null;
  if (!run) {
    console.error('Usage : node src/vehicles.mjs add|remove --body-file fichier');
    process.exit(2);
  }
  const res = await run(fields).catch((err) => ({ ok: false, message: `❌ ${err.message}` }));
  console.log(res.message);
  if (args['comment-out']) await writeText(args['comment-out'], res.message);
  if (res.id && process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `id=${res.id}\n`);
  if (!res.ok) process.exitCode = 1;
}
