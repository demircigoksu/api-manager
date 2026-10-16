import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Notification, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron';
import { BUNDLED_RECIPES, mergeRecipes, parseRecipe } from './recipes.js';
import { CredentialStore, StateStore } from './store.js';
import { KeySink } from './key-sink.js';
import { LoginRequiredError, clearSession, openLoginWindow, runRecipe } from './engine.js';
import { RECIPES_README } from './recipes-readme.js';
import type { Recipe, RecipeView, RunResult } from './types.js';

export { isHarvesterContents } from './engine.js';

/** Minimum gap between two automatic runs of the same recipe. */
const AUTO_RETRY_GAP_MS = 15 * 60_000;

interface Job {
  recipeId: string;
  replaceKeyId?: number;
  automatic: boolean;
  resolve: (r: RunResult) => void;
}

export interface HarvesterDeps {
  port: () => number;
  token: () => string;
  locale: () => string;
  onKeyInvalid: (cb: (e: { keyId: number; platform: string; label: string; reason: string | null; autoDisabled: boolean }) => void) => () => void;
}

export class Harvester {
  private recipes: Recipe[] = [];
  private readonly credentials: CredentialStore;
  private readonly state: StateStore;
  private readonly sink: KeySink;
  private readonly queue: Job[] = [];
  private running: string | null = null;
  private readonly lastAutoRun = new Map<string, number>();
  readonly recipesDir: string;

