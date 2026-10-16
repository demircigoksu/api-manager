import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, session, type Session, type WebContents } from 'electron';
import { PAGE_HELPERS, wrapRecipeScript } from './page-helpers.js';
import { normaliseCreatedKey } from './recipes.js';
import { DEFAULT_SIGNED_IN_SCRIPT, pickCapturedKey } from './capture.js';
import type { LoginStep, Recipe } from './types.js';

// The browser side of the harvester. Every recipe gets its own persistent
// Chromium partition (cookies survive restarts and are encrypted at rest by
// the EnableCookieEncryption fuse), so signing in once is enough until the
// provider expires the session. Key creation runs in a hidden window that
// never gets Node access: recipes are page scripts, nothing more.

const LOAD_TIMEOUT_MS = 45_000;
const SCRIPT_TIMEOUT_MS = 90_000;
const SETTLE_MS = 2_500;

export class LoginRequiredError extends Error {
  constructor(message = 'Sign-in required') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

const harvesterSessions = new WeakSet<Session>();

export function partitionFor(recipeId: string): string {
  return `persist:harvest-${recipeId}`;
}

/** True for web contents that belong to a harvester partition. */
export function isHarvesterContents(contents: WebContents): boolean {
  return harvesterSessions.has(contents.session);
}

function sessionFor(recipe: Recipe): Session {
  const ses = session.fromPartition(partitionFor(recipe.id));
  if (!harvesterSessions.has(ses)) {
    harvesterSessions.add(ses);
    // Present as the Chrome the shell is built on: some consoles refuse
    // sign-in for user agents that advertise an embedded browser.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(?:FreeLLMAPI|freellmapi-desktop|Electron)\/\S+/gi, ''));
    // Provider pages get nothing beyond what a page needs to sign in and
    // copy a key.
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write');
    });
  }
  return ses;
}

function makeWindow(recipe: Recipe, show: boolean): BrowserWindow {
  sessionFor(recipe);
  const win = new BrowserWindow({
    show,
    width: 1180,
    height: 860,
    title: recipe.name,
    autoHideMenuBar: true,
    webPreferences: {
      partition: partitionFor(recipe.id),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // OAuth providers (Google, GitHub) sign in through popups; they stay in the
  // same partition so the cookies land where the recipe will look for them.
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      show: true,
      autoHideMenuBar: true,
      webPreferences: { partition: partitionFor(recipe.id), contextIsolation: true, sandbox: true, nodeIntegration: false },
    },
  }));
  return win;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function load(win: BrowserWindow, url: string): Promise<void> {
  try {
    await withTimeout(win.loadURL(url), LOAD_TIMEOUT_MS, `Loading ${new URL(url).host}`);
  } catch (err: any) {
    // ERR_ABORTED is what a redirect during load looks like (e.g. to the
    // login page); the page that ends up loaded is what we check next.
    if (!/ERR_ABORTED|\(-3\)/.test(String(err?.message ?? err))) throw err;
  }
  await sleep(SETTLE_MS);
}

async function isSignedIn(win: BrowserWindow, recipe: Recipe): Promise<boolean> {
  const url = win.webContents.getURL();
  if (!new RegExp(recipe.signedInUrlPattern).test(url)) return false;
  // Some consoles render their sign-in form on the keys URL itself. Without a
  // recipe-specific check, a visible password field or a lone "Sign in"
  // button means the session is gone.
  const script = recipe.signedInScript ?? DEFAULT_SIGNED_IN_SCRIPT;
  try {
    return Boolean(await win.webContents.executeJavaScript(`(() => { try { return !!(${script}); } catch { return false; } })()`, true));
  } catch (err) {
    console.log(`[harvester] ${recipe.id}: signedInScript failed:`, String((err as any)?.message ?? err).slice(0, 200));
    return false;
  }
}

async function runLoginSteps(win: BrowserWindow, steps: LoginStep[], creds: { email: string; password: string }): Promise<void> {
  for (const step of steps) {
    if (step.type === 'goto') {
      await load(win, step.url);
      continue;
    }
    if (step.type === 'wait') {
      await sleep(step.ms);
      continue;
    }
    const body =
      step.type === 'fill'
        ? `await h.fill(args.selector, args.value); return true;`
        : step.type === 'click'
          ? `await h.click(args.selector); return true;`
          : `await h.waitFor(args.selector, { timeout: args.timeout }); return true;`;
    const args =
      step.type === 'fill'
        ? { selector: step.selector, value: step.value === 'email' ? creds.email : creds.password }
        : step.type === 'waitFor'
          ? { selector: step.selector, timeout: step.timeoutMs ?? 20_000 }
          : { selector: step.selector };
    const res = await withTimeout(
      win.webContents.executeJavaScript(wrapRecipeScript(body, args), true) as Promise<{ ok: boolean; error?: string }>,
      SCRIPT_TIMEOUT_MS,
      'Sign-in step',
    );
    if (!res?.ok) throw new LoginRequiredError(`Automatic sign-in failed: ${res?.error ?? 'unknown error'}`);
    // A click often navigates; give the next page a moment.
    if (step.type === 'click') await sleep(1_500);
  }
}

export interface RunOptions {
  credentials?: { email: string; password: string } | null;
  /** Only check (and refresh) the session, do not create a key. */
  checkOnly?: boolean;
  /** Show the window (debugging a recipe). */
  visible?: boolean;
}

