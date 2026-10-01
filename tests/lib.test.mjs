import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, linearFit, iqrBounds } from '../src/lib/stats.mjs';
import { normalizeItem, filterRelevant } from '../src/lib/listings.mjs';
import { buildSearchUrl, slugify } from '../src/lib/search.mjs';
import { actorPath, buildInput, inputTemplateFor } from '../src/lib/apify.mjs';
import { evaluate, bounds } from '../src/lib/scoring.mjs';
import { priceModel } from '../src/lib/market.mjs';

test('statistiques de base', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([], 50), null);
  const fit = linearFit([{ x: 0, y: 10 }, { x: 10, y: 0 }]);
  assert.equal(fit.slope, -1);
  assert.deepEqual(iqrBounds([1, 2]), { lo: -Infinity, hi: Infinity });
});

test("normalise le format brut de l'API LeBonCoin", () => {
  const l = normalizeItem({
    list_id: 123456789, subject: 'Peugeot 206 RC', price: [8990], url: 'https://x/123456789',
    attributes: [{ key: 'mileage', value: '152000' }, { key: 'regdate', value: '2004' }],
    location: { city: 'Lyon' }, owner: { type: 'pro' }, first_publication_date: '2026-09-01 10:00:00',
  });
  assert.deepEqual(
    [l.id, l.title, l.price, l.km, l.year, l.city, l.pro, l.publishedAt],
    ['123456789', 'Peugeot 206 RC', 8990, 152000, 2004, 'Lyon', true, '2026-09-01'],
  );
});

test('normalise un format aplati avec unités', () => {
  const l = normalizeItem({ title: 'Saxo VTS', price: '6 500 €', mileage: '153 683 km', year: 2001, url: 'https://www.leboncoin.fr/ad/voitures/2876543210' });
  assert.equal(l.price, 6500);
  assert.equal(l.km, 153683);
  assert.equal(l.id, '2876543210');
});

test('filtre de pertinence : exclusions, mots obligatoires, plages, doublons', () => {
  const model = { search: { yearMin: 2003, yearMax: 2007, kmMax: 250000 }, mustInclude: ['rc'], exclude: ['hdi', '206+'] };
  const mk = (title, price, extra = {}) => ({ id: title + price, title, body: '', price, km: 150000, year: 2005, ...extra });
  const { kept, rejected } = filterRelevant([
    mk('Peugeot 206 RC', 8000),
    mk('Peugeot 206 RC', 8000), // doublon
    mk('Peugeot 206 RC pour pièces', 2000),
    mk('Peugeot 206 HDi', 4000),
    mk('Peugeot 206+ RC look', 5000),
    mk('Peugeot 206 S16', 6000),
    mk('Peugeot 206 RC', 9000, { year: 2001 }),
    mk('Peugeot 206 RC', 300),
  ], model);
  assert.equal(kept.length, 1);
  const reasons = rejected.map((r) => r.reason);
  assert.ok(reasons.includes('mot obligatoire absent'));
  assert.ok(reasons.includes('année hors plage'));
  assert.ok(reasons.includes('prix aberrant'));
  assert.ok(reasons.some((r) => r.includes('pour pieces')));
});

test('le mot exclu ne déborde pas sur la version recherchée (206+ ≠ 206)', () => {
  const { kept } = filterRelevant([{ id: '1', title: 'Peugeot 206 RC', body: '', price: 8000, km: null, year: null }], { exclude: ['206+'] });
  assert.equal(kept.length, 1);
});

test("l'URL de recherche est générée depuis les critères", () => {
  const url = buildSearchUrl({ name: 'BMW Z3', search: { text: 'bmw z3', yearMin: 1996, yearMax: 2002, kmMax: 200000 } });
  assert.match(url, /^https:\/\/www\.leboncoin\.fr\/recherche\?/);
  const p = new URL(url).searchParams;
  assert.equal(p.get('category'), '2');
  assert.equal(p.get('text'), 'bmw z3');
  assert.equal(p.get('regdate'), '1996-2002');
  assert.equal(p.get('mileage'), 'min-200000');
  assert.equal(slugify('Citroën Saxo VTS 16V'), 'citroen-saxo-vts-16v');
});

test("identifiant d'actor Apify et gabarit d'entrée", () => {
  assert.equal(actorPath('jean/leboncoin-scraper'), 'jean~leboncoin-scraper');
  assert.deepEqual(buildInput(undefined, 'https://a/b?x=1', 40), { startUrls: [{ url: 'https://a/b?x=1' }], maxItems: 40 });
  assert.deepEqual(buildInput('{"searchUrl":"{{url}}","limit":{{max}}}', 'u', 5), { searchUrl: 'u', limit: 5 });
  assert.deepEqual(buildInput(inputTemplateFor('clearpath/leboncoin-api'), 'u', 60), { searchUrl: 'u', adLimit: 60 });
  assert.deepEqual(buildInput(inputTemplateFor('Clearpath~leboncoin-api', ''), 'u', 60), { searchUrl: 'u', adLimit: 60 });
  assert.deepEqual(buildInput(inputTemplateFor('clearpath/leboncoin-api', '{"x":"{{url}}"}'), 'u', 1), { x: 'u' });
});

test('le prix attendu tient compte du kilométrage', () => {
  const listings = [50, 80, 100, 120, 150, 200].map((k) => ({ km: k * 1000, price: 20000 - k * 50 }));
  const pm = priceModel(listings);
  assert.ok(pm.fit);
  assert.ok(Math.abs(pm.expected(100000) - 15000) < 1);
});

const model = { rarete: 60, desirabilite: 60, dernierDe: 60, floor: 10000, ceiling: 20000 };
const snap = (date, median, extra = {}) => ({ date, median, count: 10, source: 'apify', ...extra });

test('score : momentum neutre sans historique, positif quand la cote remonte', () => {
  const flat = evaluate(model, [snap('2026-09-01', 12000)]);
  assert.equal(flat.momentum, 50);
  const up = evaluate(model, [snap('2026-06-01', 12000), snap('2026-09-01', 13200)]);
  assert.equal(up.trend3m, 10);
  assert.equal(up.momentum, 90);
  const down = evaluate(model, [snap('2026-06-01', 12000), snap('2026-09-01', 10800)]);
  assert.equal(down.momentum, 10);
  assert.notEqual(down.signal.tone, 'buy'); // pas de signal d'achat sur une cote qui chute
});

test('bornes : manuelles au début, observées après 3 mois de relevés', () => {
  const early = bounds(model, [snap('2026-09-01', 12000, { p25: 11000, p75: 14000 })]);
  assert.deepEqual([early.floor, early.ceiling, early.auto], [10000, 20000, false]);
  const later = bounds(model, [snap('2026-05-01', 12000, { p25: 11000, p75: 14000 }), snap('2026-09-01', 13000, { p25: 11500, p75: 15000 })]);
  assert.deepEqual([later.floor, later.ceiling, later.auto], [11000, 15000, true]);
});

test('les options payantes (profil vendeur, téléphone) sont désactivées', async () => {
  const { costlyOptions } = await import('../src/lib/apify.mjs');
  const schema = { properties: {
    searchUrl: { type: 'string' }, adLimit: { type: 'integer' },
    includeSellerProfile: { type: 'boolean', default: true },
    includePhone: { type: 'boolean' },
    x: { type: 'boolean', title: 'Profils vendeurs détaillés' },
  } };
  assert.deepEqual(costlyOptions(schema), { includeSellerProfile: false, includePhone: false, x: false });
});