  constructor(private readonly deps: HarvesterDeps) {
    const dir = app.getPath('userData');
    this.recipesDir = path.join(dir, 'recipes');
    this.credentials = new CredentialStore(path.join(dir, 'harvester-credentials.json'), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    });
    this.state = new StateStore(path.join(dir, 'harvester-state.json'));
    this.sink = new KeySink({ port: deps.port(), token: deps.token });
    this.reloadRecipes();
    deps.onKeyInvalid((e) => void this.onKeyInvalid(e.keyId, e.platform));
  }

  // ── recipes ──────────────────────────────────────────────────────────────
  reloadRecipes(): { loaded: number; errors: string[] } {
    const errors: string[] = [];
    const user: Recipe[] = [];
    try {
      fs.mkdirSync(this.recipesDir, { recursive: true });
      const readme = path.join(this.recipesDir, 'README.md');
      if (!fs.existsSync(readme)) fs.writeFileSync(readme, RECIPES_README);
      for (const name of fs.readdirSync(this.recipesDir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const parsed = parseRecipe(JSON.parse(fs.readFileSync(path.join(this.recipesDir, name), 'utf8')));
          if ('error' in parsed) errors.push(`${name}: ${parsed.error}`);
          else user.push(parsed.recipe);
        } catch (err: any) {
          errors.push(`${name}: ${err?.message ?? err}`);
        }
      }
    } catch (err: any) {
      errors.push(String(err?.message ?? err));
    }
    this.recipes = mergeRecipes(BUNDLED_RECIPES, user);
    for (const e of errors) console.warn('[harvester] recipe error:', e);
    this.broadcast();
    return { loaded: user.length, errors };
  }

  private recipe(id: unknown): Recipe {
    const r = typeof id === 'string' ? this.recipes.find((x) => x.id === id) : undefined;
    if (!r) throw new Error('Unknown provider');
    return r;
  }

  list(): RecipeView[] {
    return this.recipes.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      target: r.target,
      keysUrl: r.keysUrl,
      verified: r.verified === true,
      source: r.source ?? 'bundled',
      note: r.note,
      supportsAutoLogin: Boolean(r.autoLogin?.length),
      hasCredentials: Boolean(this.credentials.email(r.id)),
      credentialEmail: this.credentials.email(r.id),
      running: this.running === r.id,
      queued: this.queue.some((j) => j.recipeId === r.id),
      state: this.state.get(r.id),
    }));
  }

  // ── actions ──────────────────────────────────────────────────────────────
  harvest(recipeId: string, opts: { replaceKeyId?: number; automatic?: boolean } = {}): Promise<RunResult> {
    this.recipe(recipeId);
    const existing = this.queue.find((j) => j.recipeId === recipeId);
    if (existing || this.running === recipeId) {
      return Promise.resolve(this.state.get(recipeId).lastRun ?? { status: 'error', at: now(), message: 'Already running' });
    }
    return new Promise<RunResult>((resolve) => {
      this.queue.push({ recipeId, replaceKeyId: opts.replaceKeyId, automatic: opts.automatic === true, resolve });
      this.broadcast();
      void this.pump();
    });
  }

  async harvestAll(): Promise<void> {
    for (const r of this.recipes) {
      if (r.mode === 'auto' || r.mode === 'keyless') void this.harvest(r.id);
    }
  }

  async login(recipeId: string): Promise<RunResult | null> {
    const r = this.recipe(recipeId);
    const tr = this.deps.locale().startsWith('tr');
    await openLoginWindow(r, tr ? `${r.name}: giriş yapın, bitince bu pencereyi kapatın` : `${r.name}: sign in, then close this window`);
    return this.checkSession(recipeId);
  }

  async checkSession(recipeId: string): Promise<RunResult | null> {
    const r = this.recipe(recipeId);
    if (r.mode === 'keyless') return null;
    try {
      await runRecipe(r, { checkOnly: true, credentials: this.credentials.get(r.id) });
      this.state.update(r.id, { signedInAt: now() });
      this.broadcast();
      return null;
    } catch (err) {
      const result: RunResult = err instanceof LoginRequiredError
        ? { status: 'login_required', at: now(), message: err.message }
        : { status: 'error', at: now(), message: errMsg(err) };
      this.state.update(r.id, { lastRun: result, ...(result.status === 'login_required' ? { signedInAt: undefined } : {}) });
      this.broadcast();
      return result;
    }
  }

  async logout(recipeId: string): Promise<void> {
    const r = this.recipe(recipeId);
    await clearSession(r);
    this.state.update(r.id, { signedInAt: undefined });
    this.broadcast();
  }

  setCredentials(recipeId: string, email: unknown, password: unknown): void {
    this.recipe(recipeId);
    if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Invalid credentials');
    const e = email.trim();
    if (!e || e.length > 320 || password.length === 0 || password.length > 1024) throw new Error('Invalid credentials');
    this.credentials.set(recipeId, e, password);
    this.broadcast();
  }

  clearCredentials(recipeId: string): void {
    this.recipe(recipeId);
    this.credentials.remove(recipeId);
    this.broadcast();
  }

  setAutoRefresh(recipeId: string, on: unknown): void {
    this.recipe(recipeId);
    this.state.update(recipeId, { autoRefresh: on === true });
    this.broadcast();
  }

  // ── internals ────────────────────────────────────────────────────────────
  private async onKeyInvalid(keyId: number, platform: string): Promise<void> {
    let recipe: Recipe | undefined;
    if (platform === 'custom') {
      try {
        const row = (await this.sink.listKeys()).find((k) => k.id === keyId);
        const base = row?.baseUrl?.replace(/\/+$/, '').toLowerCase();
        recipe = this.recipes.find((r) => r.target.kind === 'custom' && r.target.baseUrl.replace(/\/+$/, '').toLowerCase() === base);
      } catch {
        return;
      }
    } else {
      recipe = this.recipes.find((r) => r.target.kind === 'platform' && r.target.platform === platform);
    }
    if (!recipe || recipe.mode !== 'auto') return;
    if (this.state.get(recipe.id).autoRefresh === false) return;
    const last = this.lastAutoRun.get(recipe.id) ?? 0;
    if (Date.now() - last < AUTO_RETRY_GAP_MS) return;
    this.lastAutoRun.set(recipe.id, Date.now());
    console.log(`[harvester] key ${keyId} (${platform}) was rejected; fetching a replacement from ${recipe.id}`);
    void this.harvest(recipe.id, { replaceKeyId: keyId, automatic: true });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = job.recipeId;
    this.broadcast();
    const result = await this.execute(job);
    this.state.update(job.recipeId, {
      lastRun: result,
      ...(result.status === 'ok' ? { signedInAt: result.at } : {}),
      ...(result.status === 'login_required' ? { signedInAt: undefined } : {}),
    });
    this.running = null;
    this.broadcast();
    if (job.automatic && result.status !== 'ok') this.notify(job.recipeId, result);
    job.resolve(result);
    void this.pump();
  }

  private async execute(job: Job): Promise<RunResult> {
    const r = this.recipe(job.recipeId);
    try {
      if (r.mode === 'keyless') {
        if (r.target.kind !== 'platform') throw new Error('Keyless recipes must target a platform');
        const { keyId, masked } = await this.sink.enableKeyless(r.target.platform);
        return { status: 'ok', keyId, masked, at: now() };
      }
      const key = await runRecipe(r, { credentials: this.credentials.get(r.id) });
      const { keyId, masked } = await this.sink.save(r, key, job.replaceKeyId);
      console.log(`[harvester] ${r.id}: stored key ${keyId} (${masked})`);
      return { status: 'ok', keyId, masked, at: now() };
    } catch (err) {
      if (err instanceof LoginRequiredError) return { status: 'login_required', at: now(), message: err.message };
      console.warn(`[harvester] ${r.id} failed:`, errMsg(err));
      return { status: 'error', at: now(), message: errMsg(err) };
    }
  }

  private notify(recipeId: string, result: RunResult): void {
    if (!Notification.isSupported()) return;
    const r = this.recipe(recipeId);
    const tr = this.deps.locale().startsWith('tr');
    const body = result.status === 'login_required'
      ? (tr ? `${r.name} anahtarı geçersiz oldu. Yenisini almak için Anahtar Toplayıcı'dan tekrar giriş yapın.` : `${r.name} key was rejected. Sign in again from Key Harvester to fetch a new one.`)
      : (tr ? `${r.name} için yeni anahtar alınamadı: ${result.status === 'error' ? result.message : ''}` : `Could not fetch a new ${r.name} key: ${result.status === 'error' ? result.message : ''}`);
    new Notification({ title: tr ? 'Anahtar Toplayıcı' : 'Key Harvester', body }).show();
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.session !== session.defaultSession) continue;
      win.webContents.send('freeapi:harvester-changed');
    }
  }
}

