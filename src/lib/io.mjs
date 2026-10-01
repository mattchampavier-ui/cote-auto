import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.COTE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function readJson(name) {
  return JSON.parse(await fs.readFile(path.resolve(ROOT, name), 'utf-8'));
}

export async function writeJson(name, value) {
  await fs.writeFile(path.resolve(ROOT, name), JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

export async function writeText(name, text) {
  await fs.mkdir(path.dirname(path.resolve(ROOT, name)), { recursive: true });
  await fs.writeFile(path.resolve(ROOT, name), text, 'utf-8');
}

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
