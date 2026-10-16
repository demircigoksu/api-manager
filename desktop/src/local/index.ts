import os from 'node:os';
import { execFile } from 'node:child_process';
import { ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { getTool } from '../../../cli/src/tools.js';
import { applyGeneratedFiles } from '../../../cli/src/config-files.js';
import { diagnose, DOCTOR_TOOLS } from '../../../cli/src/doctor.js';
import type { CatalogModel } from '../../../cli/src/types.js';
import { LOCAL_CLIS, LOCAL_SERVERS, findOnPath, parseVersion, probeServer } from './scan.js';

// "Local" tab: LLM servers running on this machine (Ollama, LM Studio, …) and
// AI command-line tools on PATH. Servers can be added to the router as custom
// endpoints; agent CLIs can be pointed at the router with the same config
// generators as `npx freellmapi setup-<tool>` (existing files are backed up).

export interface LocalDeps {
  port: () => number;
  token: () => string;
  unifiedKey: () => string;
}

const LOCAL_GROUP = 'Yerel';

async function api<T>(deps: LocalDeps, method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${deps.port()}${p}`, {
    method,
    headers: { Authorization: `Bearer ${deps.token()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase().replace('localhost', '127.0.0.1');

export async function scanServers(deps: LocalDeps) {
  const found = (await Promise.all(LOCAL_SERVERS.map((d) => probeServer(d)))).filter((s): s is NonNullable<typeof s> => s !== null);
  // The same port can answer for two entries (llama.cpp and LocalAI share 8080).
  const unique = found.filter((s, i) => found.findIndex((o) => o.baseUrl === s.baseUrl) === i);
  const keys = await api<{ id: number; platform: string; baseUrl: string | null }[]>(deps, 'GET', '/api/keys').catch(() => []);
  const registered = new Set(keys.filter((k) => k.platform === 'custom' && k.baseUrl).map((k) => norm(k.baseUrl!)));
  return {
    scanned: LOCAL_SERVERS.map((d) => ({ name: d.name, port: d.port })),
    servers: unique.map((s) => ({ ...s, registered: registered.has(norm(s.baseUrl)) })),
  };
}

export async function registerServer(deps: LocalDeps, baseUrl: unknown, name: unknown) {
  if (typeof baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{2,5}\/v1$/.test(baseUrl)) throw new Error('Invalid local server');
  const server = (await scanServers(deps)).servers.find((s) => s.baseUrl === baseUrl);
  if (!server) throw new Error('The server no longer answers');
  if (server.models.length === 0) throw new Error('The server lists no models; load a model first');
  return api(deps, 'POST', '/api/keys/custom', {
    baseUrl,
    models: server.models.slice(0, 100),
    label: typeof name === 'string' && name ? name : server.name,
    groupLabel: LOCAL_GROUP,
  });
}

function version(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const isScript = /\.(cmd|bat)$/i.test(bin);
    execFile(isScript ? `"${bin}"` : bin, ['--version'], { timeout: 6000, windowsHide: true, shell: isScript }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve(null);
      resolve(parseVersion(`${stdout}\n${stderr}`));
    });
  });
}

export async function scanClis(deps: LocalDeps) {
  const gateway = `http://127.0.0.1:${deps.port()}`;
  return Promise.all(LOCAL_CLIS.map(async (c) => {
    const bin = findOnPath(c.bins);
    let routed: string | null = null;
    if (bin && c.setupTool && DOCTOR_TOOLS.includes(c.setupTool)) {
      try {
        routed = (await diagnose(c.setupTool, { expectedUrl: gateway, timeoutMs: 2000 })).verdict;
      } catch {
        routed = null;
      }
    }
    return {
      id: c.id,
      name: c.name,
      role: c.role,
      installed: Boolean(bin),
      path: bin,
      version: bin ? await version(bin) : null,
      canConnect: Boolean(bin && c.setupTool),
      routed,
    };
  }));
}

export async function connectCli(deps: LocalDeps, id: unknown) {
  const def = LOCAL_CLIS.find((c) => c.id === id);
  if (!def?.setupTool) throw new Error('This tool cannot be connected automatically');
  const tool = getTool(def.setupTool);
  if (!tool) throw new Error('Unknown tool');
  const key = deps.unifiedKey();
  const modelsRes = await fetch(`http://127.0.0.1:${deps.port()}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
  const models = ((await modelsRes.json()) as { data?: CatalogModel[] }).data ?? [];
  const generation = tool.generate({
    url: `http://127.0.0.1:${deps.port()}`,
    apiKey: key,
    profile: 'default',
    models,
    homeDir: os.homedir(),
  });
  const results = applyGeneratedFiles(generation.files, false);
  return {
    files: results.map((r: any) => ({ path: r.path, backupPath: r.backupPath ?? null })),
    notes: generation.notes,
  };
}

export function registerLocalIpc(deps: LocalDeps): void {
  const guard = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    if (e.sender.session !== session.defaultSession || !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw new Error('Not allowed');
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(`freeapi:local:${channel}`, async (e, ...args) => {
      guard(e);
      return fn(...args);
    });
  };
  handle('servers', () => scanServers(deps));
  handle('register-server', (baseUrl: unknown, name: unknown) => registerServer(deps, baseUrl, name));
  handle('clis', () => scanClis(deps));
  handle('connect-cli', (id: unknown) => connectCli(deps, id));
}
