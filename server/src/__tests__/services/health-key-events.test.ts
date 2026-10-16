import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../lib/crypto.js';
import { getDb, initDb } from '../../db/index.js';
import { clearKeyInvalidListeners, onKeyInvalid, type KeyInvalidEvent } from '../../lib/key-events.js';

const validateKey = vi.hoisted(() => vi.fn());

vi.mock('../../providers/index.js', () => ({
  resolveProvider: () => ({
    name: 'Groq',
    validateKey,
  }),
}));

const { checkKeyHealth } = await import('../../services/health.js');

describe('invalid-key events', () => {
  let nextId = 7000;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    validateKey.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    clearKeyInvalidListeners();
    vi.restoreAllMocks();
  });

  function seedKey(label = 'harvester'): number {
    const id = ++nextId;
    const enc = encrypt('gsk_test_key');
    getDb().prepare(`
      INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, enabled, status)
      VALUES (?, 'groq', ?, ?, ?, ?, 1, 'unknown')
    `).run(id, label, enc.encrypted, enc.iv, enc.authTag);
    return id;
  }

  it('emits once per confirmed rejection with platform and label', async () => {
    const id = seedKey('Toplayıcı');
    const events: KeyInvalidEvent[] = [];
    onKeyInvalid((e) => events.push(e));
    validateKey.mockResolvedValue({ valid: false, error: 'HTTP 401: invalid api key' });

    await checkKeyHealth(id);

    expect(events).toEqual([
      { keyId: id, platform: 'groq', label: 'Toplayıcı', reason: 'HTTP 401: invalid api key', autoDisabled: false },
    ]);
  });

  it('flags autoDisabled on the third consecutive rejection', async () => {
    const id = seedKey();
    const events: KeyInvalidEvent[] = [];
    onKeyInvalid((e) => events.push(e));
    validateKey.mockResolvedValue(false);

    await checkKeyHealth(id);
    await checkKeyHealth(id);
    await checkKeyHealth(id);

    expect(events.map((e) => e.autoDisabled)).toEqual([false, false, true]);
  });

  it('does not emit for a healthy key or a transport error', async () => {
    const id = seedKey();
    const listener = vi.fn();
    onKeyInvalid(listener);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    validateKey.mockResolvedValue(true);
    await checkKeyHealth(id);
    validateKey.mockRejectedValue(new Error('ECONNRESET'));
    await checkKeyHealth(id);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the health check working when a listener throws', async () => {
    const id = seedKey();
    onKeyInvalid(() => { throw new Error('boom'); });
    validateKey.mockResolvedValue(false);

    await expect(checkKeyHealth(id)).resolves.toBe('invalid');
  });
});
