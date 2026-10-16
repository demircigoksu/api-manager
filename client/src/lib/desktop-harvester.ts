import { useCallback, useEffect, useState } from 'react'

// Mirrors desktop/src/harvester/types.ts (RecipeView, RunResult). The bridge
// only exists in the desktop app; in a browser the Key Harvester tab is hidden.

export type HarvestRunResult =
  | { status: 'ok'; keyId: number; masked: string; at: string }
  | { status: 'login_required'; at: string; message?: string }
  | { status: 'error'; at: string; message: string }

export interface HarvestRecipe {
  id: string
  name: string
  mode: 'auto' | 'keyless' | 'manual'
  target: { kind: 'platform'; platform: string } | { kind: 'custom'; baseUrl: string; models?: string[] }
  keysUrl: string
  verified: boolean
  source: 'bundled' | 'user'
  note?: { tr: string; en: string }
  supportsAutoLogin: boolean
  localSource?: 'gh-cli' | 'hf-cli'
  hasCredentials: boolean
  credentialEmail?: string
  running: boolean
  queued: boolean
  state: {
    lastRun?: HarvestRunResult
    signedInAt?: string
    autoRefresh?: boolean
  }
}

export interface HarvesterBridge {
  list: () => Promise<HarvestRecipe[]>
  harvest: (id: string) => Promise<HarvestRunResult>
  harvestAll: () => Promise<void>
  login: (id: string) => Promise<HarvestRunResult | null>
  check: (id: string) => Promise<HarvestRunResult | null>
  logout: (id: string) => Promise<void>
  setCredentials: (id: string, email: string, password: string) => Promise<void>
  clearCredentials: (id: string) => Promise<void>
  setAutoRefresh: (id: string, on: boolean) => Promise<void>
  reloadRecipes: () => Promise<{ loaded: number; errors: string[] }>
  openRecipesFolder: () => Promise<string>
  subscribe: (listener: () => void) => () => void
}

export function harvesterBridge(): HarvesterBridge | null {
  if (typeof window === 'undefined') return null
  return (window as { __FREEAPI_HARVESTER__?: HarvesterBridge }).__FREEAPI_HARVESTER__ ?? null
}

export function hasHarvester(): boolean {
  return harvesterBridge() !== null
}

/** Live recipe list; refreshes whenever the main process reports a change. */
export function useHarvesterRecipes() {
  const bridge = harvesterBridge()
  const [recipes, setRecipes] = useState<HarvestRecipe[] | null>(null)

  const refresh = useCallback(() => {
    if (!bridge) return
    void bridge.list().then(setRecipes).catch(() => setRecipes([]))
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    refresh()
    return bridge.subscribe(refresh)
  }, [bridge, refresh])

  return { bridge, recipes, refresh }
}
