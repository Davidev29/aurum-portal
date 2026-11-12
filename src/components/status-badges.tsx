import { Badge } from '@/components/ui/badge'
import type { CertificateStatus } from '@shared/constants'
import type { SessionStatus } from '@shared/constants'

const certificateLabels: Record<CertificateStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' | 'outline' }> = {
  valid: { label: 'Valido', variant: 'success' },
  expiring: { label: 'A vencer', variant: 'warning' },
  expired: { label: 'Vencido', variant: 'danger' },
  in_vault: { label: 'No cofre', variant: 'secondary' },
  missing_windows: { label: 'Ausente no Windows', variant: 'danger' },
  chain_incomplete: { label: 'Cadeia incompleta', variant: 'warning' },
}

export function CertificateStatusBadge({ status }: { status: CertificateStatus }) {
  const config = certificateLabels[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}

const sessionLabels: Record<SessionStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' | 'outline' }> = {
  opening: { label: 'Abrindo', variant: 'secondary' },
  awaiting_login: { label: 'Aguardando login', variant: 'warning' },
  authenticated: { label: 'Autenticado', variant: 'success' },
  manual: { label: 'Modo manual', variant: 'warning' },
  error: { label: 'Erro', variant: 'danger' },
  closed: { label: 'Fechada', variant: 'outline' },
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const config = sessionLabels[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}

export function AuthMethodBadges({ methods }: { methods: Array<'certificate' | 'password'> }) {
  if (methods.length === 2) return <Badge variant="secondary">Certificado + Senha</Badge>
  return (
    <Badge variant={methods[0] === 'certificate' ? 'default' : 'secondary'}>
      {methods[0] === 'certificate' ? 'Certificado' : 'Senha'}
    </Badge>
  )
}
