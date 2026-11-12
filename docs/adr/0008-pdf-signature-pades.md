# ADR 0008 — Módulo de assinatura de PDF (PAdES-B-T)

- **Status:** Aceita
- **Data:** 2026-11-06
- **Decisores:** Equipe AurumBit Portal

## Contexto

O AurumBit Portal já importa, instala e vincula certificados A1 para autenticação em portais. Faltava um módulo para **assinar PDFs** com o mesmo certificado, com validade jurídica (Lei 14.063/2020, MP 2.200-2/2001 art. 10 §1º). A assinatura precisa ser:

- **qualificada** (certificado ICP-Brasil);
- **longa duração mínima** (PAdES-B-T, com carimbo de tempo RFC 3161);
- **incremental** (preservar assinaturas preexistentes no PDF);
- **local-only** (ADR 0001): o documento não sai da estação; somente o hash da assinatura vai à TSA.

## Decisão

1. **PAdES-B-T** via `SubFilter = ETSI.CAdES.detached` (Filter `Adobe.PPKLite`), digest SHA-256, RSA-PKCS#1 v1.5.
2. **Carimbo de tempo RFC 3161** sobre o *valor* da assinatura (OID `1.2.840.113549.1.9.16.1.4` como unsigned attribute), obtido por POST a uma TSA configurável.
3. **TSA padrão: DigiCert pública** (`timestamp.digicert.com`), sem auth, URL editável em Configurações com botão "Testar TSA" (12s timeout, fail-closed se indisponível). O operador pode trocar por uma TSA ICP-Brasil credenciada.
4. **Montagem CMS via pkijs** (SignedData detached, signedAttrs contentType/signingTime/messageDigest, cert chain embutida, unsignedAttrs TST), chave RSA importada como PKCS#8 via WebCrypto (Node 22).
5. **Carimbo visual pt-BR** desenhado com pdf-lib (Helvetica WinAnsi, check desenhado, borda, motivo, AC emissora, validador ITI) — informativo; a validade jurídica está na assinatura criptográfica.
6. **Assinatura usa o PFX do cofre**, não o repositório do Windows — não exige instalação; worker isolado (`pdf-sign-worker`, padrão do pfx-worker) decifra/assina/zera buffers.
7. **Saída `<nome>-assinado.pdf`** ao lado do original, nunca sobrescreve (sufixo `(2)`, `(3)`...); atualização incremental via `@signpdf/signpdf` preserva assinaturas pré-existentes.
8. **Posição livre com preview**: pdfjs-dist renderiza o PDF no renderer; carimbo arrastável sobre qualquer página (coordenadas normalizadas 0..1, **origem superior-esquerda da página exibida** — `cropBox ∩ mediaBox` com `/Rotate` aplicado, a mesma geometria que o pdf.js renderiza; o backend converte para user space (origem inferior-esquerda, sem rotação) ao desenhar. Carimbo e widget `/Rect` usam a mesma conversão, e a aparência (conteúdo no caminho novo; AP Form XObject no caminho incremental) é pré-rotacionada para aparecer "em pé" com `/Rotate ≠ 0`; tamanho P/M/G ou desenhado (widthPct/heightPct).
9. **Token de documento em memória** (15 min, revalidação de mtime + sha256) para evitar TOCTOU entre prévia e assinatura.
10. **Auditoria**: `pdf.signed` / `pdf.sign_failed` com basename, sha256, thumbprint, TSA host; sem PFX/senha/base64.
11. **Limite 50 MB**, sem suporte a PDF com senha, 1 assinatura por vez (fila).
12. **Docs**: ADR 0008, SECURITY.md, USER_GUIDE.md, SUPPORT.md, TERMS.md, PRIVACY.md, README.md.

## Consequências

**Positivas**
- Assinatura qualificada com validade jurídica sem serviço externo de assinatura; o documento nunca sai da estação (só o hash da assinatura vai à TSA).
- Reuso total da infraestrutura existente (vault, certificados, audit, IPC, worker pattern).
- Fail-closed: sem TSA válida, sem certificado válido, sem PDF válido → nada é gravado.

**Negativas**
- DigiCert pública é gratuita mas sem SLA/contrato; operador pode trocar por TSA ICP-Brasil credenciada.
- Carimbo visual é informativo; a verificação final é feita por validador externo (validar.iti.gov.br / Adobe com raízes ICP-Brasil).
- PDF com senha não é suportado na v1.

## Alternativas consideradas

1. **PAdES-B-B (sem TSA).** Rejeitada: o usuário exigiu carimbo de tempo para maior força probatória.
2. **TSA ICP-Brasil credenciada por padrão.** Rejeitada: exige contrato/credencial que o app não pode embutir; campo de URL já permite configurar.
3. **iText/Spire.PDF (Java/comercial).** Rejeitada: AGPL/comercial; @signpdf + pkijs + pdf-lib são MIT e cobrem o caso.
4. **Assinar no processo principal.** Rejeitada: bug em parser PDF derrubaria o app; worker isolado segue o padrão existente.
5. **Persistir posição do carimbo globalmente.** Rejeitada na v1: posição depende do layout do PDF; manter por documento/sessão evita inconsistências.