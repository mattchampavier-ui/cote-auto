// Score composite et signal — module pur, importé à la fois par le robot (récap mensuel) et
// par le dashboard (index.html), pour que les deux affichent exactement les mêmes chiffres.

import { clamp, pctChange, daysBetween, round } from './stats.mjs';

export const DEFAULT_WEIGHTS = {
  rarete: 0.2,
  desirabilite: 0.2,
  dernierDe: 0.1,
  proximite: 0.2,
  momentum: 0.15,
  marche: 0.15,
};

const priceOf = (s) => (s ? s.refPrice ?? s.median : null);

// Relevé le plus récent datant d'au moins `days` jours avant `ref` (tolérance de 25 %).
export function snapshotAgo(history, ref, days) {
  let best = null;
  for (const s of history) {
    const age = daysBetween(s.date, ref.date);
    if (age >= days * 0.75) best = s;
  }
  return best;
}

// Bornes plancher / plafond de la jauge. Tant qu'on a moins de 3 mois de relevés robot, on
// garde les bornes saisies à la main (si présentes) ; ensuite, ce sont les prix réellement
// observés qui font foi : plus bas P25 et plus haut P75 relevés.
export function bounds(model, history) {
  const manual = Number.isFinite(model.floor) && Number.isFinite(model.ceiling);
  const robot = history.filter((s) => s.source !== 'manuel' && s.count > 0);
  const span = robot.length ? daysBetween(robot[0].date, robot[robot.length - 1].date) : 0;
  if (manual && span < 90) return { floor: model.floor, ceiling: model.ceiling, auto: false };
  const src = robot.length ? robot : history;
  const lows = src.map((s) => s.p25 ?? s.min).filter(Number.isFinite);
  const highs = src.map((s) => s.p75 ?? s.max).filter(Number.isFinite);
  if (!lows.length) return manual ? { floor: model.floor, ceiling: model.ceiling, auto: false } : { floor: null, ceiling: null, auto: true };
  return { floor: Math.min(...lows), ceiling: Math.max(...highs), auto: true };
}

export function evaluate(model, history = [], settings = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...(settings.weights || {}) };
  const fullLiquidity = settings.fullLiquidity ?? 15;
  const latest = history[history.length - 1] || null;
  const b = bounds(model, history);
  if (!latest) {
    return { latest: null, ...b, proximite: 0, momentum: 50, marche: 0, composite: 0, signal: signalFor(0, 0, 50, 0), trend1m: null, trend3m: null, trend12m: null };
  }

  const range = Math.max(1, (b.ceiling ?? 0) - (b.floor ?? 0));
  const proximite = b.floor == null ? 50 : clamp(100 * (1 - (latest.median - b.floor) / range), 0, 100);

  const m1 = snapshotAgo(history, latest, 30);
  const m3 = snapshotAgo(history, latest, 90);
  const m12 = snapshotAgo(history, latest, 365);
  const trend1m = m1 ? pctChange(priceOf(m1), priceOf(latest)) : null;
  const trend3m = m3 ? pctChange(priceOf(m3), priceOf(latest)) : null;
  const trend12m = m12 ? pctChange(priceOf(m12), priceOf(latest)) : null;
  // Momentum : la cote remonte-t-elle ? +10 % sur 3 mois → 90, stable → 50, -10 % → 10.
  // Sans historique suffisant, on reste neutre (50) plutôt que d'inventer une tendance.
  const t = trend3m ?? (trend1m != null ? trend1m * 2 : null);
  const momentum = t == null ? 50 : clamp(50 + t * 4, 0, 100);

  // Marché : assez d'offre pour acheter (liquidité) ET des voitures qui partent vite (rotation).
  const liquidite = clamp((latest.count / fullLiquidity) * 100, 0, 100);
  const days = latest.soldMedianDays ?? null;
  const rotation = days == null ? null : clamp(100 - ((days - 15) / (120 - 15)) * 100, 0, 100);
  const marche = rotation == null ? liquidite : 0.5 * liquidite + 0.5 * rotation;

  const composite =
    model.rarete * w.rarete +
    model.desirabilite * w.desirabilite +
    model.dernierDe * w.dernierDe +
    proximite * w.proximite +
    momentum * w.momentum +
    marche * w.marche;

  return {
    latest, ...b, proximite, momentum, marche, liquidite, rotation, composite,
    trend1m: round(trend1m, 1), trend3m: round(trend3m, 1), trend12m: round(trend12m, 1),
    previous: m1,
    signal: signalFor(composite, proximite, momentum, latest.count),
  };
}

export function signalFor(composite, proximite, momentum, count) {
  if (count === 0) return { label: 'Pas de données', tone: 'wait' };
  // Pas de signal d'achat sur une cote qui chute franchement : on attend qu'elle se stabilise.
  if (composite >= 68 && proximite >= 55 && momentum >= 40) return { label: "Signal d'achat", tone: 'buy' };
  if (composite >= 55) return { label: 'À surveiller', tone: 'watch' };
  return { label: 'Attendre', tone: 'wait' };
}
