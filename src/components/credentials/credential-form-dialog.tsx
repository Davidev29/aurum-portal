'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Copy, Eye, EyeOff, Plus, Trash2, Wand2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Credential, CredentialCreateInput, UsernameType } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClients, useInvalidate, useServices } from '@/lib/queries'
import { passwordStrength } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Progress } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/switch'

const strengthLabels = ['Muito fraca', 'Fraca', 'Razoavel', 'Boa', 'Forte', 'Muito forte']

/** Linha da grade "Campos adicionais": par legenda/valor por campo que o robô
 * localiza pela legenda (texto visível) e preenche no portal. O valor só
 * transita do formulário até a cifra no main process — nunca fica em texto
 * claro no banco. */
interface ExtraFieldRow {
  id: string
  /** Legenda exata como aparece na tela (ex.: "Código da empresa"). */
  name: string
  /** Ex.: código de acesso, token, PIN. Vazio = preservar o valor guardado. */
  value: string
}

const newExtraFieldRow = (name = ''): ExtraFieldRow => ({
  id: crypto.randomUUID(),
  name,
  value: '',
})

export function CredentialFormDialog({
  open,
  onOpenChange,
  credential,
  defaultClientId,
  defaultServiceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  credential?: Credential | null
  defaultClientId?: string
  defaultServiceId?: string
}) {
  const invalidate = useInvalidate()
  const { data: clients } = useClients({ status: 'active' })
  const { data: services } = useServices({ enabledOnly: true })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [clientId, setClientId] = React.useState('')
  const [serviceId, setServiceId] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [usernameType, setUsernameType] = React.useState<UsernameType>('cpf')
  // Legendas: o texto VISÍVEL ao lado do campo no portal. O robô localiza o
  // input pela legenda — ninguém precisa adivinhar o `name` técnico.
  const [usernameLegend, setUsernameLegend] = React.useState('Usuário')
  const [passwordLegend, setPasswordLegend] = React.useState('Senha')
  const [password, setPassword] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [showPassword, setShowPassword] = React.useState(false)
  const [extraRows, setExtraRows] = React.useState<ExtraFieldRow[]>([])
  // Campos "aprendidos" pelo robô na gravação (nome/label do portal). Os
  // VALORES nunca vêm de volta em claro — só nome/label; vazio na edição
  // preserva o valor cifrado existente.
  const [extraValues, setExtraValues] = React.useState<Record<string, string>>({})

  // Busca a receita do serviço para pré-preencher os campos nomeados.
  const { data: recipeSummary } = useQuery({
    queryKey: ['recipe', serviceId],
    queryFn: () => aurumBitPortal().recipes.get(serviceId),
    enabled: Boolean(serviceId),
  })
  const learnedSpecs = React.useMemo(
    () => (recipeSummary?.definition.fields ?? []).filter((field) => field.kind === 'text'),
    [recipeSummary],
  )
  const normalizeLegend = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()

  // Legenda repetida deixa a localização ambígua para o robô — bloqueia o salvar.
  const duplicateLegends = React.useMemo(() => {
    const counts = new Map<string, number>()
    const originals = new Map<string, string>()
    for (const raw of [usernameLegend, passwordLegend, ...extraRows.map((row) => row.name)]) {
      const key = normalizeLegend(raw)
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!originals.has(key)) originals.set(key, raw.trim())
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => originals.get(key) ?? key)
  }, [usernameLegend, passwordLegend, extraRows])
  const extraValueWithoutLegend = extraRows.some(
    (row) => !row.name.trim() && row.value.trim().length > 0,
  )
  const updateExtraRow = (id: string, patch: Partial<Omit<ExtraFieldRow, 'id'>>) =>
    setExtraRows((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  const removeExtraRow = (id: string) =>
    setExtraRows((current) => current.filter((item) => item.id !== id))

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setShowPassword(false)
    setClientId(credential?.clientId ?? defaultClientId ?? '')
    setServiceId(credential?.serviceId ?? defaultServiceId ?? '')
    setLabel(credential?.label ?? '')
    setUsername(credential?.username ?? '')
    setUsernameType(credential?.usernameType ?? 'cpf')
    setPassword('')
    setNotes(credential?.notes ?? '')
    setIsDefault(credential?.isDefault ?? false)
    const userLegend = credential?.fields?.find((field) => field.kind === 'username')?.name
    const passLegend = credential?.fields?.find((field) => field.kind === 'password')?.name
    setUsernameLegend(userLegend ?? 'Usuário')
    setPasswordLegend(passLegend ?? 'Senha')
    const extras = (credential?.fields ?? [])
      .filter((field) => field.kind === 'text')
      .map((field) => newExtraFieldRow(field.name))
    setExtraRows(extras)
    setExtraValues({})
  }, [open, credential, defaultClientId, defaultServiceId])

  const buildFields = () => {
    const fields: { name: string; kind: 'username' | 'password' | 'text'; value?: string }[] = [
      { name: usernameLegend.trim() || 'Usuário', kind: 'username' },
      { name: passwordLegend.trim() || 'Senha', kind: 'password' },
    ]
    if (learnedSpecs.length > 0) {
      for (const spec of learnedSpecs) {
        const value = (extraValues[spec.key] ?? '').trim()
        fields.push(
          value ? { name: spec.key, kind: 'text', value } : { name: spec.key, kind: 'text' },
        )
      }
      return fields
    }
    // Um par nome/valor por linha; o robô indexa por nome — nomes repetidos
    // devem cair no último valor digitado (mesmo semantics do Record revelado).
    const unique = new Map<string, { name: string; kind: 'text'; value?: string }>()
    for (const row of extraRows) {
      const name = row.name.trim()
      if (!name) continue
      unique.set(
        name,
        row.value ? { name, kind: 'text', value: row.value } : { name, kind: 'text' },
      )
    }
    return [...fields, ...unique.values()]
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      if (credential) {
        await aurumBitPortal().credentials.update(credential.id, {
          label,
          username,
          usernameType,
          ...(password ? { password } : {}),
          notes: notes || null,
          fields: buildFields(),
          isDefault,
        })
        toast.success('Credencial atualizada.')
      } else {
        const input: CredentialCreateInput = {
          clientId,
          serviceId,
          label,
          username,
          usernameType,
          password,
          notes: notes || null,
          fields: buildFields(),
          isDefault,
        }
        await aurumBitPortal().credentials.create(input)
        toast.success('Credencial cadastrada no cofre.')
      }
      await Promise.all([invalidate.credentials(), invalidate.audit()])
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    try {
      const generated = await aurumBitPortal().credentials.generate({ length: 24 })
      setPassword(generated.password)
      setShowPassword(true)
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  const copy = async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      toast.success('Senha copiada. Limpeza automatica em 30 segundos.')
    } catch {
      toast.error('Não foi possível acessar a área de transferência.')
    }
  }

  const strength = passwordStrength(password)
  const valid =
    clientId &&
    serviceId &&
    label.trim() &&
    usernameLegend.trim() &&
    username.trim() &&
    passwordLegend.trim() &&
    (credential ? true : password.length > 0) &&
    duplicateLegends.length === 0 &&
    !extraValueWithoutLegend

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{credential ? 'Editar credencial' : 'Nova credencial'}</DialogTitle>
          <DialogDescription>
            A senha e cifrada com AES-256-GCM. O texto claro nunca e gravado no banco.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cliente" required>
              <Select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={Boolean(credential)}
              >
                <option value="">Selecione</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Serviço" required>
              <Select
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                disabled={Boolean(credential)}
              >
                <option value="">Selecione</option>
                {services?.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Rotulo" required hint="Ex.: Matriz, Filial SP, e-CAC principal">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={100}
              />
            </Field>
            <Field label="Tipo de usuario">
              <Select
                value={usernameType}
                onChange={(event) => setUsernameType(event.target.value as UsernameType)}
              >
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="other">Outro</option>
              </Select>
            </Field>
          </div>
          <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-3 py-2 text-[11px] leading-snug">
            <p className="font-semibold text-[var(--pv-text)]">Como o robô localiza cada campo</p>
            <p className="mt-0.5 text-[var(--pv-muted)]">
              Informe a <strong>legenda</strong> (o texto que aparece ao lado do campo no portal —
              ex.: “Usuário”, “CPF”, “Senha”, “Código da empresa”) e o <strong>valor</strong>. O
              robô procura a legenda na tela e preenche o valor de cada campo. Não existe nome
              técnico obrigatório: vale o que o portal mostra.
            </p>
          </div>
          <Field
            label="Usuário"
            required
            hint="Legenda = o texto ao lado do campo no portal (ex.: Usuário, CPF, Login)"
          >
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_1.3fr] sm:gap-2">
              <Input
                value={usernameLegend}
                onChange={(event) => setUsernameLegend(event.target.value)}
                placeholder="Ex.: Usuário, CPF, Login"
                aria-label="Legenda do campo Usuário no portal"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                maxLength={60}
              />
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Valor inserido no portal"
                aria-label="Valor do campo Usuário"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
              />
            </div>
          </Field>
          <Field
            label={credential ? 'Nova senha (deixe vazio para manter)' : 'Senha'}
            required={!credential}
            hint="Legenda = o texto ao lado do campo de senha no portal (ex.: Senha, Password)"
          >
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_1.3fr] sm:gap-2">
              <Input
                value={passwordLegend}
                onChange={(event) => setPasswordLegend(event.target.value)}
                placeholder="Ex.: Senha, Password"
                aria-label="Legenda do campo Senha no portal"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                maxLength={60}
              />
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                  placeholder={
                    credential ? 'Vazio = manter a senha atual' : 'Valor inserido no portal'
                  }
                  aria-label="Valor do campo Senha"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--pv-muted)] transition-colors hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)] dark:hover:bg-[var(--pv-panel-2)]"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                {password ? (
                  <>
                    <Progress value={(strength / 5) * 100} />
                    <p className="mt-1 text-xs text-[var(--pv-muted)]">
                      Forca: {strengthLabels[strength] ?? 'Muito fraca'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-[var(--pv-muted)]">
                    Senha cifrada no cofre — nunca gravada em claro.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void generate()}
                  title="Gerar senha forte"
                >
                  <Wand2 className="h-4 w-4" />
                  Gerar
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => void copy()}
                  disabled={!password}
                  aria-label="Copiar senha"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Field>
          {learnedSpecs.length > 0 ? (
            <div className="rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-muted)]">
                Campos que o portal pede (aprendidos na gravação do robô)
              </p>
              <div className="mt-2.5 grid gap-2.5">
                {learnedSpecs.map((spec) => (
                  <div
                    key={spec.key}
                    className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_2fr] sm:gap-3"
                  >
                    <label
                      htmlFor={`learned-${spec.key}`}
                      className="text-xs font-semibold text-[var(--pv-text)]"
                    >
                      {spec.label}
                    </label>
                    <Input
                      id={`learned-${spec.key}`}
                      type="password"
                      value={extraValues[spec.key] ?? ''}
                      onChange={(event) =>
                        setExtraValues((current) => ({
                          ...current,
                          [spec.key]: event.target.value,
                        }))
                      }
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder="Vazio = manter o valor guardado"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-[var(--pv-muted)]">
                Os valores ficam cifrados no cofre; nunca saem do seu computador. Em branco na
                edição, o valor guardado é preservado.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-muted)]">
                    Campos adicionais
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--pv-muted)]">
                    Para os campos que o portal pede além de usuário e senha (ex.: código da
                    empresa, inscrição estadual). A mesma regra: legenda + valor — o robô procura a
                    legenda na tela.
                  </p>
                </div>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => setExtraRows((current) => [...current, newExtraFieldRow()])}
                  disabled={extraRows.length >= 20}
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
              {extraRows.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  <div
                    aria-hidden="true"
                    className="hidden grid-cols-[1fr_1fr_2rem] gap-2 px-0.5 sm:grid"
                  >
                    <span className="text-[11px] font-semibold text-[var(--pv-muted)]">
                      Legenda no portal
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--pv-muted)]">Valor</span>
                    <span />
                  </div>
                  {extraRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_auto] gap-1.5 rounded-xl border border-[var(--pv-border)] p-2 sm:grid-cols-[1fr_1fr_2rem] sm:items-center sm:gap-2 sm:border-0 sm:p-0"
                    >
                      <Input
                        value={row.name}
                        onChange={(event) => updateExtraRow(row.id, { name: event.target.value })}
                        placeholder="Ex.: Código da empresa"
                        aria-label="Legenda do campo no portal (ex.: Código da empresa)"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        maxLength={60}
                        className="col-span-2 sm:col-span-1"
                      />
                      <Input
                        type="password"
                        value={row.value}
                        onChange={(event) => updateExtraRow(row.id, { value: event.target.value })}
                        placeholder={
                          credential
                            ? 'Vazio = manter o valor guardado'
                            : 'Valor inserido pelo robô'
                        }
                        aria-label="Valor do campo extra"
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        maxLength={1024}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeExtraRow(row.id)}
                        aria-label={`Remover campo ${row.name.trim() || 'sem nome'}`}
                        title="Remover campo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--pv-border-strong)] px-3 py-2.5 text-center text-xs text-[var(--pv-muted)]">
                  Nenhum campo adicional — o robô usa apenas usuário e senha.
                </p>
              )}
              {duplicateLegends.length > 0 || extraValueWithoutLegend ? (
                <p role="alert" className="mt-2 text-[11px] font-medium text-[var(--pv-danger)]">
                  {duplicateLegends.length > 0
                    ? `Legenda repetida: ${duplicateLegends.join(', ')}. O robô localiza o campo pela legenda — mantenha uma única legenda por campo.`
                    : 'Há um valor sem legenda — o robô não saberá onde inserir. Preencha a legenda.'}
                </p>
              ) : (
                <p className="mt-2 text-[11px] leading-snug text-[var(--pv-muted)]">
                  O robô localiza o campo na tela pelo mesmo texto da legenda e insere o valor
                  cifrado. Em branco na edição, o valor guardado é preservado.
                </p>
              )}
            </div>
          )}
          <Field label="Notas">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--pv-border)] p-3 text-sm transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            Usar como credencial padrão deste cliente neste serviço
          </label>
          {error ? (
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void create()} disabled={busy || !valid}>
            {busy ? 'Salvando…' : credential ? 'Salvar alteracoes' : 'Adicionar ao cofre'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
