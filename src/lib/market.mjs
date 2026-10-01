// Transforme les annonces retenues d'un run en relevé (snapshot) et tient à jour le suivi
// annonce par annonce : nouvelles annonces, annonces disparues (≈ vendues), baisses de prix,
// durée de mise en vente. C'est ce suivi qui rend le score plus pertinent qu'une simple
// moyenne de prix.

import { percentile, mean, linearFit, round, daysBetween } from './stats.mjs';

// Prix attendu en fonction du kilométrage, à partir des annonces du run.
// Retient la régression seulement si elle est plausible (assez de points, pente négative).
export function priceModel(listings) {
  const pts = listings.filter((l) => l.km).map((l) => ({ x: l.km, y: l.price }));
  const fit = pts.length >= 6 ? linearFit(pts) : null;
  const med = percentile(listings.map((l) => l.price), 50);
  const kms = pts.map((p) => p.x);
  const kmLo = percentile(kms, 10);
  const kmHi = percentile(kms, 90);
  const usable = fit && fit.slope < 0;
  return {
    fit: usable ? fit : null,
    expected(km) {
      if (!usable || !km) return med;
      // On borne le km à la plage observée : extrapoler une droite au-delà n'a pas de sens.
      const k = Math.min(Math.max(km, kmLo), kmHi);
      return fit.intercept + fit.slope * k;
    },
  };
}

export function updateTracking(state, kept, today, { complete }) {
  const seenIds = new Set();
  const fresh = [];
  const priceDrops = [];
  for (const l of kept) {
    if (!l.id) continue;
    seenIds.add(l.id);
    const prev = state[l.id];
    // Tout ce que l'annonce apporte est conservé (capitalisé pour l'Excel), sans données
    // personnelles : la description est tronquée, le vendeur réduit à pro / particulier.
    const info = {
      title: l.title, url: l.url, city: l.city, year: l.year, pro: l.pro,
      publishedAt: l.publishedAt, description: (l.body || '').slice(0, 1200) || undefined,
      details: l.details,
    };
    if (!prev) {
      state[l.id] = {
        ...info, km: l.km,
        price: l.price, firstPrice: l.price, priceHistory: [{ date: today, price: l.price }],
        firstSeen: l.publishedAt && l.publishedAt <= today ? l.publishedAt : today,
        lastSeen: today, gone: null,
      };
      fresh.push(l);
      continue;
    }
    if (l.price < prev.price) {
      priceDrops.push({
        id: l.id, title: l.title, url: l.url, from: prev.price, to: l.price,
        totalDropPct: round(((prev.firstPrice - l.price) / prev.firstPrice) * 100, 1),
      });
    }
    if (l.price !== prev.price) {
      prev.priceHistory ||= [{ date: prev.firstSeen, price: prev.firstPrice }];
      prev.priceHistory.push({ date: today, price: l.price });
    }
    for (const [k, v] of Object.entries(info)) if (v === undefined || v === null) delete info[k];
    Object.assign(prev, info, { price: l.price, km: l.km ?? prev.km, lastSeen: today, gone: null });
  }

  // Une annonce absente n'est considérée « partie » que si le run n'a pas été tronqué par
  // la limite d'annonces : sinon elle est peut-être juste au-delà de la page récupérée.
  const goneNow = [];
  if (complete) {
    for (const [id, s] of Object.entries(state)) {
      if (!s.gone && !seenIds.has(id)) {
        s.gone = today;
        // La vente a eu lieu entre la dernière observation et ce relevé : on prend le milieu.
        const daysOnline = daysBetween(s.firstSeen, s.lastSeen) + daysBetween(s.lastSeen, today) / 2;
        goneNow.push({ id, ...s, daysOnline: Math.max(1, Math.round(daysOnline)) });
      }
    }
  }

  // Purge des annonces disparues depuis plus de 6 mois pour garder le fichier léger.
  for (const [id, s] of Object.entries(state)) {
    if (s.gone && daysBetween(s.gone, today) > 180) delete state[id];
  }

  const active = Object.values(state).filter((s) => !s.gone);
  return {
    fresh,
    goneNow,
    priceDrops,
    activeMedianAge: percentile(active.map((s) => daysBetween(s.firstSeen, today)), 50),
  };
}

export function buildSnapshot(kept, rejected, model, tracking, { today, truncated, bargainThreshold = 0.15 }) {
  const prices = kept.map((l) => l.price);
  const kms = kept.map((l) => l.km).filter(Boolean);
  const pm = priceModel(kept);
  const refKm = model.refKm || null;

  const bargains = kept
    .map((l) => {
      const expected = pm.expected(l.km);
      return { l, expected, discount: expected ? 1 - l.price / expected : 0 };
    })
    .filter((b) => b.discount >= bargainThreshold)
    .sort((a, b) => b.discount - a.discount)
    .slice(0, 5)
    .map(({ l, expected, discount }) => ({
      id: l.id, title: l.title, url: l.url, price: l.price, km: l.km, year: l.year, city: l.city,
      expected: round(expected, -1), discountPct: round(discount * 100, 0),
    }));

  const reasons = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;

  return {
    date: today,
    source: 'apify',
    count: kept.length,
    min: prices.length ? Math.min(...prices) : null,
    p25: round(percentile(prices, 25)),
    median: round(percentile(prices, 50)),
    p75: round(percentile(prices, 75)),
    max: prices.length ? Math.max(...prices) : null,
    avgKm: round(mean(kms), -3),
    medianKm: round(percentile(kms, 50), -3),
    refKm,
    refPrice: refKm ? round(pm.expected(refKm), -1) : null,
    eurPer10kKm: pm.fit ? round(-pm.fit.slope * 10000, -1) : null,
    newListings: tracking.fresh.length,
    sold: tracking.goneNow.length,
    soldMedianDays: round(percentile(tracking.goneNow.map((g) => g.daysOnline), 50)),
    activeMedianAge: round(tracking.activeMedianAge),
    priceDrops: tracking.priceDrops.slice(0, 5),
    bargains,
    proShare: kept.some((l) => l.pro != null) ? round(kept.filter((l) => l.pro).length / kept.filter((l) => l.pro != null).length, 2) : null,
    rejected: rejected.length,
    rejectedReasons: reasons,
    truncated,
  };
}
