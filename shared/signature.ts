/**
 * Contrato compartilhado do modulo de Assinaturas Digitais (PAdES-B-T).
 *
 * Este arquivo e a fonte de verdade para os tipos trocados entre UI, IPC,
 * processo principal e worker. Nao importa codigo do Electron.
 */

/** Tamanhos predefinidos do carimbo (em pontos PDF, 1pt = 1/72 polegada). */
export const SIGNATURE_STAMP_SIZES = {
  small: { width: 200, height: 110 },
  medium: { width: 250, height: 128 },
  large: { width: 320, height: 150 },
} as const

/**
 * Tamanho natural de referencia (pt): no minimo este tamanho, todos os dados do
 * carimbo premium (nome, documento, emissor, data, selo ITI e QR) cabem sem
 * descarte de linhas. Abaixo dele o layout encolhe PROPORCIONALMENTE (como o
 * Adobe escala a aparencia do carimbo para dentro do retangulo desenhado) e
 * nunca vaza do quadro.
 */
export const SIGNATURE_STAMP_MIN = { width: 140, height: 104 } as const

/**
 * Piso absoluto do carimbo (pt) — semelhante ao Adobe Reader: o bloco adota
 * exatamente o tamanho desenhado pelo usuario; so impede retangulos
 * degenerados (invisivel / invalido no PDF). O conteudo e escalado para caber.
 */
export const SIGNATURE_STAMP_FLOOR = { width: 40, height: 16 } as const

/** Plataforma exibida nos metadados da assinatura. */
export const AURUMBIT_PLATFORM = 'AurumBit Portal'

/** Título exibido no cabeçalho do carimbo. */
export const STAMP_TITLE = 'ASSINADO DIGITALMENTE'

/** URL do validador oficial exibida no QR do carimbo. */
export const VALIDATE_ITI_URL = 'https://validar.iti.gov.br/'

export type SignatureStampSize = keyof typeof SIGNATURE_STAMP_SIZES

/** Arquivo de PDF escolhido pelo usuario e registrado no processo principal. */
export interface PickedPdfFile {
  /** Token opaco para as chamadas subsequentes (expira em 15 min). */
  token: string
  fileName: string
  /** Tamanho em bytes (<= 50 MB). */
  sizeBytes: number
  /** SHA-256 do arquivo no momento da escolha. */
  sha256: string
  pageCount: number
  /**
   * Dimensoes EXIBIDAS de cada pagina em pt, ja com cropBox∩mediaBox e
   * /Rotate aplicados (mesma geometria que o pdf.js renderiza na previa,
   * origem no canto superior-esquerdo do que o usuario ve). O frontend usa
   * estes numeros para escalar o arrasto — eles sao a fonte de verdade.
   * `rotation` = /Rotate normalizado (0|90|180|270); `viewBox` = cropBox∩mediaBox
   * em user space (origem inferior-esquerda).
   */
  pages: Array<{
    width: number
    height: number
    rotation?: 0 | 90 | 180 | 270
    viewBox?: { x: number; y: number; width: number; height: number }
  }>
  /** Expiração da sessão em memória (ISO). Permite ao renderer avisar e bloquear antes do TTL. */
  expiresAt?: string
}

/** Payload para renderizar a previa no renderer (bytes reais). */
export interface PdfPreviewData {
  token: string
  fileName: string
  sizeBytes: number
  data: ArrayBuffer
  pageCount: number
}

export interface SignPdfRequest {
  token: string
  /** Certificado A1 (no cofre) que assina. */
  certificateId: string
  /** Pagina 1-based. */
  page: number
  /**
   * Canto superior-esquerdo normalizado (0..1), origem no canto
   * SUPERIOR-ESQUERDO da pagina EXIBIDA (cropBox∩mediaBox, com /Rotate
   * aplicado — a mesma geometria usada na previa). O backend converte
   * para user space (origem inferior-esquerda, sem rotacao) ao desenhar.
   */
  xPct: number
  yPct: number
  size: SignatureStampSize
  /** Tamanho desenhado pelo usuario (fracoes da pagina). Prevalece sobre size. */
  widthPct?: number
  heightPct?: number
  /** @deprecated localizacao removida do carimbo; ignorado. */
  location?: string
  /** @deprecated motivo removido do carimbo; mantido por compatibilidade. */
  reason?: string
}

export interface SignPdfResult {
  /** Nome do arquivo gerado (<nome>-assinado[ (n)].pdf). */
  outputFileName: string
  /** Caminho completo do arquivo gravado. */
  outputPath: string
  sha256: string
  signedAt: string
  certificateThumbprint: string
  /** TSA usada no carimbo (host) ou 'offline' quando sem carimbo (PAdES-B). */
  tsaHost: string
}

export interface TsaTestResult {
  ok: boolean
  /** Mensagem para o operador (PT-BR, sem dados sensiveis). */
  message: string
  latencyMs: number
  tsaUrl: string
}

/** Status de certificados elegiveis para assinatura (PFX no cofre). */
export interface SignableCertificate {
  id: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  issuerDn: string
  subjectDn: string
  validTo: string
  thumbprintSha256: string
  daysUntilExpiry: number
}

export const SIGN_PDF_MAX_BYTES = 50 * 1024 * 1024
export const SIGN_PDF_PREVIEW_TTL_MS = 15 * 60 * 1000
