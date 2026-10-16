import type { KeyTarget, Recipe, RecipeMode } from './types.js';

// Bundled recipes: every provider from the free LLM API lists the app was
// built around (awesome-freellm-apis and awesome-free-llm-apis), plus GitHub
// Models. `mode: 'manual'` entries still get a managed sign-in session; their
// createKey script is added once the console has been inspected while signed
// in (see docs/key-harvester.md). A JSON file with the same id in the user's
// recipes folder replaces the bundled entry, so a recipe can be fixed without
// a rebuild.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Signed-in pattern defaulting to "the keys page itself, any query/hash". */
export function defaultSignedInPattern(keysUrl: string): string {
  const u = new URL(keysUrl);
  const path = u.pathname.replace(/\/+$/, '');
  return `^${escapeRe(`${u.protocol}//${u.host}${path}`)}(?:[/?#]|$)`;
}

interface Def {
  id: string;
  name: string;
  target: KeyTarget;
  loginUrl?: string;
  keysUrl: string;
  mode?: RecipeMode;
  signedInUrlPattern?: string;
  signedInScript?: string;
  keyPattern?: string;
  createKey?: string;
  localSource?: Recipe['localSource'];
  verified?: boolean;
  note?: { tr: string; en: string };
}

const platform = (p: string): KeyTarget => ({ kind: 'platform', platform: p });
const custom = (baseUrl: string, models?: string[]): KeyTarget => ({
  kind: 'custom',
  baseUrl,
  models,
  groupLabel: 'Anahtar Toplayıcı',
});

// Verified against the live dashboard (Oct 2026): the dashboard's own API
// accepts the session cookie plus the x-atok header from /system/bootstrap.
// The new token gets Workers AI Read + Write on the first account; older
// tokens this app created are deleted only after the new one exists.
const CLOUDFLARE_CREATE_KEY = String.raw`
const boot = await h.fetchJson('/api/v4/system/bootstrap');
const atok = boot && boot.result && boot.result.data && boot.result.data.atok;
if (!atok) throw new Error('Cloudflare dashboard token not found');
const H = { 'content-type': 'application/json', 'x-atok': atok };
const accounts = (await h.fetchJson('/api/v4/accounts?per_page=50', { headers: H })).result || [];
if (!accounts.length) throw new Error('No Cloudflare account on this login');
const account = accounts[0];
const groups = ((await h.fetchJson('/api/v4/user/tokens/permission_groups', { headers: H })).result || [])
  .filter((g) => /^Workers AI (Read|Write)$/.test(g.name));
if (!groups.length) throw new Error('Workers AI permission groups not found');
const created = await h.fetchJson('/api/v4/user/tokens', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    name: h.keyName,
    policies: [{ effect: 'allow', resources: { ['com.cloudflare.api.account.' + account.id]: '*' }, permission_groups: groups.map((g) => ({ id: g.id })) }],
  }),
});
if (!created.success || !created.result || !created.result.value) throw new Error('Token creation failed: ' + JSON.stringify(created.errors || []));
try {
  const old = ((await h.fetchJson('/api/v4/user/tokens?per_page=50', { headers: H })).result || [])
    .filter((t) => /^freellmapi-/.test(t.name) && t.id !== created.result.id);
  for (const t of old) await h.fetchJson('/api/v4/user/tokens/' + t.id, { method: 'DELETE', headers: H }).catch(() => {});
} catch (e) { /* cleanup is best-effort */ }
return { key: created.result.value, accountId: account.id };
`;

