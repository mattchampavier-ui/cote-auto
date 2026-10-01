import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { sandbox, FIXTURES } from './helpers.mjs';

const box = sandbox();
const { scrape } = await import('../src/scrape.mjs');
const { recap } = await import('../src/recap.mjs');
const { parseIssueBody, addVehicle, removeVehicle } = await import('../src/vehicles.mjs');

test('deux relevés : nouvelles annonces, ventes, baisses de prix, bonnes affaires', async () => {
  const r1 = await scrape({ fixture: path.join(FIXTURES, 'run1'), today: '2026-09-07' });
  assert.equal(r1.ok.length, 8);
  const r2 = await scrape({ fixture: path.join(FIXTURES, 'run2'), today: '2026-09-28' });
  assert.equal(r2.ok.length, 8);

  const data = box.read('data.json');
  const last = data.snapshots['peugeot-208-gti-30th'].at(-1);
  assert.equal(last.date, '2026-09-28');
  assert.equal(last.newListings, 2);
  assert.equal(last.sold, 2);
  assert.ok(last.soldMedianDays >= 10);
  assert.ok(last.rejected >= 3); // pièces, autre version, prix aberrant
  assert.ok(last.priceDrops.length >= 1);
  assert.ok(last.bargains.length >= 1);
  assert.ok(Number.isFinite(last.refPrice));
  // le relevé manuel d'amorce est conservé
  assert.ok(data.snapshots['peugeot-208-gti-30th'].some((s) => s.source === 'manuel'));

  const tracking = box.read('listings.json');
  assert.equal(Object.values(tracking['peugeot-208-gti-30th']).filter((l) => l.gone).length, 2);
});

test('un relevé relancé le même jour remplace celui du jour', async () => {
  const before = box.read('data.json').snapshots['citroen-saxo-vts'].length;
  await scrape({ fixture: path.join(FIXTURES, 'run2'), today: '2026-09-28', only: 'citroen-saxo-vts' });
  assert.equal(box.read('data.json').snapshots['citroen-saxo-vts'].length, before);
});

test("un véhicule en erreur n'empêche pas les autres", async () => {
  const run = await scrape({
    today: '2026-09-29',
    only: 'citroen-saxo-vts,peugeot-206-rc',
    fetchItems: async (m) => {
      if (m.id === 'peugeot-206-rc') throw new Error('Apify 500');
      return { items: JSON.parse(fs.readFileSync(path.join(FIXTURES, 'run2', `${m.id}.json`), 'utf-8')) };
    },
  });
  assert.deepEqual(run.ok, ['citroen-saxo-vts']);
  assert.equal(run.failed[0].id, 'peugeot-206-rc');
});

test('récap mensuel : généré, archivé, pas renvoyé deux fois', async () => {
  const res = await recap({ today: '2026-10-01' });
  assert.equal(res.sent, false); // pas d'identifiants Gmail en test
  assert.match(res.subject, /septembre 2026/);
  const html = fs.readFileSync(path.join(box.dir, 'recaps', '2026-09.html'), 'utf-8');
  assert.match(html, /Classement/);
  assert.match(html, /Bonnes affaires/);
  assert.deepEqual(box.read('recaps/index.json')[0], { month: '2026-09', label: 'septembre 2026' });

  // Simule un envoi réussi : le passage suivant du mois ne renvoie pas.
  const data = box.read('data.json');
  data.meta.lastRecap = '2026-09';
  fs.writeFileSync(path.join(box.dir, 'data.json'), JSON.stringify(data));
  const again = await recap({ today: '2026-10-06' });
  assert.equal(again.reason, 'déjà envoyé');
});

const ISSUE = `### Nom du véhicule

BMW Z3 1.9i

### Texte de recherche LeBonCoin

bmw z3

### Année minimum

1996

### Année maximum

2002

### Kilométrage maximum

_No response_

### Mots à exclure

M Roadster, coupé

### Rareté (0-100)

35
`;

test('ajout via formulaire GitHub, refus du doublon, retrait', async () => {
  const fields = parseIssueBody(ISSUE);
  assert.deepEqual(fields, { name: 'BMW Z3 1.9i', text: 'bmw z3', yearMin: '1996', yearMax: '2002', exclude: 'M Roadster, coupé', rarete: '35' });

  const added = await addVehicle(fields, { today: '2026-10-01' });
  assert.equal(added.ok, true);
  assert.equal(added.id, 'bmw-z3-1-9i');
  const m = box.read('models.json').models.find((x) => x.id === 'bmw-z3-1-9i');
  assert.deepEqual(m.search, { text: 'bmw z3', yearMin: 1996, yearMax: 2002 });
  assert.deepEqual(m.exclude, ['m roadster', 'coupé']);
  assert.equal(m.rarete, 35);
  assert.equal(m.desirabilite, 50); // sans clé Claude : valeur neutre

  assert.equal((await addVehicle(fields)).ok, false);

  const removed = await removeVehicle({ target: 'bmw-z3' });
  assert.equal(removed.ok, true);
  assert.equal(box.read('models.json').models.find((x) => x.id === 'bmw-z3-1-9i').active, false);

  const back = await addVehicle(fields);
  assert.equal(back.ok, true);
  assert.match(back.message, /réactivé/);
});
