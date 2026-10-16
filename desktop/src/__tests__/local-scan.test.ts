import { describe, expect, it } from 'vitest';
import { findOnPath, parseVersion, probeServer, LOCAL_CLIS } from '../local/scan.js';

describe('findOnPath', () => {
  it('honours PATHEXT on Windows', () => {
    const files = new Set(['C:\\tools\\codex.cmd', 'C:\\bin\\gh.exe']);
    const env = { PATH: 'C:\\nope;C:\\tools;C:\\bin', PATHEXT: '.EXE;.CMD' };
    expect(findOnPath(['codex'], env, 'win32', (p) => files.has(p))).toBe('C:\\tools\\codex.cmd');
    expect(findOnPath(['gh'], env, 'win32', (p) => files.has(p))).toBe('C:\\bin\\gh.exe');
    expect(findOnPath(['claude'], env, 'win32', (p) => files.has(p))).toBeNull();
  });

  it('works on POSIX paths', () => {
    expect(findOnPath(['ollama'], { PATH: '/usr/bin:/usr/local/bin' }, 'linux', (p) => p === '/usr/local/bin/ollama')).toBe('/usr/local/bin/ollama');
  });
});

describe('parseVersion', () => {
  it('extracts the first version', () => {
    expect(parseVersion('codex-cli 0.48.0\n')).toBe('0.48.0');
    expect(parseVersion('gh version 2.97.0 (2026-07-31)')).toBe('2.97.0');
    expect(parseVersion('no version here')).toBeNull();
  });
});

describe('probeServer', () => {
  const def = { id: 'ollama', name: 'Ollama', port: 11434 };
  it('reads OpenAI and Ollama-style model lists', async () => {
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    expect(await probeServer(def, ok({ data: [{ id: 'llama3.2:3b' }, { id: 'qwen3:8b' }] }))).toEqual({
      id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['llama3.2:3b', 'qwen3:8b'],
    });
    expect((await probeServer(def, ok({ models: [{ name: 'phi4' }] })))?.models).toEqual(['phi4']);
  });

  it('returns null for errors, non-JSON and refused connections', async () => {
    expect(await probeServer(def, (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await probeServer(def, (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toBeNull();
    expect(await probeServer(def, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('LOCAL_CLIS', () => {
  it('only offers connect for tools the setup generators know', async () => {
    const { getTool } = await import('../../../cli/src/tools.js');
    for (const c of LOCAL_CLIS) if (c.setupTool) expect(getTool(c.setupTool), c.id).toBeTruthy();
  });
});
