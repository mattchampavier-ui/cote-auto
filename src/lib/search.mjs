// Construction de l'URL de recherche LeBonCoin à partir des critères d'un modèle.
// Permet d'ajouter un véhicule sans jamais aller chercher d'URL à la main.

export function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// sortByDate : annonces les plus récentes en premier. Avec un échantillon limité (20 par mois),
// c'est ce qui rend les relevés comparables d'un mois sur l'autre.
export function buildSearchUrl(model, { sortByDate = false } = {}) {
  if (model.lbcSearchUrl) {
    // URL forcée à la main : prioritaire, seul le tri est ajouté si besoin.
    if (!sortByDate) return model.lbcSearchUrl;
    const u = new URL(model.lbcSearchUrl);
    u.searchParams.set('sort', 'time');
    u.searchParams.set('order', 'desc');
    return u.toString();
  }
  const q = model.search || {};
  const params = new URLSearchParams();
  params.set('category', '2'); // 2 = Voitures
  params.set('text', q.text || model.name);
  if (q.yearMin || q.yearMax) params.set('regdate', `${q.yearMin || 'min'}-${q.yearMax || 'max'}`);
  if (q.priceMin || q.priceMax) params.set('price', `${q.priceMin || 'min'}-${q.priceMax || 'max'}`);
  if (q.kmMax) params.set('mileage', `min-${q.kmMax}`);
  if (q.gearbox === 'manuelle') params.set('gearbox', '1');
  if (q.gearbox === 'automatique') params.set('gearbox', '2');
  if (sortByDate) {
    params.set('sort', 'time');
    params.set('order', 'desc');
  }
  return `https://www.leboncoin.fr/recherche?${params.toString()}`;
}

// Lit une URL de recherche LeBonCoin copiée depuis le navigateur (filtres compris) et en déduit
// les critères du véhicule : texte, années, prix, kilométrage. Renvoie null si l'URL n'en est pas une.
export function parseSearchUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/(^|\.)leboncoin\.fr$/.test(u.hostname) || !u.pathname.startsWith('/recherche')) return null;
  const p = u.searchParams;
  const range = (v) => {
    if (!v) return [undefined, undefined];
    const [a, b] = v.split('-').map((x) => (/^\d+$/.test(x) ? Number(x) : undefined));
    return [a, b];
  };
  const [yearMin, yearMax] = range(p.get('regdate'));
  const [priceMin, priceMax] = range(p.get('price'));
  const [, kmMax] = range(p.get('mileage'));
  const search = { text: p.get('text') || undefined, yearMin, yearMax, priceMin, priceMax, kmMax };
  Object.keys(search).forEach((k) => search[k] === undefined && delete search[k]);
  return { url: u.toString(), search };
}
