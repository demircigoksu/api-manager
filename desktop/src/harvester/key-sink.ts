import type { Recipe } from './types.js';

// Writes harvested keys into the router through its own HTTP API on
// 127.0.0.1, with the desktop session token. Going through the API (instead
// of the database) reuses its validation, encryption, model discovery and
// cooldown resets exactly as if the key had been pasted on the Keys page.

export const HARVEST_LABEL = 'Anahtar Toplayıcı';
const MAX_DISCOVERED_MODELS = 50;

export interface SinkContext {
  port: number;
  token: () => string;
  fetchImpl?: typeof fetch;
}

interface KeyRow {
  id: number;
  platform: string;
  label: string;
  baseUrl: string | null;
  maskedKey: string;
}

export class KeySink {
  constructor(private readonly ctx: SinkContext) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.ctx.fetchImpl ?? fetch;
    const res = await f(`http://127.0.0.1:${this.ctx.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.ctx.token()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`${method} ${path}: ${msg}`);
    }
    return data as T;
  }

  async listKeys(): Promise<KeyRow[]> {
    return this.api<KeyRow[]>('GET', '/api/keys');
  }

  /** The row the harvester owns for this recipe, if any. */
  async findOwnRow(recipe: Recipe): Promise<KeyRow | undefined> {
    const rows = await this.listKeys();
    if (recipe.target.kind === 'platform') {
      const platform = recipe.target.platform;
      return rows.find((r) => r.platform === platform && r.label === HARVEST_LABEL);
    }
    const baseUrl = normaliseUrl(recipe.target.baseUrl);
    return rows.find((r) => r.platform === 'custom' && r.baseUrl && normaliseUrl(r.baseUrl) === baseUrl && r.label === HARVEST_LABEL);
  }

  /**
   * Stores `key`. `replaceKeyId` (an invalid key being replaced) wins; then the
   * harvester's own row for this provider; otherwise a new row is created.
   * Returns the id of the row and its masked key, then asks for a health check.
   */
  async save(recipe: Recipe, key: string, replaceKeyId?: number): Promise<{ keyId: number; masked: string }> {
    const targetId = replaceKeyId ?? (await this.findOwnRow(recipe))?.id;
    let keyId: number;
    if (targetId !== undefined) {
      await this.api('PATCH', `/api/keys/${targetId}`, { key, enabled: true });
      keyId = targetId;
    } else if (recipe.target.kind === 'platform') {
      const created = await this.api<{ id: number }>('POST', '/api/keys', {
        platform: recipe.target.platform,
        key,
        label: HARVEST_LABEL,
      });
      keyId = Number(created.id);
    } else {
      let models = recipe.target.models;
      if (!models || models.length === 0) {
        const discovered = await this.api<{ models: { id: string }[] }>('POST', '/api/keys/custom/discover-models', {
          baseUrl: recipe.target.baseUrl,
          apiKey: key,
        });
        models = discovered.models.map((m) => m.id).slice(0, MAX_DISCOVERED_MODELS);
        if (models.length === 0) throw new Error('The endpoint returned no models');
      }
      const created = await this.api<{ keyId: number }>('POST', '/api/keys/custom', {
        baseUrl: recipe.target.baseUrl,
        apiKey: key,
        models,
        label: HARVEST_LABEL,
        groupLabel: recipe.target.groupLabel ?? HARVEST_LABEL,
      });
      keyId = Number(created.keyId);
    }
    if (!Number.isInteger(keyId) || keyId <= 0) throw new Error('The router did not return a key id');

    // Fire the health check but do not fail the harvest on its outcome: the
    // dashboard shows the verdict, and a provider that rate-limits validation
    // would otherwise turn a good key into an error here.
    void this.api('POST', `/api/health/check/${keyId}`).catch(() => {});
    const row = (await this.listKeys()).find((r) => r.id === keyId);
    return { keyId, masked: row?.maskedKey ?? '****' };
  }

  /** Enables a provider that works without a key. */
  async enableKeyless(platform: string): Promise<{ keyId: number; masked: string }> {
    const created = await this.api<{ id: number; maskedKey?: string }>('POST', '/api/keys', { platform, label: HARVEST_LABEL });
    return { keyId: Number(created.id), masked: created.maskedKey ?? 'no-key' };
  }
}

function normaliseUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase();
}
