// Mirrors desktop/src/local/index.ts. Desktop only.
export interface LocalServer { id: string; name: string; baseUrl: string; models: string[]; registered: boolean }
export interface ServerScan { scanned: { name: string; port: number }[]; servers: LocalServer[] }
export interface LocalCli {
  id: string
  name: string
  role: 'agent' | 'runtime' | 'token'
  installed: boolean
  path: string | null
  version: string | null
  canConnect: boolean
  routed: string | null
}
export interface LocalBridge {
  servers: () => Promise<ServerScan>
  registerServer: (baseUrl: string, name: string) => Promise<unknown>
  clis: () => Promise<LocalCli[]>
  connectCli: (id: string) => Promise<{ files: { path: string; backupPath: string | null }[]; notes: string[] }>
}

export function localBridge(): LocalBridge | null {
  if (typeof window === 'undefined') return null
  return (window as { __FREEAPI_LOCAL__?: LocalBridge }).__FREEAPI_LOCAL__ ?? null
}

