import fs from 'node:fs';
import path from 'node:path';

// Pure discovery helpers for the "Local" tab: LLM servers listening on this
// machine and AI command-line tools on PATH. No Electron imports, so they stay
// unit-testable.

export interface LocalServerDef {
  id: string;
  name: string;
  port: number;
}

/** Default ports of the common local OpenAI-compatible servers. */
export const LOCAL_SERVERS: LocalServerDef[] = [
  { id: 'ollama', name: 'Ollama', port: 11434 },
  { id: 'lmstudio', name: 'LM Studio', port: 1234 },
  { id: 'llamacpp', name: 'llama.cpp / LocalAI', port: 8080 },
  { id: 'vllm', name: 'vLLM', port: 8000 },
  { id: 'jan', name: 'Jan', port: 1337 },
  { id: 'gpt4all', name: 'GPT4All', port: 4891 },
  { id: 'koboldcpp', name: 'KoboldCpp', port: 5001 },
  { id: 'textgen', name: 'text-generation-webui', port: 5000 },
];

export interface LocalServer {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

/** Probes one server's /v1/models. Resolves to null when nothing usable answers. */
export async function probeServer(
  def: LocalServerDef,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<LocalServer | null> {
  const baseUrl = `http://127.0.0.1:${def.port}/v1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/models`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: unknown }[]; models?: { id?: unknown; name?: unknown }[] };
    const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
    if (!list) return null;
    const models = list
      .map((m) => (typeof m?.id === 'string' ? m.id : typeof (m as any)?.name === 'string' ? (m as any).name : ''))
      .filter((id): id is string => id.length > 0);
    return { id: def.id, name: def.name, baseUrl, models };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CliDef {
  id: string;
  name: string;
  /** Executable names to look for on PATH (without extension). */
  bins: string[];
  /** Upstream `freellmapi setup-*` generator id, when the tool can be pointed at the router. */
  setupTool?: string;
  /** What the tool is to this app. */
  role: 'agent' | 'runtime' | 'token';
}

export const LOCAL_CLIS: CliDef[] = [
  { id: 'claude', name: 'Claude Code', bins: ['claude'], setupTool: 'claude', role: 'agent' },
  { id: 'codex', name: 'Codex CLI', bins: ['codex'], setupTool: 'codex', role: 'agent' },
  { id: 'qwen', name: 'Qwen Code', bins: ['qwen'], setupTool: 'qwen', role: 'agent' },
  { id: 'opencode', name: 'OpenCode', bins: ['opencode'], setupTool: 'opencode', role: 'agent' },
  { id: 'aider', name: 'Aider', bins: ['aider'], setupTool: 'aider', role: 'agent' },
  { id: 'goose', name: 'Goose', bins: ['goose'], setupTool: 'goose', role: 'agent' },
  { id: 'crush', name: 'Crush', bins: ['crush'], setupTool: 'crush', role: 'agent' },
  { id: 'gemini', name: 'Gemini CLI', bins: ['gemini'], role: 'agent' },
  { id: 'ollama', name: 'Ollama', bins: ['ollama'], role: 'runtime' },
  { id: 'lms', name: 'LM Studio CLI', bins: ['lms'], role: 'runtime' },
  { id: 'llamacpp', name: 'llama.cpp server', bins: ['llama-server'], role: 'runtime' },
  { id: 'gh', name: 'GitHub CLI', bins: ['gh'], role: 'token' },
  { id: 'hf', name: 'Hugging Face CLI', bins: ['hf', 'huggingface-cli'], role: 'token' },
];

/** First match of `bins` on PATH, honouring PATHEXT on Windows. */
export function findOnPath(
  bins: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = (p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  },
): string | null {
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  const exts = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
    : [''];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const bin of bins) {
      for (const ext of exts) {
        const candidate = join(dir, bin + ext);
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** "codex-cli 0.48.0" → "0.48.0"; keeps the first version-looking token. */
export function parseVersion(output: string): string | null {
  const m = output.match(/\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.]+)?/);
  return m ? m[0] : null;
}
