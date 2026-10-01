// Contenu du récap mensuel : calculs (buildRecap) puis rendu HTML + texte (renderRecap).
// Le HTML utilise des tableaux et des styles en ligne : c'est ce que Gmail, Outlook et les
// clients mobiles affichent de façon fiable.

import { evaluate } from './scoring.mjs';
import { buildSearchUrl } from './search.mjs';
import { round } from './stats.mjs';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// Mois couvert par le récap envoyé à la date `today` : le mois précédent.
export function recapMonth(today) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const eur = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')} €` : '—');
const pct = (n, digits = 1) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(digits).replace('.', ',')} %` : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildRecap({ models, data, config, today }) {
  const month = recapMonth(today);
  const settings = config.scoring;
  const active = models.filter((m) => m.active !== false);

  const rows = active.map((model) => {
    const history = data.snapshots[model.id] || [];
    const now = evaluate(model, history, settings);
    // Score « il y a un mois » : on rejoue l'évaluation sur l'historique tronqué.
    const prevHistory = now.previous ? history.slice(0, history.indexOf(now.previous) + 1) : [];
    const before = prevHistory.length ? evaluate(model, prevHistory, settings) : null;
    const monthSnaps = history.filter((s) => s.date.slice(0, 7) === month || s.date.slice(0, 7) === today.slice(0, 7));
    const sold = monthSnaps.reduce((a, s) => a + (s.sold || 0), 0);
    const fresh = monthSnaps.reduce((a, s) => a + (s.newListings || 0), 0);
    return {
      model,
      url: buildSearchUrl(model),
      eval: now,
      score: round(now.composite),
      scoreDelta: before ? round(now.composite - before.composite) : null,
      signalChanged: before && before.signal.tone !== now.signal.tone ? before.signal.label : null,
      median: now.latest?.median ?? null,
      refPrice: now.latest?.refPrice ?? null,
      refKm: now.latest?.refKm ?? model.refKm ?? null,
      count: now.latest?.count ?? 0,
      countDelta: now.previous && now.latest ? now.latest.count - now.previous.count : null,
      trend1m: now.trend1m,
      trend3m: now.trend3m,
      sold,
      fresh,
      soldDays: now.latest?.soldMedianDays ?? null,
      bargains: now.latest?.bargains || [],
      priceDrops: monthSnaps.flatMap((s) => s.priceDrops || []),
      lastDate: now.latest?.date ?? null,
      isNew: (model.addedAt || '').slice(0, 7) === month || (model.addedAt || '').slice(0, 7) === today.slice(0, 7),
    };
  }).sort((a, b) => b.score - a.score);

  const withTrend = rows.filter((r) => r.trend1m != null);
  const topUp = [...withTrend].sort((a, b) => b.trend1m - a.trend1m)[0];
  const topDown = [...withTrend].sort((a, b) => a.trend1m - b.trend1m)[0];

  const bargains = rows
    .flatMap((r) => r.bargains.map((b) => ({ ...b, modelName: r.model.name })))
    .sort((a, b) => b.discountPct - a.discountPct)
    .slice(0, 6);

  const drops = rows
    .flatMap((r) => r.priceDrops.map((d) => ({ ...d, modelName: r.model.name })))
    .sort((a, b) => (b.from - b.to) / b.from - (a.from - a.to) / a.from)
    .slice(0, 5);

  const runs = (data.meta?.runs || []).filter((r) => r.date.slice(0, 7) === month || r.date.slice(0, 7) === today.slice(0, 7));
  const problems = [];
  for (const r of rows) {
    const failed = runs.some((run) => run.failed.some((f) => f.id === r.model.id));
    const neverOk = runs.length > 0 && !runs.some((run) => run.ok.includes(r.model.id));
    if (r.count === 0) problems.push(`${r.model.name} : aucune annonce retenue — critères de recherche à revoir.`);
    else if (neverOk) problems.push(`${r.model.name} : aucun relevé réussi ce mois-ci${failed ? ' (erreur Apify)' : ''}.`);
    else if (r.count < 3) problems.push(`${r.model.name} : seulement ${r.count} annonce(s), le score est fragile.`);
  }
  if (runs.length === 0) problems.unshift('Aucun relevé automatique ce mois-ci : vérifier les secrets APIFY_TOKEN / APIFY_ACTOR et l’onglet Actions.');

  const highlights = [];
  const buys = rows.filter((r) => r.eval.signal.tone === 'buy');
  if (buys.length) highlights.push(`Signal d'achat : ${buys.map((r) => r.model.name).join(', ')}.`);
  for (const r of rows.filter((x) => x.signalChanged)) highlights.push(`${r.model.name} passe de « ${r.signalChanged} » à « ${r.eval.signal.label} ».`);
  if (topUp && topUp.trend1m > 0) highlights.push(`Plus forte hausse : ${topUp.model.name} (${pct(topUp.trend1m)} sur un mois).`);
  if (topDown && topDown.trend1m < 0) highlights.push(`Plus forte baisse : ${topDown.model.name} (${pct(topDown.trend1m)} sur un mois).`);
  if (bargains.length) highlights.push(`${bargains.length} annonce(s) nettement sous la cote, détail plus bas.`);
  if (!highlights.length) highlights.push('Mois calme : pas de changement de signal ni de mouvement de prix marquant.');

  // Premier récap : tout est « nouveau », le badge n'apporterait rien.
  if (rows.every((r) => r.isNew)) rows.forEach((r) => { r.isNew = false; });

  const scored = rows.filter((r) => r.count > 0);
  const avg = scored.length ? round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : 0;
  const deltas = rows.filter((r) => r.scoreDelta != null);
  return {
    month,
    label: monthLabel(month),
    today,
    rows,
    highlights,
    bargains,
    drops,
    problems,
    newModels: rows.filter((r) => r.isNew),
    kpis: {
      models: rows.length,
      avgScore: avg,
      avgScoreDelta: deltas.length ? round(deltas.reduce((a, r) => a + r.scoreDelta, 0) / deltas.length) : null,
      listings: rows.reduce((a, r) => a + r.count, 0),
      sold: rows.reduce((a, r) => a + r.sold, 0),
      runs: runs.length,
      costUsd: round(runs.reduce((a, r) => a + (r.costUsd || 0), 0), 2),
    },
    dashboardUrl: config.dashboardUrl,
    addUrl: `https://github.com/${config.repo}/issues/new?template=ajouter-vehicule.yml`,
  };
}

