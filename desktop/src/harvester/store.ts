import fs from 'node:fs';
import path from 'node:path';
import type { RecipeState } from './types.js';

// Two small JSON files next to the database:
//   harvester-credentials.json  email (plain) + password (OS-encrypted, base64)
//   harvester-state.json        last run results and per-recipe settings
// Passwords are encrypted with Electron's safeStorage (DPAPI on Windows,
// Keychain on macOS, libsecret on Linux) and never leave the main process.

export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

interface CredentialFile {
  [recipeId: string]: { email: string; password: string };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class CredentialStore {
  constructor(private readonly file: string, private readonly box: SecretBox) {}

  canStore(): boolean {
    return this.box.available();
  }

  set(recipeId: string, email: string, password: string): void {
    if (!this.box.available()) throw new Error('Secure storage is not available on this system');
    const all = readJson<CredentialFile>(this.file, {});
    all[recipeId] = { email, password: this.box.encrypt(password).toString('base64') };
    writeJsonAtomic(this.file, all);
  }

  get(recipeId: string): { email: string; password: string } | null {
    const entry = readJson<CredentialFile>(this.file, {})[recipeId];
    if (!entry) return null;
    try {
      return { email: entry.email, password: this.box.decrypt(Buffer.from(entry.password, 'base64')) };
    } catch {
      return null;
    }
  }

  email(recipeId: string): string | undefined {
    return readJson<CredentialFile>(this.file, {})[recipeId]?.email;
  }

  remove(recipeId: string): void {
    const all = readJson<CredentialFile>(this.file, {});
    if (!(recipeId in all)) return;
    delete all[recipeId];
    writeJsonAtomic(this.file, all);
  }
}

export class StateStore {
  private cache: Record<string, RecipeState>;

  constructor(private readonly file: string) {
    this.cache = readJson<Record<string, RecipeState>>(file, {});
  }

  get(recipeId: string): RecipeState {
    return this.cache[recipeId] ?? {};
  }

  update(recipeId: string, patch: Partial<RecipeState>): RecipeState {
    const next = { ...this.get(recipeId), ...patch };
    this.cache[recipeId] = next;
    try {
      writeJsonAtomic(this.file, this.cache);
    } catch (err) {
      console.warn('[harvester] could not persist state:', err);
    }
    return next;
  }
}
