// Récap mensuel par email. Envoyé une seule fois par mois, au premier passage du robot à
// partir du 1er (le cron GitHub peut partir en retard : le passage suivant rattrape l'envoi).
//
//   node src/recap.mjs              envoie si le récap du mois n'est pas encore parti
//   node src/recap.mjs --force      envoie quoi qu'il arrive
//   node src/recap.mjs --dry-run    génère recaps/AAAA-MM.html sans envoyer
//
// Chaque récap est aussi archivé dans recaps/ (consultable depuis le dashboard).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, writeJson, writeText, todayISO, parseArgs } from './lib/io.mjs';
import { buildRecap, renderRecap, recapForAi } from './lib/recap.mjs';
import { askClaude } from './lib/claude.mjs';

const SYSTEM = `Tu es un analyste du marché des voitures d'occasion de collection et youngtimers en France.
Tu écris en français, de façon directe et concrète, pour un particulier qui suit quelques modèles
en vue d'un achat-plaisir à potentiel de valorisation. Pas de conseil financier, pas de formules creuses.`;

async function analysisFor(recap, config) {
  const prompt = `Voici les chiffres du mois de ${recap.label} pour les véhicules suivis (prix LeBonCoin, en euros) :

${JSON.stringify(recapForAi(recap), null, 1)}

Écris 2 courts paragraphes (90 à 140 mots au total, sans titre, sans liste à puces, sans markdown) :
1. ce qui a bougé ce mois-ci et ce que ça dit du marché (cite les chiffres utiles) ;
2. le ou les modèles à regarder de près le mois prochain et pourquoi, en tenant compte du nombre
   d'annonces (une tendance sur 2 annonces n'est pas fiable — dis-le si c'est le cas).
Si l'historique est trop court pour conclure, dis-le simplement.`;
  return askClaude(prompt, { model: config.ai?.model, system: SYSTEM, maxTokens: 700 });
}

async function send({ subject, html, text, attachments = [] }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.EMAIL_TO || user;
  if (!user || !pass) {
    console.warn('GMAIL_USER / GMAIL_APP_PASSWORD manquants : récap généré mais pas envoyé (voir README, étape 3).');
    return false;
  }
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transport.sendMail({ from: `COTE <${user}>`, to, subject, html, text, attachments });
  console.log(`Récap envoyé à ${to}.`);
  return true;
}

export async function recap({ force = false, dryRun = false, today = todayISO() } = {}) {
  const config = await readJson('config.json');
  const { models } = await readJson('models.json');
  const data = await readJson('data.json');
  const r = buildRecap({ models, data, config, today });

  if (!force && !dryRun && data.meta?.lastRecap === r.month) {
    console.log(`Récap de ${r.label} déjà envoyé.`);
    return { sent: false, reason: 'déjà envoyé' };
  }

  const analysis = await analysisFor(r, config);
  const out = renderRecap(r, analysis);
  await writeText(`recaps/${r.month}.html`, out.html);
  const index = await readJson('recaps/index.json').catch(() => []);
  if (!index.some((e) => e.month === r.month)) index.unshift({ month: r.month, label: r.label });
  index.sort((a, b) => b.month.localeCompare(a.month));
  await writeJson('recaps/index.json', index);

  if (dryRun) {
    console.log(`Aperçu écrit dans recaps/${r.month}.html (aucun envoi).`);
    return { sent: false, reason: 'dry-run', subject: out.subject };
  }
  // La base Excel (régénérée juste avant par le workflow) part en pièce jointe.
  const xlsx = path.join(ROOT, 'cote-auto.xlsx');
  const attachments = fs.existsSync(xlsx) ? [{ filename: `cote-auto-${r.month}.xlsx`, path: xlsx }] : [];
  const sent = await send({ ...out, attachments });
  if (sent) {
    data.meta.lastRecap = r.month;
    await writeJson('data.json', data);
  }
  return { sent, subject: out.subject };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  recap({ force: args.force === true || args.force === 'true', dryRun: !!args['dry-run'], today: args.date || undefined })
    .catch((err) => { console.error(err); process.exit(1); });
}
