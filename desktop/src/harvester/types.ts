// Shared types of the key harvester.
//
// A *recipe* describes, for one provider, where its console lives, how to tell
// a logged-in page from a login page, how (optionally) to sign in with stored
// credentials, and the in-page script that creates a fresh API key. Recipes are
// plain data plus JavaScript source strings, so a recipe can be fixed by
// dropping an updated JSON file into the recipes folder, without rebuilding the
// app.

/** A step of the optional credential sign-in. Values are never logged. */
export type LoginStep =
  | { type: 'goto'; url: string }
  | { type: 'fill'; selector: string; value: 'email' | 'password' }
  | { type: 'click'; selector: string }
  | { type: 'wait'; ms: number }
  | { type: 'waitFor'; selector: string; timeoutMs?: number };

/** Where a harvested key is stored in the router. */
export type KeyTarget =
  /** A built-in platform of the router (`POST /api/keys`). */
  | { kind: 'platform'; platform: string }
  /** An OpenAI-compatible endpoint the router has no built-in provider for. */
  | { kind: 'custom'; baseUrl: string; models?: string[]; groupLabel?: string };

export type RecipeMode =
  /** Has a createKey script: the harvester can fetch keys on its own. */
  | 'auto'
  /** The provider works without a key: one click enables it. */
  | 'keyless'
  /** No script yet: the session can be prepared, the key is pasted by hand. */
  | 'manual';

export interface Recipe {
  /** Stable id; also names the persistent browser partition. */
  id: string;
  name: string;
  target: KeyTarget;
  mode: RecipeMode;
  /** Page that starts the sign-in flow. */
  loginUrl: string;
  /** Page where keys are created. Loaded before every createKey run. */
  keysUrl: string;
  /**
   * Regex (source) the page URL matches only when signed in. When the keys page
   * redirects somewhere this does not match, the session is treated as gone.
   */
  signedInUrlPattern: string;
  /** Optional extra in-page check (expression returning a boolean). */
  signedInScript?: string;
  /** Credential sign-in for sites with a plain email/password form. */
  autoLogin?: LoginStep[];
  /**
   * Body of an async function run inside the keys page with a helper object
   * `h` in scope. It must `return` the key string, or `{ key, accountId }`.
   */
  createKey?: string;
  /** Regex (source) a created key must match. */
  keyPattern?: string;
  /** True when verified against the live site. Drafts show a warning. */
  verified?: boolean;
  /** Short note shown in the dashboard (Turkish and English). */
  note?: { tr: string; en: string };
  /** Where this recipe came from: bundled with the app or the user folder. */
  source?: 'bundled' | 'user';
}

export type RunResult =
  | { status: 'ok'; keyId: number; masked: string; at: string }
  | { status: 'login_required'; at: string; message?: string }
  | { status: 'error'; at: string; message: string };

export interface RecipeState {
  lastRun?: RunResult;
  /** Last time the session was seen signed in (ISO). */
  signedInAt?: string;
  /** Replace invalid keys automatically. Defaults to true. */
  autoRefresh?: boolean;
}

/** What the dashboard sees for one recipe. Never contains secrets. */
export interface RecipeView {
  id: string;
  name: string;
  mode: RecipeMode;
  target: KeyTarget;
  keysUrl: string;
  verified: boolean;
  source: 'bundled' | 'user';
  note?: { tr: string; en: string };
  supportsAutoLogin: boolean;
  hasCredentials: boolean;
  credentialEmail?: string;
  running: boolean;
  queued: boolean;
  state: RecipeState;
}
