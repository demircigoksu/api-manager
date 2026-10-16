import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Cpu, RefreshCw, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { localBridge, type LocalBridge, type LocalCli, type ServerScan } from '@/lib/desktop-local'

export function LocalSection() {
  const bridge = localBridge()
  if (!bridge) return null
  return (
    <div className="space-y-6">
      <ServersPanel bridge={bridge} />
      <ClisPanel bridge={bridge} />
    </div>
  )
}

function ServersPanel({ bridge }: { bridge: LocalBridge }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [scan, setScan] = useState<ServerScan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    bridge.servers()
      .then(r => { if (active) setScan(r) })
      .catch(err => toast.error(String(err?.message ?? err)))
    return () => { active = false }
  }, [bridge, nonce])
  const refresh = useCallback(() => { setScan(null); setNonce(n => n + 1) }, [])

  return (
    <section className="rounded-3xl border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Cpu className="size-3.5 text-muted-foreground" />
            {t('local.serversTitle')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t('local.serversDescription')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="size-3.5" />
          {t('local.rescan')}
        </Button>
      </div>
      {scan === null ? (
        <p className="text-sm text-muted-foreground">{t('local.scanning')}</p>
      ) : scan.servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('local.noServers', { list: scan.scanned.map(s => `${s.name} (${s.port})`).join(', ') })}
        </p>
      ) : (
        <ul className="space-y-2">
          {scan.servers.map(s => (
            <li key={s.baseUrl} className="rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <code className="text-xs text-muted-foreground">{s.baseUrl}</code>
                  {s.registered && <Badge variant="secondary">{t('local.added')}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 break-all">
                  {s.models.length ? t('local.models', { count: s.models.length, list: s.models.slice(0, 6).join(', ') }) : t('local.noModels')}
                </p>
              </div>
              {!s.registered && (
                <Button
                  size="xs"
                  disabled={busy !== null || s.models.length === 0}
                  onClick={async () => {
                    setBusy(s.baseUrl)
                    try {
                      await bridge.registerServer(s.baseUrl, s.name)
                      toast.success(t('local.addedToast', { name: s.name }))
                      queryClient.invalidateQueries({ queryKey: ['keys'] })
                      refresh()
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  {t('local.addToRouter')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ClisPanel({ bridge }: { bridge: LocalBridge }) {
  const { t } = useI18n()
  const [clis, setClis] = useState<LocalCli[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    bridge.clis()
      .then(r => { if (active) setClis(r) })
      .catch(err => toast.error(String(err?.message ?? err)))
    return () => { active = false }
  }, [bridge, nonce])
  const refresh = useCallback(() => { setClis(null); setNonce(n => n + 1) }, [])

  const installed = (clis ?? []).filter(c => c.installed)
  const missing = (clis ?? []).filter(c => !c.installed)

  return (
    <section className="rounded-3xl border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Terminal className="size-3.5 text-muted-foreground" />
            {t('local.clisTitle')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t('local.clisDescription')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="size-3.5" />
          {t('local.rescan')}
        </Button>
      </div>
      {clis === null ? (
        <p className="text-sm text-muted-foreground">{t('local.scanning')}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {installed.map(c => (
              <li key={c.id} className="rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.version && <span className="text-xs text-muted-foreground">v{c.version}</span>}
                    <Badge variant="outline">{t(`local.role.${c.role}`)}</Badge>
                    {c.routed === 'routed' && <Badge variant="secondary">{t('local.routed')}</Badge>}
                    {c.routed && c.routed !== 'routed' && c.routed !== 'unknown' && <Badge variant="outline">{t('local.notRouted')}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 break-all">{c.path}</p>
                </div>
                {c.canConnect && (
                  <Button
                    size="xs"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(c.id)
                      try {
                        const res = await bridge.connectCli(c.id)
                        const backups = res.files.filter(f => f.backupPath).length
                        toast.success(t('local.connected', { name: c.name, files: res.files.length, backups }))
                        refresh()
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err))
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    {c.routed === 'routed' ? t('local.reconnect') : t('local.connect')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('local.notInstalled', { list: missing.map(c => c.name).join(', ') })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
