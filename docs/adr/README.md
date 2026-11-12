# Decisões de arquitetura (ADRs)

Registro das decisões estruturantes do AurumBit Portal.

| ADR | Título | Status |
| --- | --- | --- |
| [0001](0001-local-only-architecture.md) | Arquitetura local-only | Aceita |
| [0002](0002-electron-nextjs-static-export.md) | Electron + Next.js com export estático | Aceita |
| [0003](0003-session-isolation-and-certificate-selection.md) | Isolamento por cliente e certificado | Aceita |
| [0004](0004-vault-dpapi-aes-gcm.md) | Cofre local com DPAPI e AES-256-GCM | Aceita |
| [0005](0005-secrets-encryption.md) | Tratamento de segredos, revelação e cópia | Aceita |
| [0006](0006-gov-sso-certificate-urls.md) | Normalização de URLs e injeção de certificado gov.br | Aceita |
| [0007](0007-external-cnpj-lookup-opt-in.md) | Consulta externa de CNPJ somente com opt-in | Aceita |
| [0008](0008-pdf-signature-pades.md) | Módulo de assinatura de PDF (PAdES-B-T) | Aceita |

## Quando criar um novo ADR

Crie um ADR quando a mudança:

- alterar o modelo de ameaça ou a fronteira de confiança;
- mudar o local de armazenamento, a criptografia ou o ciclo de vida de segredos;
- alterar o isolamento de sessões ou a seleção de certificados;
- introduzir comunicação remota, telemetria, backend ou sincronização;
- trocar a stack de desktop, o modelo de distribuição ou o formato de backup.

Use o formato: contexto, decisão, consequências (positivas e negativas) e alternativas consideradas. ADRs aceitos não devem ser reescritos; uma decisão posterior deve substituí-los com um novo registro.