function now(): string {
  return new Date().toISOString();
}

function errMsg(err: unknown): string {
  return String((err as any)?.message ?? err).slice(0, 500);
}

/**
 * IPC for the dashboard. Only the dashboard window (default session, served
 * from 127.0.0.1) may call these; provider pages run in their own partitions
 * and have no preload at all.
 */
export function registerHarvesterIpc(h: Harvester): void {
  const guard = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    if (e.sender.session !== session.defaultSession || !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
      throw new Error('Not allowed');
    }
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(`freeapi:harvester:${channel}`, async (e, ...args) => {
      guard(e);
      return fn(...args);
    });
  };
  handle('list', () => h.list());
  handle('harvest', (id: string) => h.harvest(id));
  handle('harvest-all', () => h.harvestAll());
  handle('login', (id: string) => h.login(id));
  handle('check', (id: string) => h.checkSession(id));
  handle('logout', (id: string) => h.logout(id));
  handle('set-credentials', (id: string, email: unknown, password: unknown) => h.setCredentials(id, email, password));
  handle('clear-credentials', (id: string) => h.clearCredentials(id));
  handle('set-auto', (id: string, on: unknown) => h.setAutoRefresh(id, on));
  handle('reload-recipes', () => h.reloadRecipes());
  handle('open-recipes-folder', () => shell.openPath(h.recipesDir));
}
