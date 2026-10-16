import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { isCatalogSyncEnabled, syncCatalog } from '../../services/catalog-sync.js';
import { mintDashboardToken } from '../helpers/auth.js';

// Api Manager fork: /api/catalog replaces the upstream /api/premium routes and
// carries the Settings switch for the network catalog sync.
let dashToken = '';

async function request(app: Express, method: string, path: string, body?: unknown, auth = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${dashToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('catalog sync API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getDb().prepare("DELETE FROM settings WHERE key = 'catalog_sync_enabled'").run();
    delete process.env.CATALOG_SYNC_DISABLED;
  });

  it('requires a dashboard session', async () => {
    const { status } = await request(app, 'GET', '/api/catalog', undefined, false);
    expect(status).toBe(401);
  });

  it('reports the sync as enabled by default', async () => {
    const { status, body } = await request(app, 'GET', '/api/catalog');
    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.lockedOff).toBe(false);
  });

  it('turns the sync off and on, and a turned-off sync makes no network call', async () => {
    const off = await request(app, 'PUT', '/api/catalog', { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect(isCatalogSyncEnabled()).toBe(false);

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await syncCatalog(true);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/turned off/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();

    const on = await request(app, 'PUT', '/api/catalog', { enabled: true });
    expect(on.body.enabled).toBe(true);
    expect(isCatalogSyncEnabled()).toBe(true);
  });

  it('rejects a non-boolean enabled value', async () => {
    const { status } = await request(app, 'PUT', '/api/catalog', { enabled: 'no' });
    expect(status).toBe(400);
  });

  it('CATALOG_SYNC_DISABLED=1 wins over the setting', async () => {
    process.env.CATALOG_SYNC_DISABLED = '1';
    const { body } = await request(app, 'GET', '/api/catalog');
    expect(body.enabled).toBe(false);
    expect(body.lockedOff).toBe(true);
  });

  it('no longer serves the upstream Premium routes', async () => {
    const { status } = await request(app, 'GET', '/api/premium');
    expect(status).toBe(404);
  });
});
