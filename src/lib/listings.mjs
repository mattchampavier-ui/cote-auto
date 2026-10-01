// Normalisation des annonces brutes renvoyées par l'actor Apify, puis filtres de pertinence.
//
// Les actors LeBonCoin de la marketplace Apify n'ont pas tous le même format : certains
// renvoient l'objet brut de l'API LBC (price: [12990], attributes: [{key:'mileage', ...}]),
// d'autres un objet aplati (price: 12990, mileage: 108000). On gère les deux.

import { iqrBounds } from './stats.mjs';

const ALIASES = {
  id: ['list_id', 'listId', 'adId', 'ad_id', 'id'],
  title: ['subject', 'title', 'name', 'titre'],
  body: ['body', 'description', 'text'],
  price: ['price', 'prix', 'price_eur', 'amount', 'price_cents'],
  mileage: ['mileage', 'km', 'kilometrage', 'kilometers', 'mileage_km'],
  year: ['regdate', 'year', 'annee', 'registrationYear', 'modelYear'],
  url: ['url', 'link', 'adUrl', 'href'],
  date: ['first_publication_date', 'publishedAt', 'publicationDate', 'date', 'index_date'],
  city: ['city', 'ville', 'location.city', 'location.city_label'],
  seller: ['owner.type', 'sellerType', 'seller_type', 'ownerType'],
  gearbox: ['gearbox', 'boite', 'transmission'],
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function attrValue(item, key) {
  const attrs = item.attributes;
  if (!Array.isArray(attrs)) return undefined;
  const a = attrs.find((x) => x && (x.key === key || x.key_label === key));
  return a ? a.value_label ?? a.value : undefined;
}

function pick(item, field) {
  for (const key of ALIASES[field]) {
    const v = key.includes('.') ? getPath(item, key) : item[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  for (const key of ALIASES[field]) {
    const v = attrValue(item, key);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function toNumber(v) {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? Number(digits) : NaN;
}

export function normalizeItem(raw) {
  let price = toNumber(pick(raw, 'price'));
  if (raw.price_cents !== undefined && raw.price === undefined) price = price / 100;
  const year = toNumber(pick(raw, 'year'));
  const url = pick(raw, 'url');
  let id = pick(raw, 'id');
  if (id == null && typeof url === 'string') {
    const m = url.match(/(\d{6,})/);
    if (m) id = m[1];
  }
  const sellerRaw = String(pick(raw, 'seller') || '').toLowerCase();
  return {
    id: id != null ? String(id) : null,
    title: String(pick(raw, 'title') || '').trim(),
    body: String(pick(raw, 'body') || ''),
    price: Number.isFinite(price) ? price : null,
    km: Number.isFinite(toNumber(pick(raw, 'mileage'))) ? toNumber(pick(raw, 'mileage')) : null,
    year: Number.isFinite(year) && year > 1900 ? (year > 3000 ? Number(String(year).slice(0, 4)) : year) : null,
    url: typeof url === 'string' ? url : null,
    publishedAt: pick(raw, 'date') ? String(pick(raw, 'date')).slice(0, 10) : null,
    city: pick(raw, 'city') ? String(pick(raw, 'city')) : null,
    pro: /pro/.test(sellerRaw) ? true : sellerRaw ? false : null,
  };
}

function norm(s) {
  return ` ${String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/+]+/g, ' ')
    .trim()} `;
}

// Mots qui, dans le TITRE, signalent quasi toujours une annonce hors sujet pour un suivi de
// cote : pièces détachées, épaves, non roulants, miniatures, location. On ne cherche pas dans
// la description, où « jamais accidentée » ou « pas de pièces à prévoir » sont fréquents.
export const DEFAULT_EXCLUDE = [
  'pour pieces', 'pieces detachees', 'piece detachee', 'epave', 'accidente', 'accidentee',
  'moteur hs', 'boite hs', 'non roulant', 'non roulante', 'sans moteur', 'miniature',
  'maquette', '1/18', '1/43', 'location', 'leasing', 'lld', 'loa', 'vhu',
];

const has = (hay, word) => hay.includes(norm(word));

// Renvoie { kept, rejected } où rejected = [{ listing, reason }].
// Les raisons sont gardées pour que le récap mensuel dise ce qui a été écarté et pourquoi.
export function filterRelevant(listings, model, defaults = {}) {
  const q = model.search || {};
  const must = model.mustInclude || [];
  const anyOf = model.anyOf || [];
  const exclude = [...DEFAULT_EXCLUDE, ...(defaults.exclude || []), ...(model.exclude || [])];
  const minPrice = defaults.minPrice ?? 500;
  const kept = [];
  const rejected = [];
  const seen = new Set();

  for (const l of listings) {
    const reject = (reason) => rejected.push({ listing: l, reason });
    const title = norm(l.title);
    const hay = `${title}${norm(l.body.slice(0, 800))}`;
    if (l.km !== null && l.km > 0 && l.km < 1000) l.km *= 1000; // « 108 » saisi pour 108 000 km
    if (l.price == null) { reject('prix absent'); continue; }
    if (l.price < minPrice) { reject('prix aberrant'); continue; }
    const key = l.id || `${title}|${l.price}|${l.km}`;
    if (seen.has(key)) { reject('doublon'); continue; }
    seen.add(key);
    const hit = exclude.find((w) => has(title, w));
    if (hit) { reject(`mot exclu « ${hit} »`); continue; }
    if (must.length && !must.every((w) => has(hay, w))) { reject('mot obligatoire absent'); continue; }
    if (anyOf.length && !anyOf.some((w) => has(hay, w))) { reject('variante non reconnue'); continue; }
    if (l.year && q.yearMin && l.year < q.yearMin) { reject('année hors plage'); continue; }
    if (l.year && q.yearMax && l.year > q.yearMax) { reject('année hors plage'); continue; }
    if (l.km && q.kmMax && l.km > q.kmMax) { reject('kilométrage hors plage'); continue; }
    kept.push(l);
  }

  // Dernier filet : prix statistiquement aberrants (annonce mal catégorisée, version course
  // hors marché...). Garde-fou large (k=2) pour ne pas aplatir le marché.
  const { lo, hi } = iqrBounds(kept.map((l) => l.price), 2);
  const final = [];
  for (const l of kept) {
    if (l.price < lo || l.price > hi) rejected.push({ listing: l, reason: 'prix hors marché' });
    else final.push(l);
  }
  return { kept: final, rejected };
}
