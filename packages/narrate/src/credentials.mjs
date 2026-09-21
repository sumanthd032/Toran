/**
 * Bhashini credentials, read from .env.local at the repository root.
 *
 * Three values, and they come from two different places. The userID and the
 * ULCA key are on the Bhashini profile page. The inference key is not: it
 * arrives in the body of the pipeline configuration call, which is why
 * `configure` returns it rather than reading it from here. Setting
 * BHASHINI_INFERENCE_API_KEY pins that value instead, for a deployment that
 * would rather not make the configuration call on every run.
 *
 * Nothing here is ever printed. A key that reaches a log reaches a bug report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export class MissingCredentials extends Error {
  constructor(names) {
    super(
      `Bhashini credentials are not set: ${names.join(', ')}.\n` +
        `Register at https://bhashini.gov.in, then fill them into .env.local.\n` +
        `See .env.example. Nothing in the offline kiosk needs these; they are\n` +
        `used only to fill the translation and narration cache at build time.`,
    );
    this.name = 'MissingCredentials';
    this.missing = names;
  }
}

/** The two credentials the configuration call needs. Throws if either is absent. */
export function credentials() {
  load();
  const userId = process.env['BHASHINI_USER_ID'] ?? '';
  const ulcaApiKey = process.env['BHASHINI_ULCA_API_KEY'] ?? '';
  const missing = [];
  if (userId === '') missing.push('BHASHINI_USER_ID');
  if (ulcaApiKey === '') missing.push('BHASHINI_ULCA_API_KEY');
  if (missing.length > 0) throw new MissingCredentials(missing);
  return { userId, ulcaApiKey, inferenceApiKey: process.env['BHASHINI_INFERENCE_API_KEY'] || null };
}

/** Whether a run can reach the API at all, without throwing to find out. */
export function haveCredentials() {
  try {
    credentials();
    return true;
  } catch {
    return false;
  }
}
