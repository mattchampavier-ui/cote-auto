import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.mjs';

const box = sandbox();
const { toRawItem, importFiles, pendingImports } = await import('../src/import.mjs');
const { normalizeItem } = await import('../src/lib/listings.mjs');
const { missingThisMonth } = await import('../src/recap.mjs');

const annonce = (i, extra = {}) => ({
  id: String(3300000000 + i), titre: 'Peugeot 206 RC 2.0 16v', prix: `${8000 + i * 150} €`, km: `${140000 + i * 3000} km`,
  annee: 2004, carburant: 'Essence', boite: 'Manuelle', ville: 'Lyon', cp: '69003', pro: i % 3 === 0 ? 'Pro' : 'Particulier',
  publiee: '2026-10-28', ...extra,
});

test('une annonce saisie dans Chrome est lue comme une annonce de l’API', () => {
  const l = normalizeItem(toRawItem(annonce(1)));
  assert.deepEqual([l.id, l.price, l.km, l.year, l.city, l.pro, l.publishedAt], ['3300000001', 8150, 143000, 2004, 'Lyon', false, '2026-10-28']);
  assert.equal(l.url, 'https://www.leboncoin.fr/ad/voitures/3300000001');
  assert.deepEqual([l.details.fuel, l.details.gearbox, l.details.zipcode], ['Essence', 'Manuelle', '69003']);
});

test('import d’un fichier par véhicule : filtres, relevé « chrome », pas de double import', async () => {
  const dir = path.join(box.dir, 'imports', '2026-11-01');
  fs.mkdirSync(dir, { recursive: true });
  const list = [...Array(12).keys()].map((i) => annonce(i));
  list.push(annonce(50, { titre: '206 RC Line 1.6 110 cv' })); // finition exclue
  list.push(annonce(51, { titre: '206 RC pour pièces', prix: 900 }));
  fs.writeFileSync(path.join(dir, 'peugeot-206-rc.json'), JSON.stringify({ vehicule: 'peugeot-206-rc', date: '2026-11-01', annonces: list }));
  fs.writeFileSync(path.join(dir, 'inconnu.json'), JSON.stringify({ vehicule: 'ferrari-f40', date: '2026-11-01', annonces: [annonce(1)] }));

  const pending = await pendingImports();
  assert.deepEqual(pending, ['imports/2026-11-01/inconnu.json', 'imports/2026-11-01/peugeot-206-rc.json']);
  const { runs, errors } = await importFiles(pending.map((f) => path.join(box.dir, f)));
  assert.equal(runs[0].ok[0], 'peugeot-206-rc');
  assert.ok(errors.some((e) => e.includes('ferrari-f40')));

  const snap = box.read('data.json').snapshots['peugeot-206-rc'].at(-1);
  assert.equal(snap.source, 'chrome');
  assert.equal(snap.date, '2026-11-01');
  assert.equal(snap.count, 12);
  assert.equal(snap.rejected, 2);

  // Le récap attend les autres véhicules avant de partir.
  const { models } = box.read('models.json');
  const missing = missingThisMonth(models, box.read('data.json'), '2026-11-02');
  assert.equal(missing.length, models.filter((m) => m.active !== false).length - 1);
});

test('format combiné : plusieurs véhicules dans un seul fichier', async () => {
  const file = path.join(box.dir, 'imports', 'combo.json');
  fs.writeFileSync(file, JSON.stringify({ date: '2026-11-02', vehicules: { 'honda-s2000': [annonce(1, { titre: 'Honda S2000 AP1', prix: 24000 }), annonce(2, { titre: 'Honda S2000', prix: 26000 })] } }));
  const { runs } = await importFiles([file]);
  assert.deepEqual(runs[0].ok, ['honda-s2000']);
});

test('sans relevé complet, une annonce absente n’est pas comptée comme vendue ; avec le total, si', async () => {
  const dir = path.join(box.dir, 'imports', 'ventes');
  fs.mkdirSync(dir, { recursive: true });
  const r26 = (i) => annonce(i, { titre: 'Renault Megane RS R26', prix: 20000 + i * 300, annee: 2008 });
  const f1 = path.join(dir, 'a.json');
  fs.writeFileSync(f1, JSON.stringify({ vehicule: 'renault-megane-r26', date: '2026-11-01', total: 6, annonces: [0, 1, 2, 3, 4, 5].map(r26) }));
  await importFiles([f1]);
  // Décembre : relevé partiel (pas de total) sans les annonces 0 et 1 → aucune vente déduite.
  const f2 = path.join(dir, 'b.json');
  fs.writeFileSync(f2, JSON.stringify({ vehicule: 'renault-megane-r26', date: '2026-12-01', annonces: [2, 3, 4, 5].map(r26) }));
  await importFiles([f2]);
  assert.equal(box.read('data.json').snapshots['renault-megane-r26'].at(-1).sold, 0);
  // Janvier : relevé complet (total = 3) sans l'annonce 2 → 1 vente.
  const f3 = path.join(dir, 'c.json');
  fs.writeFileSync(f3, JSON.stringify({ vehicule: 'renault-megane-r26', date: '2027-01-02', total: 3, annonces: [3, 4, 5].map(r26) }));
  await importFiles([f3]);
  const last = box.read('data.json').snapshots['renault-megane-r26'].at(-1);
  assert.equal(last.sold, 3); // 0, 1 et 2 absents d'un relevé complet
  assert.equal(last.source, 'chrome');
});
