// Statistiques de base, sans dépendance — partagées entre le robot (Node) et le dashboard.

export function median(nums) {
  return percentile(nums, 50);
}

// Percentile par interpolation linéaire (même convention qu'Excel CENTILE.INCLURE).
export function percentile(nums, p) {
  const xs = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

export function mean(nums) {
  const xs = nums.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// Retire les valeurs hors de [Q1 - k·IQR, Q3 + k·IQR]. En dessous de 5 valeurs, on ne
// filtre pas : l'IQR n'a pas de sens et on risquerait de jeter la moitié du marché.
export function iqrBounds(nums, k = 1.5) {
  if (nums.length < 5) return { lo: -Infinity, hi: Infinity };
  const q1 = percentile(nums, 25);
  const q3 = percentile(nums, 75);
  const iqr = q3 - q1;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr };
}

// Régression linéaire prix ~ km. Sert à comparer des annonces à kilométrages différents
// (une 206 RC à 240 000 km n'a pas la même cote qu'à 90 000 km).
export function linearFit(points) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function round(v, digits = 0) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
