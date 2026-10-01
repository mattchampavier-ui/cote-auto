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

export function buildSearchUrl(model) {
  if (model.lbcSearchUrl) return model.lbcSearchUrl; // URL forcée à la main : prioritaire
  const q = model.search || {};
  const params = new URLSearchParams();
  params.set('category', '2'); // 2 = Voitures
  params.set('text', q.text || model.name);
  if (q.yearMin || q.yearMax) params.set('regdate', `${q.yearMin || 'min'}-${q.yearMax || 'max'}`);
  if (q.priceMin || q.priceMax) params.set('price', `${q.priceMin || 'min'}-${q.priceMax || 'max'}`);
  if (q.kmMax) params.set('mileage', `min-${q.kmMax}`);
  if (q.gearbox === 'manuelle') params.set('gearbox', '1');
  if (q.gearbox === 'automatique') params.set('gearbox', '2');
  return `https://www.leboncoin.fr/recherche?${params.toString()}`;
}
