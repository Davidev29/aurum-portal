import { createHash } from 'node:crypto'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { SUBFILTER_ETSI_CADES_DETACHED, SignPdfError, Signer } from '@signpdf/utils'
import { SignPdf } from '@signpdf/signpdf'
import { createIncrementalPlaceholder } from './incremental'
import {
  AURUMBIT_PLATFORM,
  SIGN_PDF_MAX_BYTES,
  type SignatureStampSize,
} from '../../../shared/signature'
import {
  drawSignatureStamp,
  formatDocumentForStamp,
  prepareFonts,
  resolveCustomStampRect,
  resolveStampRect,
} from './stamp'
import { prepareItiSeal } from './stamp-logo'
import { buildDetachedCmsWithInfo, CmsError } from './cms'
import { verifySignedPdf } from './verify'

export interface PdfSignCertificate {
  pfx: Buffer
  password: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  issuerDn: string
  thumbprintSha256: string
  validTo: string
}

export interface SignPdfDocumentInput {
  fileName: string
  pdfBytes: Buffer
  certificate: PdfSignCertificate
  page: number
  xPct: number
  yPct: number
  size: SignatureStampSize
  /** Tamanho desenhado pelo usuario (fracoes da pagina). */
  widthPct?: number
  heightPct?: number
  /** @deprecated motivo removido; ignorado. */
  reason?: string
  /** @deprecated localizacao removida do carimbo; ignorado. */
  location?: string | null
  tsaUrl: string
  signingTime?: Date
}

export interface SignPdfDocumentResult {
  pdf: Buffer
  sha256: string
  thumbprint: string
  tsaHost: string
  signedAt: string
}

/** Extrai o CN do DN emissor para exibição no carimbo (truncado, seguro). */
function issuerShortName(dn: string): string {
  const match = /(?:^|,)\s*CN\s*=\s*([^,]+)/i.exec(dn)
  const cn = (match?.[1] ?? dn).trim()
  return cn.length > 46 ? `${cn.slice(0, 45)}…` : cn
}

class VaultPdfSigner extends Signer {
  lastTsaHost: string | null = null
  constructor(
    private readonly data: { pfx: Buffer; password: string },
    private readonly tsaUrl: string,
    private readonly signingTime: Date,
  ) {
    super()
  }

  override async sign(pdfBytes: Buffer, signingTime?: Date): Promise<Buffer> {
    const built = await buildDetachedCmsWithInfo({
      data: pdfBytes,
      pfx: this.data.pfx,
      password: this.data.password,
      tsaUrl: this.tsaUrl,
      signingTime: signingTime ?? this.signingTime,
    })
    this.lastTsaHost = built.tsaHost
    return built.der
  }
}

/**
 * Assina um PDF com PAdES-B-T.
 *
 * Nunca escreve em disco; retorna os bytes do PDF assinado. O chamador é o
 * responsável por gravar com estratégia "nunca sobrescrever".
 */
function countExistingSignatures(doc: PDFDocument): number {
  try {
    const acro = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    if (!acro) return 0
    const fields = acro.get(PDFName.of('Fields'))
    if (!(fields instanceof PDFArray)) return 0
    let count = 0
    for (let i = 0; i < fields.size(); i += 1) {
      const widget: unknown = doc.context.lookup(fields.get(i) as never)
      if (widget instanceof PDFDict) {
        const ft = widget.get(PDFName.of('FT'))
        if (ft?.toString?.() === '/Sig') count += 1
      }
    }
    return count
  } catch {
    return 0
  }
}