// Données compactes envoyées à Claude pour le paragraphe d'analyse.
export function recapForAi(r) {
  return r.rows.map((x) => ({
    vehicule: x.model.name,
    score: x.score,
    evolution_score: x.scoreDelta,
    signal: x.eval.signal.label,
    mediane: x.median,
    prix_km_reference: x.refPrice,
    tendance_1_mois_pct: x.trend1m,
    tendance_3_mois_pct: x.trend3m,
    annonces: x.count,
    vendues_ce_mois: x.sold,
    delai_vente_median_jours: x.soldDays,
    plancher: x.eval.floor,
    plafond: x.eval.ceiling,
    bonnes_affaires: x.bargains.length,
  }));
}

const C = {
  bg: '#F5F1EA', panel: '#FFFFFF', ink: '#1F1C18', dim: '#6E655A', line: '#E4DCCF', brass: '#A8742F',
  buy: '#2F7A5F', buyBg: '#E3F1EA', watch: '#9A6512', watchBg: '#F7EBD6', wait: '#6E6A63', waitBg: '#EEECE8',
  up: '#2F7A5F', down: '#B0412E',
};

function signalPill(sig) {
  const fg = C[sig.tone];
  const bg = C[`${sig.tone}Bg`];
  return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;background:${bg};color:${fg};font-size:12px;font-weight:600;white-space:nowrap">${esc(sig.label)}</span>`;
}

function delta(n, fmt = (v) => pct(v)) {
  if (!Number.isFinite(n) || n === 0) return `<span style="color:${C.dim}">${Number.isFinite(n) ? '=' : ''}</span>`;
  return `<span style="color:${n > 0 ? C.up : C.down}">${fmt(n)}</span>`;
}

