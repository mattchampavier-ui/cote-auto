import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(REPO, 'tests', 'fixtures');

// Copie les fichiers de données dans un dossier temporaire : les tests n'écrivent jamais
// dans le dépôt. À appeler AVANT d'importer les modules qui lisent COTE_ROOT.
export function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cote-'));
  for (const f of ['config.json', 'models.json', 'data.json', 'listings.json']) {
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  }
  // Repart d'un journal vierge : le data.json du dépôt contient les vrais passages du robot.
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf-8'));
  data.meta = { lastRun: null, lastRecap: null, runs: [] };
  // Seule l'amorce manuelle de septembre est gardée : les tests rejouent leurs propres relevés.
  for (const id of Object.keys(data.snapshots)) data.snapshots[id] = data.snapshots[id].filter((x) => x.source === 'manuel');
  fs.writeFileSync(path.join(dir, 'listings.json'), '{}');
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data));
  process.env.COTE_ROOT = dir;
  // Le robot écrit sa progression sur la console ; sous Node 20, ces lignes se mêlent au canal
  // du lanceur de tests et le font parfois échouer (« Unable to deserialize cloned data »).
  console.log = () => {};
  console.warn = () => {};
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  return {
    dir,
    read: (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')),
    exists: (f) => fs.existsSync(path.join(dir, f)),
  };
}