/**
 * Opens the keys page in a hidden window, signs in with stored credentials if
 * the session is gone and the recipe knows how, then runs createKey.
 * Resolves to the key (or '' for checkOnly). Throws LoginRequiredError when a
 * human has to sign in.
 */
export async function runRecipe(recipe: Recipe, opts: RunOptions = {}): Promise<string> {
  if (recipe.localSource) {
    const key = await readLocalSource(recipe.localSource);
    if (opts.checkOnly) return '';
    return normaliseCreatedKey(recipe, key);
  }
  const win = makeWindow(recipe, opts.visible === true);
  try {
    await load(win, recipe.keysUrl);
    let signedIn = await isSignedIn(win, recipe);

    if (!signedIn && opts.credentials && recipe.autoLogin?.length) {
      await runLoginSteps(win, recipe.autoLogin, opts.credentials);
      await sleep(3_000);
      await load(win, recipe.keysUrl);
      signedIn = await isSignedIn(win, recipe);
    }
    if (!signedIn) {
      // Origin and path only: query strings can carry tokens.
      let where = win.webContents.getURL();
      try { const u = new URL(where); where = `${u.origin}${u.pathname}`; } catch { /* keep raw */ }
      let title = '';
      try { title = String(await win.webContents.executeJavaScript('document.title', true)).slice(0, 80); } catch { /* ignore */ }
      console.log(`[harvester] ${recipe.id}: not signed in (page: ${where}, title: ${JSON.stringify(title)})`);
      throw new LoginRequiredError();
    }
    if (opts.checkOnly) return '';
    if (!recipe.createKey) throw new Error('This provider has no automatic key recipe yet');

    const res = await withTimeout(
      win.webContents.executeJavaScript(wrapRecipeScript(recipe.createKey), true) as Promise<{ ok: boolean; value?: unknown; error?: string }>,
      SCRIPT_TIMEOUT_MS,
      'Key creation',
    );
    if (!res?.ok) throw new Error(res?.error ?? 'The recipe failed');
    return normaliseCreatedKey(recipe, res.value);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Visible sign-in window. While it is open, a key that appears on the page
 * (matching the recipe's keyPattern) or that the user copies with the page's
 * Copy button is captured, so a provider without an automatic recipe still
 * needs only "sign in, create key, copy". Resolves when the user closes the
 * window, with the captured key if there was one.
 */
export function openLoginWindow(recipe: Recipe, title: string): Promise<{ capturedKey?: string }> {
  const win = makeWindow(recipe, true);
  win.setTitle(title);
  const keyRe = recipe.keyPattern ? new RegExp(recipe.keyPattern.replace(/^\^|\$$/g, '')) : null;
  return new Promise((resolve) => {
    let done = false;
    let captured: string | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      resolve({ capturedKey: captured });
    };
    const inject = () => {
      win.webContents
        .executeJavaScript(`(() => { if (window.__harvestHooked) return; window.__harvestHooked = true; ${PAGE_HELPERS}; h.captureClipboard(); })()`, true)
        .catch(() => {});
    };
    win.webContents.on('dom-ready', inject);
    const poll = setInterval(async () => {
      if (win.isDestroyed() || captured) return;
      try {
        const found = await win.webContents.executeJavaScript(
          `(() => {
            const re = ${keyRe ? `new RegExp(${JSON.stringify(keyRe.source)})` : 'null'};
            const clip = String(window.__harvestClipboard || '').trim();
            let page = null;
            if (re) {
              for (const el of document.querySelectorAll('input, textarea')) { const m = (el.value || '').match(re); if (m) { page = m[0]; break; } }
              if (!page) for (const el of document.querySelectorAll('code, pre, span, div, p')) { if (el.children.length > 2) continue; const m = (el.textContent || '').match(re); if (m) { page = m[0]; break; } }
            }
            return { clip, page };
          })()`,
          true,
        ) as { clip?: string; page?: string | null } | null;
        const value = pickCapturedKey(found?.clip ?? '', found?.page ?? null, keyRe);
        if (!value) return;
        captured = value;
        win.setTitle(`${title}  ✓`);
        setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 1_500);
      } catch {
        /* page navigating */
      }
    }, 1_500);
    // Keep the window title ours: pages overwrite it otherwise.
    win.on('page-title-updated', (e) => e.preventDefault());
    win.on('closed', finish);
    win.loadURL(recipe.loginUrl).catch(() => {});
  });
}

/** Reads a token from a CLI the user already signed in to. */
async function readLocalSource(kind: NonNullable<Recipe['localSource']>): Promise<string> {
  if (kind === 'gh-cli') {
    const out = await new Promise<string>((resolve, reject) => {
      execFile('gh', ['auth', 'token'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
        if (err) reject(new LoginRequiredError('GitHub CLI is not installed or not signed in (run "gh auth login")'));
        else resolve(String(stdout));
      });
    });
    return out.trim();
  }
  const home = os.homedir();
  const candidates = [
    process.env.HF_TOKEN_PATH,
    process.env.HF_HOME ? path.join(process.env.HF_HOME, 'token') : undefined,
    path.join(home, '.cache', 'huggingface', 'token'),
  ].filter((p): p is string => Boolean(p));
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN.trim();
  for (const file of candidates) {
    try {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    } catch {
      /* next */
    }
  }
  throw new LoginRequiredError('Hugging Face CLI is not signed in (run "hf auth login")');
}

export async function clearSession(recipe: Recipe): Promise<void> {
  await sessionFor(recipe).clearStorageData();
}
