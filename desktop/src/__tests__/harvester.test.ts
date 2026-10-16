import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_RECIPES, defaultSignedInPattern, mergeRecipes, normaliseCreatedKey, parseRecipe } from '../harvester/recipes.js';
import { CredentialStore, StateStore } from '../harvester/store.js';
import { HARVEST_LABEL, KeySink } from '../harvester/key-sink.js';
import { wrapRecipeScript } from '../harvester/page-helpers.js';
import type { Recipe } from '../harvester/types.js';

describe('bundled recipes', () => {
  it('have unique ids, https URLs and valid patterns', () => {
    const ids = new Set<string>();
    for (const r of BUNDLED_RECIPES) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(new URL(r.keysUrl).protocol).toBe('https:');
      expect(new URL(r.loginUrl).protocol).toBe('https:');
      expect(() => new RegExp(r.signedInUrlPattern)).not.toThrow();
    }
    expect(BUNDLED_RECIPES.length).toBeGreaterThanOrEqual(29);
  });

  it('round-trip through the user-recipe parser', () => {
    for (const r of BUNDLED_RECIPES) {
      const parsed = parseRecipe(JSON.parse(JSON.stringify(r)));
      expect('recipe' in parsed, r.id).toBe(true);
    }
  });
});

describe('defaultSignedInPattern', () => {
  it('matches the keys page and its sub paths but not the login page', () => {
    const re = new RegExp(defaultSignedInPattern('https://console.groq.com/keys'));
    expect(re.test('https://console.groq.com/keys')).toBe(true);
    expect(re.test('https://console.groq.com/keys?x=1')).toBe(true);
    expect(re.test('https://console.groq.com/keys/abc')).toBe(true);
    expect(re.test('https://console.groq.com/keysmith')).toBe(false);
    expect(re.test('https://console.groq.com/login?next=/keys')).toBe(false);
  });
});

describe('parseRecipe', () => {
  const base = {
    id: 'groq',
    name: 'Groq',
    target: { kind: 'platform', platform: 'groq' },
    keysUrl: 'https://console.groq.com/keys',
  };

  it('derives the mode from createKey', () => {
    const manual = parseRecipe(base);
    const auto = parseRecipe({ ...base, createKey: 'return "gsk_x"' });
    expect('recipe' in manual && manual.recipe.mode).toBe('manual');
    expect('recipe' in auto && auto.recipe.mode).toBe('auto');
  });

  it('rejects unsafe or malformed input', () => {
    expect(parseRecipe({ ...base, id: '../evil' })).toHaveProperty('error');
    expect(parseRecipe({ ...base, keysUrl: 'http://console.groq.com/keys' })).toHaveProperty('error');
    expect(parseRecipe({ ...base, target: { kind: 'custom', baseUrl: 'file:///etc' } })).toHaveProperty('error');
    expect(parseRecipe({ ...base, signedInUrlPattern: '(' })).toHaveProperty('error');
    expect(parseRecipe({ ...base, autoLogin: [{ type: 'eval', code: 'x' }] })).toHaveProperty('error');
    expect(parseRecipe({ ...base, autoLogin: [{ type: 'fill', selector: '#e', value: 'token' }] })).toHaveProperty('error');
  });

  it('caps wait steps', () => {
    const r = parseRecipe({ ...base, autoLogin: [{ type: 'wait', ms: 10_000_000 }] });
    expect('recipe' in r && r.recipe.autoLogin).toEqual([{ type: 'wait', ms: 30_000 }]);
  });
});

describe('mergeRecipes', () => {
  it('lets a user recipe replace the bundled one with the same id', () => {
    const user = parseRecipe({ id: 'groq', name: 'Mine', target: { kind: 'platform', platform: 'groq' }, keysUrl: 'https://console.groq.com/keys', createKey: 'return 1' });
    if (!('recipe' in user)) throw new Error('parse failed');
    const merged = mergeRecipes(BUNDLED_RECIPES, [user.recipe]);
    expect(merged.filter((r) => r.id === 'groq')).toHaveLength(1);
    expect(merged.find((r) => r.id === 'groq')?.name).toBe('Mine');
    expect(merged).toHaveLength(BUNDLED_RECIPES.length);
  });
});

