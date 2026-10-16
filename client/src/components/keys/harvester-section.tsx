import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen, KeyRound, LogIn, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ConfirmButton } from '@/components/confirm-button'
import { toast } from '@/lib/toast'
import { useI18n } from '@/i18n'
import { useHarvesterRecipes, type HarvestRecipe, type HarvestRunResult, type HarvesterBridge } from '@/lib/desktop-harvester'

/**
 * Key Harvester (desktop only). Each provider gets its own browser session in
 * the app: sign in once, then keys are created in a hidden window and saved to
 * the Providers list. When a stored key is rejected, a replacement is fetched
 * automatically.
 */
export function HarvesterSection() {
  const { t } = useI18n()
  const { bridge, recipes } = useHarvesterRecipes()
  const [filter, setFilter] = useState('')
  const [credFor, setCredFor] = useState<HarvestRecipe | null>(null)

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = recipes ?? []
    const order = { auto: 0, keyless: 1, manual: 2 } as const
    return list
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.id.includes(q))
      .sort((a, b) => order[a.mode] - order[b.mode] || a.name.localeCompare(b.name))
  }, [recipes, filter])

  if (!bridge) return null

  const counts = {
    auto: recipes?.filter(r => r.mode === 'auto').length ?? 0,
    signedIn: recipes?.filter(r => r.state.signedInAt).length ?? 0,
    total: recipes?.length ?? 0,
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="size-3.5 text-muted-foreground" />
              {t('harvester.title')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{t('harvester.description')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('harvester.summary', { auto: counts.auto, signedIn: counts.signedIn, total: counts.total })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void bridge.harvestAll()} disabled={counts.auto === 0}>
              <RefreshCw className="size-3.5" />
              {t('harvester.harvestAll')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await bridge.reloadRecipes()
                if (res.errors.length) toast.error(res.errors.join('\n'))
                else toast.success(t('harvester.reloaded', { count: res.loaded }))
              }}
            >
              {t('harvester.reloadRecipes')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void bridge.openRecipesFolder()}>
              <FolderOpen className="size-3.5" />
              {t('harvester.openFolder')}
            </Button>
          </div>
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('harvester.search')} className="pl-8 h-8" />
        </div>
      </div>

      {recipes === null ? (
        <p className="text-sm text-muted-foreground">{t('harvester.loading')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map(r => (
            <RecipeRow key={r.id} recipe={r} bridge={bridge} onCredentials={() => setCredFor(r)} />
          ))}
        </ul>
      )}

      {credFor && (
        <CredentialsDialog recipe={credFor} bridge={bridge} onClose={() => setCredFor(null)} />
      )}
    </section>
  )
}

