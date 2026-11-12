'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, ScanSearch, Banknote } from 'lucide-react'
import type { Client, ClientInput } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useInvalidate } from '@/lib/queries'
import { formatDocumentPartial, onlyDigits } from '@shared/validation'
import { centsToDigits, digitsToCents, digitsToCurrencyText } from '@shared/currency'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/switch'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

/**
 * Formulario de cliente reaproveitado no dialog de cadastro da lista e na
 * edicao inline da tela de detalhe. Busca os dados publicos do CNPJ na
 * Brasil API para preencher os campos a partir do documento digitado.
 */
export function ClientForm({
  client,
  onSaved,
  onCancel,
  variant = 'page',
}: {
  client?: Client | null
  onSaved?: (client: Client) => void
  onCancel?: () => void
  /** 'dialog' acopla o rodape as bordas do dialog (padrao DialogFooter). */
  variant?: 'dialog' | 'page'
}) {
  const invalidate = useInvalidate()
  const [busy, setBusy] = React.useState(false)
  const [lookupBusy, setLookupBusy] = React.useState(false)
  const [type, setType] = React.useState<'PF' | 'PJ'>(client?.type ?? 'PJ')
  const [name, setName] = React.useState(client?.name ?? '')
  const [document, setDocument] = React.useState(() =>
    client?.document ? formatDocumentPartial(client.document) : '',
  )
  const [email, setEmail] = React.useState(client?.email ?? '')
  const [phone, setPhone] = React.useState(client?.phone ?? '')
  const [honorariosDigits, setHonorariosDigits] = React.useState(() =>
    centsToDigits(client?.honorariosCents ?? null),
  )
  const [tags, setTags] = React.useState(client?.tags.join(', ') ?? '')
  const [consent, setConsent] = React.useState(Boolean(client?.consentAt))
  const [tradeName, setTradeName] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const documentDigits = onlyDigits(document)
  const canLookupCnpj = type === 'PJ' && documentDigits.length === 14 && !busy

  const handleDocumentChange = (value: string) => {
    setDocument(formatDocumentPartial(value))
  }

  const lookupCnpj = async () => {
    if (lookupBusy || !canLookupCnpj) return
    setLookupBusy(true)
    try {
      const company = await aurumBitPortal().clients.cnpjLookup({ document })
      if (company.tradeName) setTradeName(company.tradeName)
      const filled: string[] = []
      if (!name.trim() && company.name) {
        setName(company.name)
        filled.push('razão social')
      }
      if (!phone.trim() && company.phone) {
        setPhone(company.phone)
        filled.push('telefone')
      }
      if (!email.trim() && company.email) {
        setEmail(company.email)
        filled.push('e-mail')
      }
      if (filled.length > 0) {
        toast.success(`Dados do CNPJ preenchidos: ${filled.join(', ')}.`)
      } else {
        toast.info(
          'Nenhum campo vazio para preencher. Apague o dado que deseja atualizar e busque novamente.',
        )
      }
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setLookupBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const input: ClientInput = {
        type,
        name,
        document,
        email: email || null,
        phone: phone || null,
        honorariosCents: digitsToCents(honorariosDigits),
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        consent: consent || undefined,
      }
      const saved = client
        ? await aurumBitPortal().clients.update(client.id, input)
        : await aurumBitPortal().clients.create(input)
      toast.success(client ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      await Promise.all([invalidate.clients(), invalidate.client(saved.id), invalidate.audit()])
      onSaved?.(saved)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_1fr]">
        <Field label="Tipo" required>
          <Select value={type} onChange={(event) => setType(event.target.value as 'PF' | 'PJ')}>
            <option value="PJ">Pessoa Jurídica</option>
            <option value="PF">Pessoa Física</option>
          </Select>
        </Field>
        <Field
          label={type === 'PF' ? 'Nome completo' : 'Razao social'}
          required
          hint={
            tradeName
              ? `Nome fantasia: ${tradeName}`
              : type === 'PJ'
                ? 'Deixe vazio para preencher pela busca do CNPJ.'
                : undefined
          }
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
        </Field>
      </div>

      {type === 'PJ' ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="CNPJ" required className="min-w-0 flex-1">
              <Input
                value={document}
                onChange={(event) => handleDocumentChange(event.target.value)}
                inputMode="numeric"
                maxLength={18}
                placeholder="00.000.000/0000-00"
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void lookupCnpj()}
              disabled={!canLookupCnpj}
              title={
                documentDigits.length === 14
                  ? 'Buscar razão social, e-mail e telefone na Brasil API'
                  : 'Digite os 14 digitos do CNPJ para buscar'
              }
            >
              {lookupBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="h-4 w-4" />
              )}
              {lookupBusy ? 'Buscando...' : 'Buscar dados'}
            </Button>
          </div>
          <p className="-mt-2 text-xs text-[var(--pv-muted)]">
            Consulta os dados publicos do CNPJ na Brasil API e preenche os campos vazios. Somente o
            CNPJ digitado sai desta estação, e a busca é registrada na auditoria.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Telefone">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="contato@escritorio.com.br"
              />
            </Field>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="CPF" required>
              <Input
                value={document}
                onChange={(event) => handleDocumentChange(event.target.value)}
                inputMode="numeric"
                maxLength={14}
                placeholder="000.000.000-00"
              />
            </Field>
            <Field label="Telefone">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
          </div>
          <Field label="E-mail">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="contato@escritorio.com.br"
            />
          </Field>
        </div>
      )}

      <Field
        label="Honorários"
        hint="Opcional. Valor em moeda (R$). Deixe vazio para não informar; apague tudo para remover o valor salvo."
      >
        <div className="relative">
          <Banknote
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            inputMode="numeric"
            className="pl-10 text-right tabular-nums"
            placeholder="R$ 0,00"
            value={digitsToCurrencyText(honorariosDigits)}
            onChange={(event) =>
              setHonorariosDigits(event.target.value.replace(/\D+/g, '').slice(0, 11))
            }
            aria-label="Honorários em reais"
          />
        </div>
      </Field>

      <Field label="Tags" hint="Separe por vírgula. Ex.: fiscal, folha, ativo">
        <Input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--pv-border)] p-3.5 text-sm leading-relaxed transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
        <Checkbox
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5"
        />
        <span>
          Declaro que o escritorio possui autorizacao do titular para tratar os dados e usar os
          certificados deste cliente (LGPD).
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
          {error}
        </p>
      ) : null}

      <div
        className={
          variant === 'dialog'
            ? '-mx-6 -mb-6 flex flex-col-reverse gap-2 border-t border-[var(--pv-border)] px-6 py-4 sm:flex-row sm:items-center sm:justify-end'
            : 'mt-2 flex flex-col-reverse gap-2 border-t border-[var(--pv-border)] pt-4 sm:flex-row sm:items-center sm:justify-end'
        }
      >
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || !name || !document}>
          {busy ? 'Salvando...' : client ? 'Salvar alteracoes' : 'Cadastrar cliente'}
        </Button>
      </div>
    </form>
  )
}