describe('normaliseCreatedKey', () => {
  const recipe = (over: Partial<Recipe> = {}): Recipe => ({ ...BUNDLED_RECIPES.find((r) => r.id === 'groq')!, ...over });

  const gsk = 'gsk_' + 'A1'.repeat(26);

  it('accepts strings and {key}', () => {
    expect(normaliseCreatedKey(recipe(), `  ${gsk}  `)).toBe(gsk);
    expect(normaliseCreatedKey(recipe(), { key: gsk })).toBe(gsk);
  });

  it('enforces keyPattern', () => {
    expect(() => normaliseCreatedKey(recipe({ keyPattern: '^gsk_' }), 'sk-other')).toThrow();
  });

  it('builds the Cloudflare account_id:token form', () => {
    const cf = BUNDLED_RECIPES.find((r) => r.id === 'cloudflare')!;
    const tok = 'T'.repeat(53);
    expect(normaliseCreatedKey(cf, { key: tok, accountId: 'acc' })).toBe(`acc:${tok}`);
    expect(() => normaliseCreatedKey(cf, tok)).toThrow(/account id/);
  });

  it('rejects empty results', () => {
    expect(() => normaliseCreatedKey(recipe(), '')).toThrow();
    expect(() => normaliseCreatedKey(recipe(), undefined)).toThrow();
  });
});

describe('stores', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harvester-'));
  const box = {
    available: () => true,
    encrypt: (s: string) => Buffer.from(`enc:${s}`),
    decrypt: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  };

  it('never writes the password in the clear', () => {
    const file = path.join(tmp(), 'creds.json');
    const store = new CredentialStore(file, box);
    store.set('groq', 'me@example.com', 'hunter2');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(store.get('groq')).toEqual({ email: 'me@example.com', password: 'hunter2' });
    expect(store.email('groq')).toBe('me@example.com');
    store.remove('groq');
    expect(store.get('groq')).toBeNull();
  });

  it('refuses to store without OS encryption', () => {
    const store = new CredentialStore(path.join(tmp(), 'c.json'), { ...box, available: () => false });
    expect(() => store.set('groq', 'a@b.c', 'x')).toThrow();
  });

  it('persists state across instances', () => {
    const file = path.join(tmp(), 'state.json');
    new StateStore(file).update('groq', { autoRefresh: false });
    expect(new StateStore(file).get('groq')).toEqual({ autoRefresh: false });
  });
});

describe('KeySink', () => {
  function fakeServer(rows: any[]) {
    const calls: { method: string; path: string; body?: any }[] = [];
    let nextId = 100;
    const fetchImpl = (async (url: string, init: any) => {
      const u = new URL(url);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path: u.pathname, body });
      expect(init.headers.Authorization).toBe('Bearer tok');
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
      if (init.method === 'GET' && u.pathname === '/api/keys') return json(200, rows);
      if (init.method === 'POST' && u.pathname === '/api/keys') {
        const id = nextId++;
        rows.push({ id, platform: body.platform, label: body.label, baseUrl: null, maskedKey: 'gsk_****' });
        return json(201, { id });
      }
      if (init.method === 'POST' && u.pathname === '/api/keys/custom/discover-models') return json(200, { models: [{ id: 'm1' }, { id: 'm2' }] });
      if (init.method === 'POST' && u.pathname === '/api/keys/custom') {
        const id = nextId++;
        rows.push({ id, platform: 'custom', label: body.label, baseUrl: body.baseUrl, maskedKey: 'sk-****' });
        return json(201, { keyId: id });
      }
      if (init.method === 'PATCH') return json(200, { ok: true });
      if (u.pathname.startsWith('/api/health/check/')) return json(200, {});
      return json(404, { error: { message: 'nope' } });
    }) as unknown as typeof fetch;
    return { calls, sink: new KeySink({ port: 1, token: () => 'tok', fetchImpl }) };
  }
  const groq = BUNDLED_RECIPES.find((r) => r.id === 'groq')!;
  const samba = BUNDLED_RECIPES.find((r) => r.id === 'sambanova')!;

  it('creates a labelled row the first time, then replaces it in place', async () => {
    const { calls, sink } = fakeServer([]);
    const first = await sink.save(groq, 'gsk_1');
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/keys')?.body).toEqual({ platform: 'groq', key: 'gsk_1', label: HARVEST_LABEL });
    calls.length = 0;
    const second = await sink.save(groq, 'gsk_2');
    expect(second.keyId).toBe(first.keyId);
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', path: `/api/keys/${first.keyId}`, body: { key: 'gsk_2', enabled: true } });
  });

  it('replaces the rejected key when told which one', async () => {
    const { calls, sink } = fakeServer([{ id: 7, platform: 'groq', label: 'mine', baseUrl: null, maskedKey: 'x' }]);
    const res = await sink.save(groq, 'gsk_3', 7);
    expect(res.keyId).toBe(7);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/keys')).toBe(false);
  });

  it('registers custom endpoints with discovered models', async () => {
    const { calls, sink } = fakeServer([]);
    await sink.save(samba, 'sk-1');
    const reg = calls.find((c) => c.path === '/api/keys/custom');
    expect(reg?.body).toMatchObject({ baseUrl: 'https://api.sambanova.ai/v1', apiKey: 'sk-1', models: ['m1', 'm2'], label: HARVEST_LABEL });
  });
});