function RecipeRow({ recipe: r, bridge, onCredentials }: { recipe: HarvestRecipe; bridge: HarvesterBridge; onCredentials: () => void }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'login' | 'harvest' | null>(null)
  const note = r.note ? (locale.startsWith('tr') ? r.note.tr : r.note.en) : ''
  const working = r.running || r.queued || busy !== null

  const afterRun = (res: HarvestRunResult | null) => {
    queryClient.invalidateQueries({ queryKey: ['keys'] })
    queryClient.invalidateQueries({ queryKey: ['health'] })
    if (!res) return
    if (res.status === 'ok') toast.success(t('harvester.harvested', { name: r.name, masked: res.masked }))
    else if (res.status === 'login_required') toast.error(t('harvester.needsLogin', { name: r.name }))
    else toast.error(`${r.name}: ${res.message}`)
  }

  const run = async (kind: 'login' | 'harvest') => {
    setBusy(kind)
    try {
      if (kind === 'login') {
        const res = await bridge.login(r.id)
        if (res === null) toast.success(t('harvester.signedIn', { name: r.name }))
        else afterRun(res)
      } else {
        afterRun(await bridge.harvest(r.id))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="rounded-2xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{r.name}</span>
            <Badge variant={r.mode === 'auto' ? 'default' : r.mode === 'keyless' ? 'secondary' : 'outline'}>
              {t(`harvester.mode.${r.mode}`)}
            </Badge>
            {r.mode === 'auto' && !r.verified && <Badge variant="outline">{t('harvester.unverified')}</Badge>}
            {r.source === 'user' && <Badge variant="outline">{t('harvester.userRecipe')}</Badge>}
            {r.target.kind === 'custom' && <Badge variant="ghost">{t('harvester.customEndpoint')}</Badge>}
          </div>
          <StatusLine recipe={r} />
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {r.mode === 'manual' && <p className="text-xs text-muted-foreground">{t('harvester.manualHint')}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {r.mode === 'auto' && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
              <Switch
                size="sm"
                checked={r.state.autoRefresh !== false}
                onCheckedChange={(on: boolean) => void bridge.setAutoRefresh(r.id, on)}
              />
              {t('harvester.autoRefresh')}
            </label>
          )}
          {r.mode !== 'keyless' && !r.localSource && (
            <>
              <Button size="xs" variant="ghost" onClick={onCredentials}>
                {r.hasCredentials ? t('harvester.passwordSaved') : t('harvester.savePassword')}
              </Button>
              <Button size="xs" variant="outline" onClick={() => void run('login')} disabled={working}>
                <LogIn className="size-3" />
                {busy === 'login' ? t('harvester.waitingLogin') : t('harvester.login')}
              </Button>
            </>
          )}
          {r.mode !== 'manual' && (
            <Button size="xs" onClick={() => void run('harvest')} disabled={working}>
              {r.running || busy === 'harvest'
                ? t('harvester.working')
                : r.queued
                  ? t('harvester.queued')
                  : r.mode === 'keyless'
                    ? t('harvester.enable')
                    : t('harvester.harvest')}
            </Button>
          )}
          {r.state.signedInAt && r.mode !== 'keyless' && !r.localSource && (
            <ConfirmButton onConfirm={() => void bridge.logout(r.id)} title={t('harvester.logout')}>
              {t('harvester.logout')}
            </ConfirmButton>
          )}
        </div>
      </div>
    </li>
  )
}

function StatusLine({ recipe: r }: { recipe: HarvestRecipe }) {
  const { t, locale } = useI18n()
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale) : '')
  const last = r.state.lastRun
  const parts: { text: string; tone: 'muted' | 'ok' | 'warn' }[] = []
  if (r.mode !== 'keyless' && !r.localSource) {
    parts.push(r.state.signedInAt
      ? { text: t('harvester.sessionOpen', { at: fmt(r.state.signedInAt) }), tone: 'ok' }
      : { text: t('harvester.sessionNone'), tone: 'muted' })
  }
  if (last?.status === 'ok') parts.push({ text: t('harvester.lastOk', { masked: last.masked, at: fmt(last.at) }), tone: 'ok' })
  else if (last?.status === 'login_required') parts.push({ text: t('harvester.lastLogin', { at: fmt(last.at) }), tone: 'warn' })
  else if (last?.status === 'error') parts.push({ text: t('harvester.lastError', { message: last.message, at: fmt(last.at) }), tone: 'warn' })
  if (r.hasCredentials && r.credentialEmail) parts.push({ text: r.credentialEmail, tone: 'muted' })

  return (
    <p className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
      {parts.map((p, i) => (
        <span
          key={i}
          className={p.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : p.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
        >
          {p.text}
        </span>
      ))}
    </p>
  )
}

function CredentialsDialog({ recipe, bridge, onClose }: { recipe: HarvestRecipe; bridge: HarvesterBridge; onClose: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState(recipe.credentialEmail ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await bridge.setCredentials(recipe.id, email, password)
      toast.success(t('harvester.passwordStored', { name: recipe.name }))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogPopup>
        <DialogTitle>{t('harvester.credTitle', { name: recipe.name })}</DialogTitle>
        <DialogDescription className="mt-1">{t('harvester.credDescription')}</DialogDescription>
        {!recipe.supportsAutoLogin && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('harvester.credNoSteps')}</p>
        )}
        <form
          className="mt-4 space-y-3"
          onSubmit={e => { e.preventDefault(); void save() }}
        >
          <div className="space-y-1">
            <Label htmlFor="harvest-email">{t('harvester.email')}</Label>
            <Input id="harvest-email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="harvest-password">{t('harvester.password')}</Label>
            <Input id="harvest-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div className="flex justify-between gap-2 pt-2">
            {recipe.hasCredentials ? (
              <ConfirmButton
                variant="outline"
                size="sm"
                onConfirm={async () => { await bridge.clearCredentials(recipe.id); onClose() }}
              >
                {t('harvester.deletePassword')}
              </ConfirmButton>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('harvester.cancel')}</Button>
              <Button type="submit" size="sm" disabled={saving || !email || !password}>{t('harvester.save')}</Button>
            </div>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
