'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Copy, Eye, EyeOff, Wand2 } from 'lucide-react'
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
  const [password, setPassword] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [showPassword, setShowPassword] = React.useState(false)
  const [loginField, setLoginField] = React.useState('username')
  const [passwordField, setPasswordField] = React.useState('password')
  const [extraFields, setExtraFields] = React.useState('')
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
    const login = credential?.fields?.find((field) => field.kind === 'username')?.name
    const pass = credential?.fields?.find((field) => field.kind === 'password')?.name
    setLoginField(login ?? 'username')
    setPasswordField(pass ?? 'password')
    const extras = (credential?.fields ?? [])
      .filter((field) => field.kind === 'text')
      .map((field) => field.name)
    setExtraFields(extras.join('\n'))
    setExtraValues({})
  }, [open, credential, defaultClientId, defaultServiceId])

  const buildFields = () => {
    const fields: { name: string; kind: 'username' | 'password' | 'text'; value?: string }[] = [
      { name: loginField.trim() || 'username', kind: 'username' },
      { name: passwordField.trim() || 'password', kind: 'password' },
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
    for (const line of extraFields.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const [name, ...rest] = trimmed.split('=')
      if (!name?.trim()) continue
      fields.push({ name: name.trim(), kind: 'text', value: rest.join('=').trim() })
    }
    return fields
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
    username.trim() &&
    (credential ? true : password.length > 0)

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
          <Field label="Usuario" required>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
            />
          </Field>
          <Field
            label={credential ? 'Nova senha (deixe vazio para manter)' : 'Senha'}
            required={!credential}
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
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
              <Button variant="secondary" onClick={() => void generate()} title="Gerar senha forte">
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
            {password ? (
              <div className="mt-1 space-y-1">
                <Progress value={(strength / 5) * 100} />
                <p className="text-xs text-[var(--pv-muted)]">
                  Forca: {strengthLabels[strength] ?? 'Muito fraca'}
                </p>
              </div>
            ) : null}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Campo de login" hint="Nome do input no portal">
              <Input
                value={loginField}
                onChange={(event) => setLoginField(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
            <Field label="Campo de senha" hint="Nome do input no portal">
              <Input
                value={passwordField}
                onChange={(event) => setPasswordField(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
          </div>
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
            <Field
              label="Campos adicionais"
              hint="Um por linha: nome=valor (opcional). Reescreva os valores antigos para cifra-los."
            >
              <Textarea
                value={extraFields}
                onChange={(event) => setExtraFields(event.target.value)}
              />
            </Field>
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