describe('wrapRecipeScript', () => {
  it('produces a script that resolves to {ok,value} or {ok:false,error}', async () => {
    // Evaluate in Node with a minimal DOM-less shim: helpers are only defined,
    // not used, by these bodies.
    const g = globalThis as any;
    const run = (src: string) => (0, eval)(src) as Promise<any>;
    g.document = { cookie: '', addEventListener() {} };
    expect(await run(wrapRecipeScript('return args.x + 1;', { x: 1 }))).toEqual({ ok: true, value: 2 });
    expect(await run(wrapRecipeScript('throw new Error("nope");'))).toEqual({ ok: false, error: 'nope' });
    expect(await run(wrapRecipeScript('return h.keyName;'))).toMatchObject({ ok: true, value: expect.stringMatching(/^freellmapi-\d{8}-\d{4}$/) });
    delete g.document;
  });
});

describe('verified recipes', () => {
  it('ship syntactically valid page scripts', () => {
    for (const r of BUNDLED_RECIPES) {
      if (r.createKey) expect(() => new Function(`return ${wrapRecipeScript(r.createKey!)}`), r.id).not.toThrow();
      if (r.signedInScript) expect(() => new Function(`return (${r.signedInScript})`), r.id).not.toThrow();
    }
  });

  it('mark Cloudflare and GitHub as automatic and verified', () => {
    const cf = BUNDLED_RECIPES.find((r) => r.id === 'cloudflare')!;
    const gh = BUNDLED_RECIPES.find((r) => r.id === 'github')!;
    expect(cf.mode).toBe('auto');
    expect(cf.verified).toBe(true);
    expect(gh.mode).toBe('auto');
    expect(gh.localSource).toBe('gh-cli');
  });

  it('never accepts localSource from a user recipe file', () => {
    const r = parseRecipe({ id: 'github', target: { kind: 'platform', platform: 'github' }, keysUrl: 'https://github.com/x', localSource: 'gh-cli' });
    expect('recipe' in r && r.recipe.localSource).toBeFalsy();
  });
});

describe('pickCapturedKey', async () => {
  const { pickCapturedKey, DEFAULT_SIGNED_IN_SCRIPT } = await import('../harvester/capture.js');
  const groq = /gsk_[A-Za-z0-9]{40,}/;
  const key = 'gsk_' + 'a'.repeat(48);

  it('prefers a copied key, and extracts it from surrounding text', () => {
    expect(pickCapturedKey(key, null, groq)).toBe(key);
    expect(pickCapturedKey(`export GROQ_API_KEY=${key}`, null, groq)).toBe(key);
  });

  it('falls back to a key visible on the page', () => {
    expect(pickCapturedKey('me@example.com', key, groq)).toBe(key);
  });

  it('without a provider pattern only trusts a key-shaped copy', () => {
    expect(pickCapturedKey('sk-abcdefghijklmnopqrstuvwxyz012345', null, null)).toBe('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(pickCapturedKey('me@example.com', null, null)).toBeNull();
    expect(pickCapturedKey('https://example.com/a-long-link-here', null, null)).toBeNull();
    expect(pickCapturedKey('two words here and there and more', null, null)).toBeNull();
    expect(pickCapturedKey('', 'whatever', null)).toBeNull();
  });

  it('ships a parseable default signed-in check', () => {
    expect(() => new Function(`return ${DEFAULT_SIGNED_IN_SCRIPT}`)).not.toThrow();
  });
});