export async function signPdfDocument(input: SignPdfDocumentInput): Promise<SignPdfDocumentResult> {
  const { page, xPct, yPct, size, tsaUrl } = input
  const widthPct = input.widthPct
  const heightPct = input.heightPct
  // WorkerData chega como Uint8Array (nao Buffer) apos worker_threads —
  // normaliza para Buffer para o restante do fluxo (cms/stamp/pdf-lib).
  const rawPdfBytes = input.pdfBytes as unknown as Uint8Array | null | undefined
  const pdfBytes =
    rawPdfBytes && rawPdfBytes.length > 0
      ? Buffer.isBuffer(rawPdfBytes)
        ? (rawPdfBytes as unknown as Buffer)
        : Buffer.from(rawPdfBytes)
      : (Buffer.alloc(0) as unknown as Buffer)
  const rawPfx = (input.certificate as unknown as { pfx?: unknown })?.pfx as
    | Uint8Array
    | null
    | undefined
  const certificate =
    rawPfx && rawPfx.length > 0 && !Buffer.isBuffer(rawPfx)
      ? { ...input.certificate, pfx: Buffer.from(rawPfx) }
      : input.certificate
  if (!pdfBytes || pdfBytes.length === 0) {
    throw new CmsError(
      `Arquivo PDF vazio (0 bytes): ${input.fileName || 'desconhecido'} — escolha o PDF novamente`,
    )
  }
  if (pdfBytes.length > SIGN_PDF_MAX_BYTES) {
    throw new CmsError('PDF maior que 50 MB nao e suportado')
  }
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || xPct < 0 || yPct < 0 || xPct > 1 || yPct > 1) {
    throw new CmsError('Posicao do carimbo invalida')
  }
  // Offline-first: URL vazia/invalida ou TSA indisponivel nao aborta —
  // o CMS assina como PAdES-B (sem carimbo). Nenhuma rede e exigida.
  const validTo = new Date(certificate.validTo)
  if (Number.isNaN(validTo.getTime()) || validTo.getTime() <= Date.now()) {
    throw new CmsError('Certificado vencido — renove na AC e importe novamente')
  }
  if (certificate.pfx.length === 0) {
    throw new CmsError('PFX do cofre esta vazio')
  }

  // 1. Carrega o PDF (falha clara para criptografado/corrompido).
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false, updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('encrypt')) {
      throw new CmsError('PDF protegido por senha nao e suportado')
    }
    throw new CmsError('Nao foi possivel ler o PDF (arquivo corrompido ou formato nao suportado)')
  }
  const pages = doc.getPages()
  if (pages.length === 0) {
    throw new CmsError('PDF sem paginas')
  }
  if (!Number.isInteger(page) || page < 1 || page > pages.length) {
    throw new CmsError(`Pagina ${page} fora do documento (1..${pages.length})`)
  }
  const targetPage = pages[page - 1]!

  const signedAt = input.signingTime ?? new Date()
  const existingSignatures = countExistingSignatures(doc)

  let placeholderBytes: Buffer
  if (existingSignatures > 0) {
    // Preserva assinaturas anteriores: atualizacao incremental append-only
    // (pdf-lib save() reescreveria e quebraria a(s) assinatura(s) previa(s)).
    placeholderBytes = await createIncrementalPlaceholder(Buffer.from(pdfBytes), {
      page,
      xPct,
      yPct,
      size,
      widthPct,
      heightPct,
      signerName: certificate.holderName,
      document: certificate.document,
      documentType: certificate.documentType,
      issuerDn: certificate.issuerDn,
      signedAt,
    })
  } else {
    // 2. Desenha o carimbo visual (informativo).
    const rect =
      widthPct !== undefined && heightPct !== undefined
        ? resolveCustomStampRect(targetPage, xPct, yPct, widthPct, heightPct)
        : resolveStampRect(targetPage, xPct, yPct, size)
    const fonts = await prepareFonts(doc)
    const seal = await prepareItiSeal(doc).catch(() => null)
    drawSignatureStamp({
      page: targetPage,
      x: rect.x,
      y: rect.y,
      size,
      widthPt: rect.width,
      heightPt: rect.height,
      signerName: certificate.holderName.slice(0, 80),
      documentLine: formatDocumentForStamp(certificate.document, certificate.documentType),
      signedAt,
      issuerLine: `Emissor: ${issuerShortName(certificate.issuerDn)}`,
      fonts,
      seal,
    })

    // 3. Insere o placeholder de assinatura (PAdES: SubFilter ETSI.CAdES.detached).
    pdflibAddPlaceholder({
      pdfDoc: doc,
      pdfPage: targetPage,
      reason: '',
      contactInfo: certificate.holderName.slice(0, 64),
      name: certificate.holderName.slice(0, 64),
      location: '',
      signingTime: signedAt,
      signatureLength: 16 * 1024,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      widgetRect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      appName: AURUMBIT_PLATFORM,
    })

    placeholderBytes = Buffer.from(await doc.save())
  }

  if (!placeholderBytes || placeholderBytes.length === 0) {
    throw new CmsError(
      'Falha ao preparar o PDF para assinatura (0 bytes) — o arquivo pode estar corrompido; escolha o PDF novamente',
    )
  }
  if (!placeholderBytes.includes(Buffer.from('/ByteRange', 'latin1'))) {
    throw new CmsError('Placeholder de assinatura nao encontrado no PDF preparado')
  }

  // 4. Assina (worker isolado ou processo principal, definido pelo chamador).
  const signer = new VaultPdfSigner(
    { pfx: certificate.pfx, password: certificate.password },
    tsaUrl,
    signedAt,
  )
  let signed: Buffer
  try {
    signed = await new SignPdf().sign(placeholderBytes, signer, signedAt)
  } catch (error) {
    if (error instanceof SignPdfError) {
      throw new CmsError(`Falha ao assinar o PDF: ${error.message}`)
    }
    throw error
  } finally {
    placeholderBytes.fill(0)
  }

  if (!signed || signed.length === 0) {
    throw new CmsError(
      'PDF assinado vazio (0 bytes) — a geracao falhou sem gravar arquivo; tente novamente',
    )
  }

  // 5. Autoverificação (todas as assinaturas): se falhar, NÃO devolve (fail-closed).
  const ok = await verifySignedPdf(signed).catch(() => false)
  if (!ok) {
    throw new CmsError(
      `Assinatura gerada, mas a verificacao falhou (assinado=${signed.length} bytes) — o arquivo nao foi salvo`,
    )
  }

  return {
    pdf: signed,
    sha256: createHash('sha256').update(signed).digest('hex').toUpperCase(),
    thumbprint: certificate.thumbprintSha256,
    tsaHost: signer.lastTsaHost ?? 'offline',
    signedAt: signedAt.toISOString(),
  }
}