const DEFS: Def[] = [
  // Groq shows its sign-in form on /keys itself, without a redirect.
  { id: 'groq', name: 'Groq', target: platform('groq'), loginUrl: 'https://console.groq.com/login', keysUrl: 'https://console.groq.com/keys', keyPattern: 'gsk_[A-Za-z0-9]{40,}',
    signedInScript: "!Array.from(document.querySelectorAll('button')).some((b) => /continue with (email|google|github)/i.test(b.innerText))",
    note: { tr: 'Giriş e-postaya gelen bağlantıyla yapılır, şifre kaydetmek işe yaramaz.', en: 'Sign-in uses an emailed link, a stored password does not help.' } },
  { id: 'openrouter', name: 'OpenRouter', target: platform('openrouter'), loginUrl: 'https://openrouter.ai/sign-in', keysUrl: 'https://openrouter.ai/settings/keys', keyPattern: 'sk-or-v1-[a-f0-9]{48,}' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', target: platform('cloudflare'), loginUrl: 'https://dash.cloudflare.com/login', keysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    createKey: CLOUDFLARE_CREATE_KEY, verified: true, keyPattern: '^[A-Za-z0-9_-]{40,}$',
    note: { tr: 'Workers AI Okuma/Yazma yetkili token oluşturur, eskilerini siler. "hesap_id:token" biçiminde saklanır.', en: 'Creates a Workers AI Read/Write token and removes older ones. Stored as "account_id:token".' } },
  { id: 'cerebras', name: 'Cerebras', target: platform('cerebras'), loginUrl: 'https://cloud.cerebras.ai/', keysUrl: 'https://cloud.cerebras.ai/platform',
    signedInUrlPattern: '^https://cloud\\.cerebras\\.ai/platform', keyPattern: 'csk-[a-z0-9]{40,}' },
  { id: 'mistral', name: 'Mistral AI', target: platform('mistral'), loginUrl: 'https://console.mistral.ai/', keysUrl: 'https://console.mistral.ai/api-keys' },
  // GitHub asks for a 2FA code before creating a token, so the browser route
  // cannot run unattended. The GitHub CLI token works for GitHub Models
  // (verified Oct 2026: models.github.ai answered 200 with a gh OAuth token).
  { id: 'github', name: 'GitHub Models', target: platform('github'), loginUrl: 'https://github.com/login', keysUrl: 'https://github.com/settings/personal-access-tokens/new',
    localSource: 'gh-cli', verified: true, keyPattern: '^(gho_|ghp_|github_pat_)[A-Za-z0-9_]{20,}$',
    note: { tr: 'Bilgisayardaki GitHub CLI (gh) oturumunun anahtarını kullanır. Önce "gh auth login" yapılmış olmalı.', en: 'Uses the GitHub CLI (gh) session on this computer. Run "gh auth login" first.' } },
  // The token page needs the password again (sudo mode); the CLI token is
  // the unattended route.
  { id: 'huggingface', name: 'Hugging Face', target: platform('huggingface'), loginUrl: 'https://huggingface.co/login', keysUrl: 'https://huggingface.co/settings/tokens',
    localSource: 'hf-cli', keyPattern: '^hf_[A-Za-z0-9]{30,}$',
    note: { tr: 'Bilgisayardaki Hugging Face CLI oturumunun anahtarını kullanır. Önce "hf auth login" yapılmış olmalı.', en: 'Uses the Hugging Face CLI session on this computer. Run "hf auth login" first.' } },
  { id: 'google', name: 'Google Gemini (AI Studio)', target: platform('google'), loginUrl: 'https://aistudio.google.com/app/api-keys', keysUrl: 'https://aistudio.google.com/app/api-keys', keyPattern: 'AIza[0-9A-Za-z_-]{35}',
    note: { tr: 'Google, gömülü tarayıcılarda girişi engelleyebilir.', en: 'Google may block sign-in inside embedded browsers.' } },
  { id: 'nvidia', name: 'NVIDIA NIM', target: platform('nvidia'), loginUrl: 'https://build.nvidia.com/', keysUrl: 'https://build.nvidia.com/settings/api-keys', keyPattern: 'nvapi-[A-Za-z0-9_-]{40,}',
    signedInScript: "!Array.from(document.querySelectorAll('button, a')).some((b) => /^(login|sign in)$/i.test(b.innerText.trim()))" },
  { id: 'cohere', name: 'Cohere', target: platform('cohere'), loginUrl: 'https://dashboard.cohere.com/welcome/login', keysUrl: 'https://dashboard.cohere.com/api-keys',
    note: { tr: 'Ücretsiz anahtar ticari olmayan kullanım içindir.', en: 'The free key is for non-commercial use.' } },
  { id: 'ollama', name: 'Ollama Cloud', target: platform('ollama'), loginUrl: 'https://ollama.com/signin', keysUrl: 'https://ollama.com/settings/keys' },
  { id: 'zhipu', name: 'Z AI (Zhipu)', target: platform('zhipu'), loginUrl: 'https://z.ai/', keysUrl: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'aion', name: 'Aion Labs', target: platform('aion'), loginUrl: 'https://www.aionlabs.ai/', keysUrl: 'https://www.aionlabs.ai/app/api-keys/' },
  { id: 'agnes', name: 'Agnes AI', target: platform('agnes'), loginUrl: 'https://platform.agnes-ai.com/', keysUrl: 'https://platform.agnes-ai.com/settings/apiKeys' },
  { id: 'opencode', name: 'OpenCode Zen', target: platform('opencode'), loginUrl: 'https://opencode.ai/auth', keysUrl: 'https://opencode.ai/auth' },
  { id: 'modelscope', name: 'ModelScope', target: platform('modelscope'), loginUrl: 'https://modelscope.cn/', keysUrl: 'https://modelscope.cn/my/myaccesstoken',
    note: { tr: 'Alibaba Cloud hesabı bağlama ve gerçek kimlik doğrulaması gerekir.', en: 'Requires Alibaba Cloud binding and real-name verification.' } },
  { id: 'siliconflow', name: 'SiliconFlow', target: platform('siliconflow'), loginUrl: 'https://cloud.siliconflow.cn/', keysUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: { tr: 'Ücretsiz modeller için Çin kimlik doğrulaması gerekir.', en: 'Free models need Chinese ID verification.' } },
  { id: 'llm7', name: 'LLM7.io', target: platform('llm7'), loginUrl: 'https://token.llm7.io', keysUrl: 'https://token.llm7.io',
    note: { tr: 'Anahtarsız da çalışır; anahtar sadece limitleri yükseltir.', en: 'Works without a key; a key only raises limits.' } },
  { id: 'kilo', name: 'Kilo Code', target: platform('kilo'), keysUrl: 'https://app.kilo.ai/profile', mode: 'keyless' },
  { id: 'ovh', name: 'OVHcloud AI Endpoints', target: platform('ovh'), keysUrl: 'https://endpoints.ai.cloud.ovh.net', mode: 'keyless' },

  // Providers the router has no built-in support for: stored as custom
  // OpenAI-compatible endpoints with their free models.
  { id: 'alibaba', name: 'Alibaba Cloud Model Studio', target: custom('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', ['qwen3-max', 'qwen3-plus', 'qwen3-vl-plus']),
    loginUrl: 'https://modelstudio.console.alibabacloud.com/', keysUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1',
    signedInUrlPattern: '^https://(bailian|modelstudio)\\.console\\.alibabacloud\\.com/' },
  { id: 'sambanova', name: 'SambaNova', target: custom('https://api.sambanova.ai/v1'), loginUrl: 'https://cloud.sambanova.ai/', keysUrl: 'https://cloud.sambanova.ai/apis' },
  { id: 'xai', name: 'xAI (Grok)', target: custom('https://api.x.ai/v1'), loginUrl: 'https://accounts.x.ai/sign-in', keysUrl: 'https://console.x.ai', keyPattern: 'xai-[A-Za-z0-9]{40,}',
    signedInUrlPattern: '^https://console\\.x\\.ai/(?!welcome)' ,
    note: { tr: 'Krediye dayalı; ücretsiz kredi yoksa çalışmaz.', en: 'Credit-based; needs free credits on the account.' } },
  { id: 'chutes', name: 'Chutes.ai', target: custom('https://api.chutes.ai/v1'), loginUrl: 'https://chutes.ai/auth', keysUrl: 'https://chutes.ai/app/api', keyPattern: 'cpk_[A-Za-z0-9._-]{30,}' },
  { id: 'glhf', name: 'Glhf.chat', target: custom('https://glhf.chat/api/openai/v1'), loginUrl: 'https://glhf.chat/', keysUrl: 'https://glhf.chat/users/settings/api' },
  { id: 'ai21', name: 'AI21 Labs', target: custom('https://api.ai21.com/studio/v1', ['jamba-large-1.7', 'jamba-mini-2']), loginUrl: 'https://studio.ai21.com/login', keysUrl: 'https://studio.ai21.com/account/api-key' },
  { id: 'deepseek', name: 'DeepSeek', target: custom('https://api.deepseek.com/v1', ['deepseek-chat', 'deepseek-reasoner']), loginUrl: 'https://platform.deepseek.com/sign_in', keysUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'nscale', name: 'Nscale', target: custom('https://inference.api.nscale.com/v1'), loginUrl: 'https://console.nscale.com/', keysUrl: 'https://console.nscale.com/' ,
    signedInUrlPattern: '^https://console\\.nscale\\.com/(?!login|sign)' },
  // Nebius AI Studio moved to Token Factory (studio.nebius.com redirects there).
  { id: 'nebius', name: 'Nebius Token Factory', target: custom('https://api.studio.nebius.com/v1'), loginUrl: 'https://tokenfactory.nebius.com/', keysUrl: 'https://tokenfactory.nebius.com/',
    signedInUrlPattern: '^https://tokenfactory\\.nebius\\.com/(?!login|sign)' },
];

