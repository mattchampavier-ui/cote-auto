// Prépare les données de la base Excel (cote-auto.xlsx) : écrit sur la sortie standard un JSON
// consommé par scripts/build_excel.py. Les scores sont calculés ici avec le même module que le
// dashboard et le récap, pour que les trois affichent les mêmes chiffres.
//
//   node src/export.mjs | python3 scripts/build_excel.py cote-auto.xlsx

import { readJson, todayISO } from './lib/io.mjs';
import { evaluate } from './lib/scoring.mjs';
import { buildSearchUrl } from './lib/search.mjs';
import { round, daysBetween } from './lib/stats.mjs';

const frac = (pct) => (Number.isFinite(pct) ? round(pct / 100, 4) : null);

export async function exportData({ today = todayISO() } = {}) {
  const config = await readJson('config.json');
  const { models } = await readJson('models.json');
  const data = await readJson('data.json');
  const tracking = await readJson('listings.json');
  const settings = config.scoring;

  const synthese = [];
  const mensuel = [];
  const releves = [];
  const affaires = [];

  for (const model of models) {
    const history = data.snapshots[model.id] || [];
    for (const s of history) {
      releves.push({
        date: s.date, vehicule: model.name, source: s.source, annonces: s.count, min: s.min, p25: s.p25 ?? null,
        mediane: s.median, p75: s.p75 ?? null, max: s.max, km_median: s.medianKm ?? s.avgKm ?? null,
        cote_km_ref: s.refPrice ?? null, km_ref: s.refKm ?? null, nouvelles: s.newListings ?? null, vendues: s.sold ?? null,
        delai_vente: s.soldMedianDays ?? null, part_pro: s.proShare ?? null, ecartees: s.rejected ?? null,
      });
    }

    // Une ligne par mois : dernier relevé du mois, ventes et nouvelles annonces cumulées,
    // score recalculé avec l'historique connu à la fin de ce mois-là.
    const months = [...new Set(history.map((s) => s.date.slice(0, 7)))].sort();
    for (const month of months) {
      const inMonth = history.filter((s) => s.date.slice(0, 7) === month);
      const upTo = history.filter((s) => s.date.slice(0, 7) <= month);
      // Les relevés du robot priment sur l'amorce manuelle quand les deux existent dans le mois.
      const robot = inMonth.filter((s) => s.source !== 'manuel');
      const last = (robot.length ? robot : inMonth).at(-1);
      const ev = evaluate(model, upTo, settings);
      const solds = inMonth.map((s) => s.sold).filter(Number.isFinite);
      mensuel.push({
        mois: month, vehicule: model.name, mediane: last.median, p25: last.p25 ?? null, p75: last.p75 ?? null,
        cote_km_ref: last.refPrice ?? null, annonces: last.count,
        nouvelles: inMonth.reduce((a, s) => a + (s.newListings || 0), 0),
        vendues: solds.length ? solds.reduce((a, b) => a + b, 0) : null,
        delai_vente: last.soldMedianDays ?? null, releves: inMonth.length,
        score: round(ev.composite, 1), signal: ev.signal.label,
      });
    }

    if (model.active === false) continue;
    const ev = evaluate(model, history, settings);
    const l = ev.latest;
    synthese.push({
      vehicule: model.name, categorie: model.categorie, score: round(ev.composite, 1), signal: ev.signal.label,
      mediane: l?.median ?? null, plancher: ev.floor, plafond: ev.ceiling,
      tendance_1m: frac(ev.trend1m), tendance_3m: frac(ev.trend3m), tendance_12m: frac(ev.trend12m),
      cote_km_ref: l?.refPrice ?? null, km_ref: l?.refKm ?? model.refKm ?? null, annonces: l?.count ?? 0,
      vendues_30j: history.filter((s) => daysBetween(s.date, today) <= 30).reduce((a, s) => a + (s.sold || 0), 0),
      delai_vente: l?.soldMedianDays ?? null, bonnes_affaires: (l?.bargains || []).length,
      rarete: model.rarete, desirabilite: model.desirabilite, dernier_de: model.dernierDe,
      proximite: round(ev.proximite), momentum: round(ev.momentum), marche: round(ev.marche),
      dernier_releve: l?.date ?? null, lien: buildSearchUrl(model),
    });
    for (const b of l?.bargains || []) {
      affaires.push({ vehicule: model.name, titre: b.title, prix: b.price, cote_attendue: b.expected, km: b.km, annee: b.year, ville: b.city, lien: b.url, releve: l.date });
    }
  }

  const annonces = [];
  const prix = [];
  const yesNo = (v) => (v === true ? 'Oui' : v === false ? 'Non' : null);
  const intOf = (v) => {
    const m = String(v ?? '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  for (const [id, byListing] of Object.entries(tracking)) {
    const model = models.find((m) => m.id === id);
    const name = model?.name ?? id;
    for (const [listingId, s] of Object.entries(byListing)) {
      const det = s.details || {};
      const history = s.priceHistory || [{ date: s.firstSeen, price: s.firstPrice }];
      annonces.push({
        vehicule: name, id: listingId, titre: s.title, statut: s.gone ? 'Partie' : 'En vente',
        premiere_vue: s.firstSeen, derniere_vue: s.lastSeen, partie_le: s.gone, publiee_le: s.publishedAt ?? null,
        prix_initial: s.firstPrice, prix: s.price, nb_baisses: history.filter((h, i) => i > 0 && h.price < history[i - 1].price).length,
        version: det.version ?? null, finition: det.finition ?? null,
        ancien_prix: intOf(det.oldPrice), estimation_min: intOf(det.lbcEstimateMin), estimation_max: intOf(det.lbcEstimateMax),
        positionnement: det.lbcPositioning ?? null,
        km: s.km, annee: s.year, mise_en_circulation: det.issuance ?? null, carburant: det.fuel ?? null, boite: det.gearbox ?? null,
        puissance_din: intOf(det.powerDin), puissance_fiscale: intOf(det.powerFiscal), couleur: det.color ?? null,
        portes: intOf(det.doors), type: det.vehicleType ?? null, entretien: det.maintenance ?? null, historique: det.history ?? null,
        urgent: yesNo(det.urgent),
        vendeur: s.pro === true ? 'Pro' : s.pro === false ? 'Particulier' : null,
        ville: s.city, code_postal: det.zipcode ?? null, departement: det.department ?? null, region: det.region ?? null,
        photos: det.images ?? null, favoris: det.favorites ?? null, remontee: yesNo(det.boosted),
        description: s.description ? s.description.replace(/\s+/g, ' ').slice(0, 500) : null,
        autres: det.others && Object.keys(det.others).length ? Object.entries(det.others).map(([k, v]) => `${k} : ${v}`).join(' ; ') : null,
        lien: s.url,
      });
      for (const h of history) prix.push({ vehicule: name, id: listingId, titre: s.title, date: h.date, prix: h.price, lien: s.url });
    }
  }

  const vehicules = models.map((m) => ({
    vehicule: m.name, id: m.id, statut: m.active === false ? 'Retiré' : 'Suivi', categorie: m.categorie,
    recherche: m.search?.text ?? '', annees: [m.search?.yearMin, m.search?.yearMax].filter(Boolean).join('-'),
    obligatoires: (m.mustInclude || []).join(', '), variantes: (m.anyOf || []).join(', '), exclus: (m.exclude || []).join(', '),
    rarete: m.rarete, dernier_de: m.dernierDe, desirabilite: m.desirabilite, ajoute_le: m.addedAt ?? null, notes: m.notes ?? '',
    lien: buildSearchUrl(m),
  }));

  synthese.sort((a, b) => b.score - a.score);
  mensuel.sort((a, b) => a.vehicule.localeCompare(b.vehicule, 'fr') || a.mois.localeCompare(b.mois));
  releves.sort((a, b) => b.date.localeCompare(a.date) || a.vehicule.localeCompare(b.vehicule, 'fr'));
  prix.sort((a, b) => a.vehicule.localeCompare(b.vehicule, 'fr') || a.id.localeCompare(b.id) || a.date.localeCompare(b.date));
  annonces.sort((a, b) => a.vehicule.localeCompare(b.vehicule, 'fr') || (b.derniere_vue || '').localeCompare(a.derniere_vue || ''));
  affaires.sort((a, b) => a.prix / a.cote_attendue - b.prix / b.cote_attendue);

  return {
    genere_le: today,
    dernier_releve: data.meta?.lastRun ?? null,
    dashboard: config.dashboardUrl,
    synthese, mensuel, releves, annonces, prix, affaires, vehicules,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--date');
  exportData({ today: i >= 0 ? args[i + 1] : undefined })
    .then((out) => process.stdout.write(JSON.stringify(out)))
    .catch((err) => { console.error(err); process.exit(1); });
}