const h2 = (t) => `<h2 style="font-family:Georgia,serif;font-weight:normal;font-size:20px;margin:30px 0 10px;color:${C.ink}">${t}</h2>`;

export function renderRecap(r, analysis) {
  const td = `style="padding:9px 8px;border-bottom:1px solid ${C.line};font-size:13px;vertical-align:top"`;
  const thBase = `padding:6px 8px;border-bottom:2px solid ${C.line};font-size:11px;color:${C.dim};font-weight:600;text-transform:uppercase;letter-spacing:.04em`;
  const th = `style="${thBase};text-align:left"`;
  const thR = `style="${thBase};text-align:right"`;
  const kpi = (num, lbl, extra = '') =>
    `<td style="padding:12px;background:${C.panel};border:1px solid ${C.line};border-radius:8px;text-align:center;width:25%"><div style="font-family:Georgia,serif;font-size:26px;color:${C.brass}">${num}${extra}</div><div style="font-size:12px;color:${C.dim}">${lbl}</div></td>`;

  const table = r.rows.map((x) => `
    <tr>
      <td ${td}><a href="${esc(x.url)}" style="color:${C.ink};font-weight:600;text-decoration:none">${esc(x.model.name)}</a>${x.isNew ? ` <span style="font-size:10px;color:${C.brass}">NOUVEAU</span>` : ''}<br><span style="color:${C.dim};font-size:12px">${x.count} annonce(s)${x.countDelta ? ` (${x.countDelta > 0 ? '+' : ''}${x.countDelta})` : ''}${x.sold ? ` · ${x.sold} vendue(s)${x.soldDays ? ` en ~${x.soldDays} j` : ''}` : ''}</span></td>
      <td ${td} align="right"><span style="font-family:Georgia,serif;font-size:18px;color:${C.brass}">${x.score}</span><br>${delta(x.scoreDelta, (v) => `${v > 0 ? '+' : ''}${v} pt`)}</td>
      <td ${td}>${signalPill(x.eval.signal)}</td>
      <td ${td} align="right">${eur(x.median)}<br>${delta(x.trend1m)}</td>
      <td ${td} align="right">${x.refPrice ? `${eur(x.refPrice)}<br><span style="color:${C.dim};font-size:11px">à ${Math.round(x.refKm / 1000)} 000 km</span>` : '—'}</td>
    </tr>`).join('');

  const bargains = r.bargains.length ? `${h2('Bonnes affaires du moment')}
    <p style="margin:0 0 8px;color:${C.dim};font-size:13px">Annonces au moins 15 % sous la cote attendue pour leur kilométrage. À vérifier de près : un prix bas a souvent une raison.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.panel};border:1px solid ${C.line}">
    ${r.bargains.map((b) => `<tr><td ${td}><a href="${esc(b.url)}" style="color:${C.ink};font-weight:600">${esc(b.title || b.modelName)}</a><br><span style="color:${C.dim};font-size:12px">${esc(b.modelName)} · ${b.year || '—'} · ${b.km ? `${Math.round(b.km / 1000)} 000 km` : 'km ?'}${b.city ? ` · ${esc(b.city)}` : ''}</span></td><td ${td} align="right"><b>${eur(b.price)}</b><br><span style="color:${C.up};font-size:12px">−${b.discountPct} % vs ${eur(b.expected)}</span></td></tr>`).join('')}
    </table>` : '';

  const drops = r.drops.length ? `${h2('Baisses de prix')}
    <ul style="margin:0;padding-left:18px;font-size:13px;color:${C.ink}">
    ${r.drops.map((d) => `<li style="margin-bottom:5px"><a href="${esc(d.url)}" style="color:${C.ink}">${esc(d.title || d.modelName)}</a> — ${eur(d.from)} → <b>${eur(d.to)}</b> <span style="color:${C.dim}">(${esc(d.modelName)})</span></li>`).join('')}
    </ul>` : '';

  const problems = r.problems.length ? `${h2('À vérifier')}
    <ul style="margin:0;padding-left:18px;font-size:13px;color:${C.dim}">${r.problems.map((p) => `<li style="margin-bottom:4px">${esc(p)}</li>`).join('')}</ul>` : '';

  const newModels = r.newModels.length
    ? `<p style="font-size:13px;color:${C.dim};margin:14px 0 0">Ajouté(s) au suivi récemment : ${r.newModels.map((x) => esc(x.model.name)).join(', ')}.</p>` : '';

  const analysisHtml = analysis
    ? `<div style="background:${C.panel};border-left:3px solid ${C.brass};padding:12px 16px;margin-top:14px;font-size:14px;line-height:1.55;color:${C.ink}">${analysis.split(/\n{2,}/).map((p) => `<p style="margin:0 0 8px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}<div style="font-size:11px;color:${C.dim}">Analyse rédigée par Claude à partir des chiffres ci-dessous.</div></div>` : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COTE — ${esc(r.label)}</title></head>
<body style="margin:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px">
<tr><td>
  <div style="font-family:Georgia,serif;font-size:30px;color:${C.ink}">COTE</div>
  <div style="color:${C.dim};font-size:14px;margin-bottom:18px">Récap de ${esc(r.label)} · ${r.kpis.runs} relevé(s) automatique(s)</div>
  <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate"><tr>
    ${kpi(r.kpis.models, 'véhicules suivis')}
    ${kpi(r.kpis.avgScore, 'score moyen', r.kpis.avgScoreDelta ? ` <span style="font-size:13px">${delta(r.kpis.avgScoreDelta, (v) => `${v > 0 ? '+' : ''}${v}`)}</span>` : '')}
    ${kpi(r.kpis.listings, 'annonces actives')}
    ${kpi(r.kpis.sold, 'ventes détectées')}
  </tr></table>
  ${h2("L'essentiel")}
  <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
  ${analysisHtml}
  ${h2('Classement')}
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.panel};border:1px solid ${C.line}">
    <tr><th ${th}>Véhicule</th><th ${thR}>Score</th><th ${th}>Signal</th><th ${thR}>Médiane · 1 mois</th><th ${thR}>Cote à km réf.</th></tr>
    ${table}
  </table>
  ${newModels}
  ${bargains}
  ${drops}
  ${problems}
  <p style="margin:30px 0 6px;font-size:14px"><a href="${esc(r.dashboardUrl)}" style="color:${C.brass};font-weight:600">Ouvrir le dashboard</a> &nbsp;·&nbsp; <a href="${esc(r.addUrl)}" style="color:${C.brass}">Ajouter un véhicule</a></p>
  <p style="font-size:11px;color:${C.dim};margin:0">Outil de suivi de marché, pas un conseil d'achat. Score = rareté, désirabilité, « dernier de », proximité du plancher, momentum de la cote, tension du marché.${r.kpis.costUsd ? ` Coût Apify du mois : ${r.kpis.costUsd} $.` : ''}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    `COTE — récap de ${r.label}`,
    '',
    `${r.kpis.models} véhicules · score moyen ${r.kpis.avgScore} · ${r.kpis.listings} annonces · ${r.kpis.sold} ventes détectées`,
    '',
    "L'ESSENTIEL",
    ...r.highlights.map((h) => `- ${h}`),
    ...(analysis ? ['', analysis] : []),
    '',
    'CLASSEMENT',
    ...r.rows.map((x) => `- ${x.model.name} : ${x.score}/100${x.scoreDelta ? ` (${x.scoreDelta > 0 ? '+' : ''}${x.scoreDelta})` : ''} · ${x.eval.signal.label} · médiane ${eur(x.median)} (${pct(x.trend1m)}) · ${x.count} annonces`),
    ...(r.bargains.length ? ['', 'BONNES AFFAIRES', ...r.bargains.map((b) => `- ${b.title} — ${eur(b.price)} (−${b.discountPct} %) ${b.url || ''}`)] : []),
    ...(r.problems.length ? ['', 'À VÉRIFIER', ...r.problems.map((p) => `- ${p}`)] : []),
    '',
    `Dashboard : ${r.dashboardUrl}`,
  ].join('\n');

  return { html, text, subject: `COTE · ${r.label} — ${r.highlights[0]}`.slice(0, 140) };
}
