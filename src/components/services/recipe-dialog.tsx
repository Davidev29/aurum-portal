'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { TestTube2 } from 'lucide-react'
import type { RecipeTestResult, Service } from '@shared/types'
import type { RecipeDefinition } from '@shared/recipe'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useInvalidate } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'

export function RecipeDialog({
  service,
  onOpenChange,
}: {
  service: Service | null
  onOpenChange: (open: boolean) => void
}) {
  const invalidate = useInvalidate()
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<RecipeTestResult | null>(null)

  React.useEffect(() => {
    if (!service) return
    setError(null)
    setResult(null)
    const definition: RecipeDefinition =
      service.recipe?.definition ??
      ({
        version: 1,
        service: service.slug,
        auth: service.defaultAuth,
        steps: [],
        postLogin: { selectors: ['body'], timeoutMs: 45_000 },
        autoSubmit: false,
        onFailure: 'manual',
        captchaSelectors: [],
        twoFactorSelectors: [],
      } satisfies RecipeDefinition)
    setText(JSON.stringify(definition, null, 2))
  }, [service])

  const parse = (): RecipeDefinition => {
    const parsed = JSON.parse(text) as RecipeDefinition
    return parsed
  }

  const save = async () => {
    if (!service) return
    setBusy(true)
    setError(null)
    try {
      await aurumBitPortal().recipes.save({ serviceId: service.id, definition: parse() })
      toast.success('Receita salva como rascunho. Teste o portal antes de confiar no fluxo.')
      await Promise.all([invalidate.services(), invalidate.audit()])
      onOpenChange(false)
    } catch (caught) {
      setError(
        caught instanceof SyntaxError ? `JSON invalido: ${caught.message}` : errorMessage(caught),
      )
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    if (!service) return
    try {
      const tested = await aurumBitPortal().recipes.test(service.id)
      setResult(tested)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const reset = async () => {
    if (!service) return
    setBusy(true)
    setError(null)
    try {
      await aurumBitPortal().recipes.reset(service.id)
      toast.success('Receita removida; o serviço permanece sem automação.')
      await Promise.all([invalidate.services(), invalidate.audit()])
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(service)} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receita de {service?.name}</DialogTitle>
          <DialogDescription>
            A receita apenas preenche campos e clica em botoes declarados. CAPTCHA e 2FA pausam a
            automacao para intervencao manual. Placeholders: {'{{credential.username}}'},{' '}
            {'{{credential.password}}'}, {'{{client.document}}'}, {'{{client.name}}'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[340px] font-mono text-xs"
            spellCheck={false}
          />
          {error ? (
            <Alert variant="danger" title="Não foi possível salvar">
              {error}
            </Alert>
          ) : null}
          {result ? (
            <Alert
              variant={result.ok ? 'success' : 'warning'}
              title={result.ok ? 'Portal alcancavel' : 'Teste falhou'}
            >
              {result.message}
            </Alert>
          ) : null}
          <Alert variant="info">
            Prefira seletores estaveis (name, id, autocomplete). O autofill e assistido por padrao;
            envio automatico exige opt-in explicito na receita.
          </Alert>
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void test()} disabled={!service}>
              <TestTube2 className="h-3.5 w-3.5" />
              Testar alcance
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reset()}
              disabled={busy || !service?.recipe}
            >
              Remover receita
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar receita'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
