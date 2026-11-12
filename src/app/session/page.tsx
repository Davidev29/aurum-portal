'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useSearchParam } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { BootLoader } from '@/components/session/boot-loader'
import { RoboticActivity } from '@/components/session/robotic-activity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SessionStatusBadge } from '@/components/status-badges'
import { SESSION_CHROME_FOOTER_HEIGHT, SESSION_CHROME_HEIGHT } from '@shared/constants'

export default function SessionPage() {
  const sessionId = useSearchParam('sessionId')
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => aurumBitPortal().sessions.details(sessionId as string),
    enabled: Boolean(sessionId),
    refetchInterval: 1_500,
  })

  const [url, setUrl] = React.useState('')
  const [editingUrl, setEditingUrl] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [manualOpen, setManualOpen] = React.useState(false)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [credentialExpiresAt, setCredentialExpiresAt] = React.useState<number | null>(null)
  const [loadingCredential, setLoadingCredential] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!editingUrl && data?.url) setUrl(data.url)
  }, [data?.url, editingUrl])

  React.useEffect(() => {
    if (data?.zoomFactor) setZoom(data.zoomFactor)
  }, [data?.zoomFactor])

  React.useEffect(() => {
    if (!credentialExpiresAt) return
    const tick = () => {
      if (Date.now() >= credentialExpiresAt) {
        setUsername('')
        setPassword('')
        setCredentialExpiresAt(null)
        setManualOpen(false)
      }
    }
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [credentialExpiresAt])

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action()
      if (message) toast.success(message)
      await refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const navigate = async () => {
    if (!sessionId || !url.trim()) return
    setBusy(true)
    try {
      await aurumBitPortal().sessions.navigate(sessionId, url.trim())
      setEditingUrl(false)
      await refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const loadCredential = async () => {
    if (!sessionId || !data?.credentialId) return
    if (manualOpen && credentialExpiresAt) {
      setManualOpen(false)
      return
    }
    setLoadingCredential(true)
    try {
      const user = await aurumBitPortal().sessions.getCredentialForManual(
        sessionId,
        data.credentialId,
        'username',
      )
      const secret = await aurumBitPortal().sessions.getCredentialForManual(
        sessionId,
        data.credentialId,
        'password',
      )
      setUsername(user.value)
      setPassword(secret.value)
      setShowPassword(false)
      setCredentialExpiresAt(new Date(secret.expiresAt).getTime())
      setManualOpen(true)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoadingCredential(false)
    }
  }

  const copyManual = async (value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Valor copiado. A área de transferência é local a esta sessão.')
    } catch {
      toast.error('Não foi possível acessar a área de transferência.')
    }
  }

  const changeZoom = async (factor: number) => {
    if (!sessionId) return
    setZoom(factor)
    await run(() => aurumBitPortal().sessions.setZoom(sessionId, factor))
  }

  if (!sessionId) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-[var(--pv-muted)]">
        Sessão não informada.
      </div>
    )
  }

  // Sessao por certificado: o portal pode estar invisivel (boot em andamento).
  // Enquanto isso, a area <main> exibe uma tela de carregamento opaca —
  // nenhuma tela do portal e visivel ate a autenticacao terminar.
  const portalHidden = data ? !data.portalVisible : true
  const awaitingOrBooting =
    data && data.status !== 'manual' && data.status !== 'error' && data.status !== 'closed'
  const manualOrError = data && (data.status === 'manual' || data.status === 'error')
  const needsHuman = Boolean(data && data.status === 'manual' && data.requiresHumanAction)

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-[var(--pv-muted)]">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Carregando sessão...
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--pv-bg)]">
      <header
        className="flex shrink-0 flex-col border-b border-[var(--pv-border)] bg-[var(--pv-panel)]/95 shadow-sm backdrop-blur"
        style={{ height: SESSION_CHROME_HEIGHT }}
      >
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-brand-50">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{data.clientName}</span>
              <SessionStatusBadge status={data.status} />
            </div>
            <div className="truncate text-[11px] text-[var(--pv-muted)]">{data.serviceName}</div>
          </div>

          <div className="ml-3 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Voltar"
              disabled={!data.canGoBack}
              onClick={() => void run(() => aurumBitPortal().sessions.back(sessionId))}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Avancar"
              disabled={!data.canGoForward}
              onClick={() => void run(() => aurumBitPortal().sessions.forward(sessionId))}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            {data.loading ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Parar carregamento"
                onClick={() => void run(() => aurumBitPortal().sessions.stop(sessionId))}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Recarregar"
                onClick={() => void run(() => aurumBitPortal().sessions.reload(sessionId))}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {data.certificate ? (
              <Badge variant="success" className="max-w-[240px]">
                <ShieldCheck className="h-3 w-3 shrink-0" />
                <span className="truncate">{data.certificate.label}</span>
              </Badge>
            ) : (
              <Badge variant="secondary">
                <KeyRound className="h-3 w-3" />
                Senha
              </Badge>
            )}
            {data.recipeRunning ? (
              <Badge variant="warning">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Receita
              </Badge>
            ) : null}
            {data.canProvideCredentials ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadCredential()}
                disabled={loadingCredential}
              >
                {loadingCredential ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {manualOpen ? 'Ocultar credencial' : 'Credencial manual'}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              title="Reexecutar receita"
              onClick={() =>
                void run(async () => {
                  const result = await aurumBitPortal().sessions.retryRecipe(sessionId)
                  toast[result.ok ? 'success' : 'warning'](result.message)
                })
              }
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Abrir no navegador padrão"
              aria-label="Abrir no navegador padrão"
              onClick={() => void run(() => aurumBitPortal().sessions.openExternal(sessionId))}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Fechar sessão"
              aria-label="Fechar sessão"
              onClick={() => void aurumBitPortal().sessions.close(sessionId)}
            >
              <X className="h-4 w-4 text-[var(--pv-danger)]" />
            </Button>
          </div>
        </div>

        <div className="flex h-12 items-center gap-2 border-t border-[var(--pv-border)] px-3">
          {manualOpen ? (
            <>
              <Badge variant="secondary" className="shrink-0">
                <BadgeCheck className="h-3 w-3" />
                Credencial manual
              </Badge>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Input
                  readOnly
                  value={username}
                  className="h-8 w-[210px] font-mono text-xs"
                  aria-label="Usuario da credencial"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Copiar usuario"
                  onClick={() => void copyManual(username)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <div className="relative w-[250px]">
                  <Input
                    readOnly
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    className="h-8 pr-16 font-mono text-xs"
                    aria-label="Senha da credencial"
                  />
                  <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Copiar senha"
                      onClick={() => void copyManual(password)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-[var(--pv-muted)]">
                Expira em{' '}
                {credentialExpiresAt
                  ? Math.max(0, Math.ceil((credentialExpiresAt - Date.now()) / 1000))
                  : 0}
                s
              </span>
              <Button variant="ghost" size="sm" onClick={() => setManualOpen(false)}>
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Globe2 className="h-4 w-4 shrink-0 text-[var(--pv-muted)]" />
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void navigate()
                }}
              >
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onFocus={() => setEditingUrl(true)}
                  onBlur={() => setEditingUrl(false)}
                  className="h-8 font-mono text-xs"
                  placeholder="https://..."
                  spellCheck={false}
                />
                <Button type="submit" size="sm" disabled={busy || !url.trim()}>
                  Ir
                </Button>
              </form>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[11px] text-[var(--pv-muted)]" id="zoom-label">
                  Zoom
                </span>
                <select
                  value={zoom}
                  onChange={(event) => void changeZoom(Number(event.target.value))}
                  className="h-8 rounded-lg border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-1.5 text-xs"
                  aria-labelledby="zoom-label"
                >
                  {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((factor) => (
                    <option key={factor} value={factor}>
                      {Math.round(factor * 100)}%
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </header>
      {data.recipeRunning && !portalHidden ? (
        <RoboticActivity label={`Acessando ${data.serviceName}`} />
      ) : null}
      {needsHuman ? (
        <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Ação manual necessária — conclua a verificação na tela abaixo.
          </span>
        </div>
      ) : null}

      {portalHidden ? (
        <main className="relative min-h-0 flex-1 overflow-hidden bg-[#141310]">
          {awaitingOrBooting ? (
            <>
              <BootLoader title={`Acessando ${data?.serviceName ?? 'portal'}`} />
              {data.status === 'awaiting_login' ? (
                <div className="absolute inset-x-0 bottom-5 z-20 flex flex-wrap items-center justify-center gap-2 px-4 opacity-80 transition-opacity hover:opacity-100">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-[#6b5524] bg-[#1b1a17]/60 text-[#ece9e2] backdrop-blur-sm hover:bg-[#242220]"
                    onClick={() =>
                      void run(async () => {
                        const result = await aurumBitPortal().sessions.retryRecipe(sessionId)
                        toast[result.ok ? 'success' : 'warning'](result.message)
                      })
                    }
                  >
                    <RotateCw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[#d8c795] hover:bg-white/5 hover:text-[#f5efe4]"
                    onClick={() => void run(() => aurumBitPortal().sessions.reveal(sessionId))}
                  >
                    Abrir o portal mesmo assim
                  </Button>
                </div>
              ) : null}
            </>
          ) : manualOrError ? (
            <>
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="h-7 w-7 text-amber-400" aria-hidden="true" />
                </div>
                <div className="space-y-2">
                  <p className="text-base font-semibold tracking-tight text-[#ece9e2]">
                    Não foi possível concluir o acesso
                  </p>
                  <p className="mx-auto max-w-md text-[13px] leading-relaxed text-[#d8c795]">
                    {data.statusMessage ?? 'O portal não confirmou a autenticação automaticamente.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        const result = await aurumBitPortal().sessions.retryRecipe(sessionId)
                        toast[result.ok ? 'success' : 'warning'](result.message)
                      })
                    }
                  >
                    <RotateCw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-[#6b5524] bg-[#1b1a17] text-[#ece9e2] hover:bg-[#242220]"
                    onClick={() => void run(() => aurumBitPortal().sessions.reveal(sessionId))}
                  >
                    Abrir o portal mesmo assim
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[#d8c795] hover:bg-white/5 hover:text-[#f5efe4]"
                    onClick={() => void aurumBitPortal().sessions.close(sessionId)}
                  >
                    Fechar sessão
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </main>
      ) : (
        <main className="pointer-events-none min-h-0 flex-1 bg-transparent" aria-hidden="true" />
      )}

      <footer
        className="flex shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--pv-border)] bg-[var(--pv-panel)] px-3 text-[10px] text-[var(--pv-muted)]"
        style={{ height: SESSION_CHROME_FOOTER_HEIGHT }}
      >
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3 w-3 text-emerald-500" />
          Conteudo remoto isolado
        </span>
        {data.certificate ? (
          <span className="truncate">Cert: {data.certificate.holderName}</span>
        ) : (
          <span>Autenticação por senha</span>
        )}
        <span className={cn('truncate', data.loading && 'animate-pulse')}>
          {data.statusMessage ?? data.title}
        </span>
        <span className="ml-auto shrink-0 font-mono">{data.partition}</span>
        <span className="shrink-0">Zoom {Math.round(zoom * 100)}%</span>
      </footer>
    </div>
  )
}