export const BUNDLED_RECIPES: Recipe[] = DEFS.map((d) => ({
  id: d.id,
  name: d.name,
  target: d.target,
  mode: d.mode ?? 'manual',
  loginUrl: d.loginUrl ?? d.keysUrl,
  keysUrl: d.keysUrl,
  signedInUrlPattern: d.signedInUrlPattern ?? defaultSignedInPattern(d.keysUrl),
  signedInScript: d.signedInScript,
  keyPattern: d.keyPattern,
  createKey: d.createKey,
  localSource: d.localSource,
  ...(d.createKey || d.localSource ? { mode: 'auto' as const } : {}),
  note: d.note,
  verified: d.verified === true,
  source: 'bundled',
}));

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Validates a recipe loaded from disk. Returns the recipe with defaults filled
 * in, or an error message. Kept free of Electron so it is unit-testable.
 */
export function parseRecipe(raw: unknown): { recipe: Recipe } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined);
  const id = str('id');
  if (!id || !ID_RE.test(id)) return { error: 'id must be lowercase letters, digits or dashes' };
  const name = str('name') ?? id;
  const keysUrl = str('keysUrl');
  if (!keysUrl || !isHttps(keysUrl)) return { error: `${id}: keysUrl must be an https URL` };
  const loginUrl = str('loginUrl') ?? keysUrl;
  if (!isHttps(loginUrl)) return { error: `${id}: loginUrl must be an https URL` };

  const t = r.target as Record<string, unknown> | undefined;
  let target: KeyTarget;
  if (t && t.kind === 'platform' && typeof t.platform === 'string') {
    target = { kind: 'platform', platform: t.platform };
  } else if (t && t.kind === 'custom' && typeof t.baseUrl === 'string' && isHttps(t.baseUrl)) {
    const models = Array.isArray(t.models) ? t.models.filter((m): m is string => typeof m === 'string' && m.length > 0) : undefined;
    target = { kind: 'custom', baseUrl: t.baseUrl, models, groupLabel: typeof t.groupLabel === 'string' ? t.groupLabel : 'Anahtar Toplayıcı' };
  } else {
    return { error: `${id}: target must be {kind:"platform",platform} or {kind:"custom",baseUrl}` };
  }

  const createKey = str('createKey');
  const modeRaw = str('mode');
  const mode: RecipeMode = modeRaw === 'keyless' ? 'keyless' : createKey ? 'auto' : 'manual';
  const signedInUrlPattern = str('signedInUrlPattern') ?? defaultSignedInPattern(keysUrl);
  for (const [k, v] of [['signedInUrlPattern', signedInUrlPattern], ['keyPattern', str('keyPattern')]] as const) {
    if (v === undefined) continue;
    try { new RegExp(v); } catch { return { error: `${id}: ${k} is not a valid regular expression` }; }
  }

  let autoLogin: Recipe['autoLogin'];
  if (Array.isArray(r.autoLogin)) {
    autoLogin = [];
    for (const s of r.autoLogin as Record<string, unknown>[]) {
      if (s?.type === 'goto' && typeof s.url === 'string' && isHttps(s.url)) autoLogin.push({ type: 'goto', url: s.url });
      else if (s?.type === 'fill' && typeof s.selector === 'string' && (s.value === 'email' || s.value === 'password')) autoLogin.push({ type: 'fill', selector: s.selector, value: s.value });
      else if (s?.type === 'click' && typeof s.selector === 'string') autoLogin.push({ type: 'click', selector: s.selector });
      else if (s?.type === 'wait' && typeof s.ms === 'number') autoLogin.push({ type: 'wait', ms: Math.min(s.ms, 30_000) });
      else if (s?.type === 'waitFor' && typeof s.selector === 'string') autoLogin.push({ type: 'waitFor', selector: s.selector, timeoutMs: typeof s.timeoutMs === 'number' ? s.timeoutMs : undefined });
      else return { error: `${id}: invalid autoLogin step ${JSON.stringify(s)}` };
    }
  }

  const note = r.note && typeof r.note === 'object'
    ? { tr: String((r.note as any).tr ?? ''), en: String((r.note as any).en ?? '') }
    : undefined;

  return {
    recipe: {
      id,
      name,
      target,
      mode,
      loginUrl,
      keysUrl,
      signedInUrlPattern,
      signedInScript: str('signedInScript'),
      autoLogin,
      createKey,
      keyPattern: str('keyPattern'),
      verified: r.verified === true,
      note,
      source: 'user',
    },
  };
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Bundled recipes overlaid with user recipes (same id replaces). */
export function mergeRecipes(bundled: Recipe[], user: Recipe[]): Recipe[] {
  const byId = new Map(bundled.map((r) => [r.id, r] as const));
  for (const r of user) byId.set(r.id, r);
  return [...byId.values()];
}

/** Normalises what a createKey script returned into the stored key string. */
export function normaliseCreatedKey(recipe: Recipe, value: unknown): string {
  let key: string | undefined;
  let accountId: string | undefined;
  if (typeof value === 'string') key = value;
  else if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.key === 'string') key = v.key;
    if (typeof v.accountId === 'string') accountId = v.accountId;
  }
  key = key?.trim();
  if (!key) throw new Error('The recipe did not return a key');
  if (recipe.keyPattern && !new RegExp(recipe.keyPattern).test(key)) {
    throw new Error('The returned value does not look like a key for this provider');
  }
  if (recipe.target.kind === 'platform' && recipe.target.platform === 'cloudflare') {
    if (!accountId && !key.includes(':')) throw new Error('Cloudflare needs an account id next to the token');
    return accountId ? `${accountId.trim()}:${key}` : key;
  }
  return key;
}
