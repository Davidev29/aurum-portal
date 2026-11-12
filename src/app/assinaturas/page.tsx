'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSignature,
  FolderOpen,
  GripHorizontal,
  Loader2,
  Maximize,
  Minus,
  MonitorCheck,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import type { Certificate, Client } from '@shared/types'
import { certificateEffectiveValidToOf } from '@shared/certificate-renewal'
import {
  SIGNATURE_STAMP_FLOOR,
  SIGNATURE_STAMP_MIN,
  VALIDATE_ITI_URL,
  type PickedPdfFile,
  type PdfPreviewData,
  type SignPdfResult,
} from '@shared/signature'
import { aurumBitPortal, errorMessage, errorCode, isPdfSessionExpired } from '@/lib/api'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert } from '@/components/ui/alert'
import { useDebouncedValue } from '@/lib/hooks'
import { CertificateImportWizard } from '@/components/certificates/certificate-import-wizard'
import { WindowsCertificateDialog } from '@/components/certificates/windows-certificate-dialog'
import { toDataURL as qrcodeToDataURL } from 'qrcode'
import { formatBytes, formatDate, formatDateTime, initials } from '@/lib/utils'

// Fluxo: 1) Documento (PDF) -> 2) Certificado -> 3) Onde assinar -> 4) Revisar/assinar/concluir
const steps = ['Documento', 'Certificado', 'Posição da assinatura', 'Revisar e assinar']

// Fases exibidas enquanto o backend gera o PDF (a tela de sucesso só
// aparece quando o resultado de fato chega).
const SIGN_PHASES = ['Cifrando chave', 'Realizando assinatura digital', 'Criptografando documento']

function formatCpfCnpj(document: string | null, type: string): string {
  const digits = (document ?? '').replace(/\D+/g, '')
  if (type === 'CPF' && digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }
  if (type === 'CNPJ' && digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  }
  return digits || 'sem documento'
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function issuerShort(dn: string): string {
  const cn =
    dn
      .replace(/^.*?CN\s*=\s*/i, '')
      .split(',')[0]
      ?.trim() ?? dn
  return truncate(cn, 44)
}

function digitsOnly(value: string): string {
  return (value ?? '').replace(/\D+/g, '')
}

/** Itens de paginação com reticências: 1 … 4 5 6 … 12 (sem listas gigantes). */
function getPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', total]
  if (current >= total - 3)
    return [1, 'ellipsis-start', total - 4, total - 3, total - 2, total - 1, total]
  return [1, 'ellipsis-start', current - 1, current, current + 1, 'ellipsis-end', total]
}

/**
 * Elegibilidade para assinar com dados já instalados (Adobe/SERPRO-like):
 *  - PFX já contido na aplicação (cofre), OU
 *  - certificado instalado no Windows com chave privada (a assinatura usa
 *    a chave instalada, sem pedir arquivo/senha).
 * Em ambos os casos o certificado must estar válido (não vencido).
 */
function isEligibleCert(cert: Certificate, now = Date.now()): boolean {
  const hasVaultMaterial = cert.hasPfx
  const installedInWindows = cert.installed === true
  if (!hasVaultMaterial && !installedInWindows) return false
  if (cert.status === 'expired') return false
  const validToMs = new Date(cert.validTo).getTime()
  return Number.isFinite(validToMs) && validToMs > now
}

function certClientIds(cert: Certificate): Set<string> {
  const ids = new Set<string>()
  if (cert.clientId) ids.add(cert.clientId)
  for (const link of cert.clients ?? []) ids.add(link.id)
  return ids
}

/**
 * Módulo de assinaturas PDF (PAdES-B-T).
 *
 * Contrato de validação rigorosa (fail-closed no cliente e no backend):
 *  - Step 1 exige `picked` + `preview` do MESMO token e `!loadingPreview`.
 *  - Step 2 mostra apenas os certificados válidos (elegíveis: PFX no cofre
 *    OU instalado no Windows, + não vencido) em tabela paginada de uma
 *    linha por certificado com busca por nome e CPF/CNPJ — sem navegação
 *    para /certificates e sem pedir arquivo/senha quando já há
 *    certificados instalados (a assinatura usa os dados/chave já
 *    instalados, como Adobe/SERPRO; importação via diálogo só aparece
 *    quando não há nenhum certificado).
 *  - Step 3 exige página válida e posição finita 0..1.
 *  - Step 4 revalida tudo antes do IPC e trata códigos (`NOT_FOUND`/`CONFLICT` →
 *    recriar sessão; `CERTIFICATE_EXPIRED` → recarregar; `UNAVAILABLE`/TSA → orientar).
 *  - Troca de PDF é atômica (limpa preview antes, ignora respostas obsoletas, silencia
 *    cancelamento do diálogo nativo) para nunca assinar a página errada.
 */
export default function AssinaturasPage() {
  const [step, setStep] = React.useState<1 | 2 | 3 | 4>(1)
  const [certs, setCerts] = React.useState<Certificate[]>([])
  const [clients, setClients] = React.useState<Client[]>([])
  const [loadingCerts, setLoadingCerts] = React.useState(true)
  const [certError, setCertError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [clientFilter, setClientFilter] = React.useState<string>('all')
  const [selectedCertId, setSelectedCertId] = React.useState<string | null>(null)
  const [certPage, setCertPage] = React.useState(1)
  const [certPageSize, setCertPageSize] = React.useState(10)
  const [importOpen, setImportOpen] = React.useState(false)
  const [windowsOpen, setWindowsOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<PickedPdfFile | null>(null)
  const [preview, setPreview] = React.useState<PdfPreviewData | null>(null)
  const [loadingPreview, setLoadingPreview] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)
  // Carimbo em pontos PDF (pt) absolutos: fonte única da verdade.
  // O zoom nunca altera o tamanho físico do carimbo na página. Frações
  // (stampRect) são derivadas de stampPt para exibição e envio ao backend.
  // Começa SEM carimbo (fluxo Adobe): o usuario desenha o bloco sobre o local
  // da assinatura e o sistema coloca a assinatura dentro dele. Nao vem com um
  // quadro predeterminado grande que precise ser arrastado e diminuido.
  const [stampPt, setStampPt] = React.useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [zoomMode, setZoomMode] = React.useState<'width' | 'page' | 'custom'>('width')
  const [zoom, setZoom] = React.useState(1)
  // Texto exibido no controle de zoom, dependendo do modo ativo.
  const zoomDisplay = React.useMemo(() => {
    if (zoomMode === 'page') return 'Página'
    if (zoomMode === 'width') return 'Largura'
    return `${Math.round(zoom * 100)}%`
  }, [zoom, zoomMode])
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [signing, setSigning] = React.useState(false)
  const [signPhase, setSignPhase] = React.useState(0)
  const signTimersRef = React.useRef<number[]>([])
  const [result, setResult] = React.useState<SignPdfResult | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [renderingPage, setRenderingPage] = React.useState(false)
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 })
  const renderTokenRef = React.useRef(0)
  const renderTaskRef = React.useRef<any>(null)
  const [docToken, setDocToken] = React.useState<string | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const pageWrapperRef = React.useRef<HTMLDivElement | null>(null)
  const stampRef = React.useRef<HTMLDivElement | null>(null)
  const pdfDocRef = React.useRef<any>(null)
  const pdfDocTokenRef = React.useRef<string | null>(null)
  const pickRequestRef = React.useRef(0)
  const dragRef = React.useRef<{
    active: boolean
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
    startX: number
    startY: number
    startW: number
    startH: number
    startClientX: number
    startClientY: number
    // Rect da área da página capturado no início do arrasto: evita forçar
    // layout síncrono (getBoundingClientRect) a cada pointermove.
    wrapperRect: DOMRect | null
    raf: number | null
    pending: { x: number; y: number; w: number; h: number } | null
  }>({
    active: false,
    mode: 'move',
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
    startClientX: 0,
    startClientY: 0,
    wrapperRect: null,
    raf: null,
    pending: null,
  })
  // Elemento do bloco (box) que o usuario desenha sobre o PDF (fluxo Adobe).
  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const boxDragRef = React.useRef<{
    active: boolean
    startX: number
    startY: number
    startClientX: number
    startClientY: number
    wrapperRect: DOMRect | null
    raf: number | null
    pending: { x: number; y: number; w: number; h: number } | null
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startClientX: 0,
    startClientY: 0,
    wrapperRect: null,
    raf: null,
    pending: null,
  })
  // Arrastar (pan) da vista do PDF: clique simples move o carimbo; arrastar move a vista.
  const panRef = React.useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startScrollLeft: number
    startScrollTop: number
    moved: boolean
  } | null>(null)
  // Âncora do cursor para o zoom Ctrl+scroll (aplicada após o render).
  const zoomAnchorRef = React.useRef<{
    px: number
    py: number
    cx: number
    cy: number
    prevW: number
    prevH: number
  } | null>(null)

  const selectedCert = React.useMemo(
    () => certs.find((c) => c.id === selectedCertId) ?? null,
    [certs, selectedCertId],
  )

  const clientById = React.useMemo(() => new Map(clients.map((c) => [c.id, c] as const)), [clients])

  const selectedClientName = React.useMemo(() => {
    if (!selectedCert) return null
    // Prefere o cliente principal do grupo exibido; fallback para o primeiro vínculo.
    const linked = [...certClientIds(selectedCert)]
      .map((id) => clientById.get(id))
      .filter(Boolean) as Client[]
    if (linked.length > 0) return linked[0]!.name
    if (selectedCert.clients?.[0]?.name) return selectedCert.clients[0].name
    return null
  }, [selectedCert, clientById])

  // Dimensões (pt) da página atual — base para preview == PDF final.
  const currentPageSizePt = React.useMemo(() => {
    const pages = picked?.pages
    if (!pages || pages.length === 0) return undefined
    return pages[Math.min(Math.max(currentPage - 1, 0), pages.length - 1)]
  }, [picked, currentPage])

  // Piso absoluto do carimbo em pontos PDF (pt): semelhante ao Adobe Reader,
  // o bloco adota EXATAMENTE o retangulo desenhado pelo usuario — so impede
  // retangulos degenerados invisiveis/invalidos no PDF. O conteudo encolhe
  // proporcionalmente (nao o bloco). O zoom nunca afeta isso.
  const minPt = React.useMemo(() => {
    const pageW = currentPageSizePt?.width ?? 595
    const pageH = currentPageSizePt?.height ?? 842
    return {
      w: Math.min(SIGNATURE_STAMP_FLOOR.width, pageW * 0.92),
      h: Math.min(SIGNATURE_STAMP_FLOOR.height, pageH * 0.92),
    }
  }, [currentPageSizePt])

  // Frações da página derivadas dos pt absolutos — usadas na exibição (CSS %) e no backend.
  // O bloco adota exatamente o tamanho desenhado; o piso fracionário só impede
  // valores degenerados. Quando ainda não há carimbo (stampPt == null) retorna
  // zeros -> stampValid fica falso e o usuario e obrigado a desenhar o bloco.
  const stampRect = React.useMemo(() => {
    if (!stampPt) return { x: 0, y: 0, w: 0, h: 0 }
    const pageW = currentPageSizePt?.width ?? 595
    const pageH = currentPageSizePt?.height ?? 842
    const wFrac = Math.min(Math.max(stampPt.w / pageW, 0.005), 0.92)
    const hFrac = Math.min(Math.max(stampPt.h / pageH, 0.005), 0.92)
    const xFrac = Math.min(Math.max(stampPt.x / pageW, 0), Math.max(0, 1 - wFrac))
    const yFrac = Math.min(Math.max(stampPt.y / pageH, 0), Math.max(0, 1 - hFrac))
    return { x: xFrac, y: yFrac, w: wFrac, h: hFrac }
  }, [stampPt, currentPageSizePt])

  // Mínimo (piso absoluto) em frações para validação (derivado dos pt mínimos).
  const minFracs = React.useMemo(() => {
    const pageW = currentPageSizePt?.width ?? 595
    const pageH = currentPageSizePt?.height ?? 842
    return {
      w: Math.min(Math.max(minPt.w / pageW, 0.005), 0.9),
      h: Math.min(Math.max(minPt.h / pageH, 0.005), 0.9),
    }
  }, [minPt, currentPageSizePt])

  // --- Validações de avanço (uma por transição) --------------------------------
  const previewMatchesPicked = React.useMemo(
    () => Boolean(picked && preview && preview.token === picked.token),
    [picked, preview],
  )
  const canAdvanceFromDoc = Boolean(
    picked && previewMatchesPicked && !loadingPreview && picked.pageCount > 0,
  )
  const canAdvanceFromCert = Boolean(selectedCert && isEligibleCert(selectedCert))
  const stampValid = Boolean(
    Number.isFinite(stampRect.x) &&
    Number.isFinite(stampRect.y) &&
    Number.isFinite(stampRect.w) &&
    Number.isFinite(stampRect.h) &&
    stampRect.x >= 0 &&
    stampRect.y >= 0 &&
    stampRect.w >= minFracs.w &&
    stampRect.h >= minFracs.h &&
    stampRect.x + stampRect.w <= 1.0001 &&
    stampRect.y + stampRect.h <= 1.0001,
  )
  const pageValid = Boolean(picked && currentPage >= 1 && currentPage <= picked.pageCount)
  const canAdvanceFromStamp = Boolean(
    canAdvanceFromDoc && canAdvanceFromCert && pageValid && stampValid,
  )
  const canSign = Boolean(
    canAdvanceFromDoc && canAdvanceFromCert && pageValid && stampValid && !signing,
  )

  // Tabela paginada: apenas certificados válidos (elegíveis), sem cartões grandes.
  const eligibleCerts = React.useMemo(() => certs.filter((c) => isEligibleCert(c)), [certs])
  const totalCerts = certs.length
  const totalEligible = eligibleCerts.length
  const hiddenCount = totalCerts - totalEligible

  const visibleCerts = React.useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    const digitsQuery = digitsOnly(debouncedSearch)
    return eligibleCerts
      .filter((cert) => clientFilter === 'all' || certClientIds(cert).has(clientFilter))
      .filter((cert) => {
        if (!query) return true
        // Busca por nome / cliente / emissor (texto) ou por CPF/CNPJ
        // (com ou sem formatação: "12345678909" casa com "123.456.789-09").
        const hay = [
          cert.holderName,
          cert.document ?? '',
          cert.issuerDn,
          ...(cert.clients ?? []).map((c) => c.name),
        ]
          .join(' ')
          .toLowerCase()
        if (hay.includes(query)) return true
        if (digitsQuery.length >= 3 && digitsOnly(cert.document ?? '').includes(digitsQuery)) {
          return true
        }
        return false
      })
      .sort((a, b) => a.holderName.localeCompare(b.holderName, 'pt-BR'))
  }, [eligibleCerts, debouncedSearch, clientFilter])

  const certTotalPages = Math.max(1, Math.ceil(visibleCerts.length / certPageSize))
  const paginatedCerts = React.useMemo(() => {
    const start = (certPage - 1) * certPageSize
    return visibleCerts.slice(start, start + certPageSize)
  }, [visibleCerts, certPage, certPageSize])
  const certRangeStart = visibleCerts.length === 0 ? 0 : (certPage - 1) * certPageSize + 1
  const certRangeEnd = Math.min(visibleCerts.length, certPage * certPageSize)
  const certPageItems = React.useMemo(
    () => getPageItems(Math.min(certPage, certTotalPages), certTotalPages),
    [certPage, certTotalPages],
  )

  // Volta para a primeira página quando busca, filtro ou tamanho mudam;
  // corrige a página se o resultado encolher abaixo dela.
  React.useEffect(() => {
    setCertPage(1)
  }, [debouncedSearch, clientFilter, certPageSize])
  React.useEffect(() => {
    if (certPage > certTotalPages) setCertPage(certTotalPages)
  }, [certPage, certTotalPages])

  // Contagem de elegíveis por cliente (filtro por cliente).
  const eligibleByClient = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const cert of eligibleCerts) {
      for (const id of certClientIds(cert)) {
        if (clientById.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return counts
  }, [eligibleCerts, clientById])

  const loadCertsAndClients = React.useCallback(async () => {
    try {
      const [list, activeClients] = await Promise.all([
        aurumBitPortal().certificates.list(),
        aurumBitPortal()
          .clients.list({ status: 'active' })
          .catch(() => [] as Client[]),
      ])
      // Mantém TODOS os certificados da aplicação na lista: elegíveis
      // selecionáveis, não elegíveis visíveis com motivo. Filtrar aqui
      // escondia PFX já importados e forçava a ida a /certificates.
      setCerts(list)
      setClients(activeClients)
      setCertError(null)
      // Validação rigorosa: seleção explícita e ainda elegível.
      setSelectedCertId((current) => {
        if (current && list.some((c) => c.id === current && isEligibleCert(c))) return current
        return null
      })
    } catch (error) {
      setCertError(errorMessage(error))
      setCerts([])
    } finally {
      setLoadingCerts(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await loadCertsAndClients()
    })()
    return () => {
      cancelled = true
    }
  }, [loadCertsAndClients])

  // Mantém a lista fresca quando certificados/clientes mudam em outra janela.
  React.useEffect(() => {
    const off1 = aurumBitPortal().events.onCertificatesChanged(() => {
      setLoadingCerts(true)
      void loadCertsAndClients()
    })
    const off2 = aurumBitPortal().events.onClientsChanged(() => {
      setLoadingCerts(true)
      void loadCertsAndClients()
    })
    return () => {
      off1()
      off2()
    }
  }, [loadCertsAndClients])

  // QRCode da previa (mesma URL do PDF: validar.iti.gov.br).
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = await qrcodeToDataURL(VALIDATE_ITI_URL, {
          errorCorrectionLevel: 'M',
          margin: 0,
          width: 160,
        })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        // previa continua sem QR se a geracao falhar
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Mantem o retangulo do carimbo dentro da pagina, nunca abaixo do minimo premium.
  // Trabalha em pt absolutos: o zoom nunca altera o tamanho fisico do carimbo.
  // Nada acontece enquanto stampPt for null (carimbo ainda nao desenhado).
  React.useEffect(() => {
    if (!stampPt) return
    setStampPt((prev) => {
      if (!prev) return prev
      const pageW = currentPageSizePt?.width ?? 595
      const pageH = currentPageSizePt?.height ?? 842
      const w = Math.min(Math.max(prev.w, minPt.w), pageW * 0.92)
      const h = Math.min(Math.max(prev.h, minPt.h), pageH * 0.92)
      const x = Math.min(Math.max(prev.x, 0), Math.max(0, pageW - w))
      const y = Math.min(Math.max(prev.y, 0), Math.max(0, pageH - h))
      // Sem mudança real: devolve a MESMA referência para o React não re-renderizar.
      // Retornar um objeto novo sempre (mesmo com valores idênticos) realimentava
      // este efeito -> setState -> re-render -> efeito -> loop infinito
      // ("Maximum update depth exceeded").
      if (x === prev.x && y === prev.y && w === prev.w && h === prev.h) return prev
      return { x, y, w, h }
    })
  }, [stampPt, currentPageSizePt, minPt])

  // Mantém a página dentro do documento quando a prévia muda.
  React.useEffect(() => {
    if (picked && (currentPage < 1 || currentPage > picked.pageCount)) {
      setCurrentPage(1)
    }
  }, [picked, currentPage])

  // Tamanho responsivo da área da prévia (re-render em resize sem reparse).
  // Mede o contentRect (sem scrollbar) para não realimentar o loop
  // tamanho -> scrollbar -> tamanho.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (entries: ResizeObserverEntry[]) => {
      const rect = entries[0]?.contentRect ?? el.getBoundingClientRect()
      setContainerSize((prev) =>
        Math.abs(prev.width - rect.width) > 2 || Math.abs(prev.height - rect.height) > 2
          ? { width: rect.width, height: rect.height }
          : prev,
      )
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [step])

  // Carrega/abre o PDF UMA vez por token (evita reparse a cada página).
  // Aguarda o cancelamento completo de renders pendentes antes de destruir
  // o documento anterior, evitando o erro 'generationNumber' do pdf.js.
  React.useEffect(() => {
    if (!preview || !previewMatchesPicked) return
    if (pdfDocRef.current && pdfDocTokenRef.current === preview.token) {
      setDocToken(preview.token)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist')
        if (pdfjs.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
        }
        const loadingTask = pdfjs.getDocument({ data: preview.data.slice(0) })
        const doc = await loadingTask.promise
        if (cancelled) {
          try {
            await doc.destroy?.()
          } catch {
            // ignora
          }
          return
        }
        // Aguarda qualquer render anterior ser cancelado antes de trocar o documento.
        const prevTask = renderTaskRef.current
        if (prevTask) {
          try {
            prevTask.cancel()
            await prevTask.promise
          } catch {
            // RenderingCancelledException é esperado.
          }
          if (renderTaskRef.current === prevTask) renderTaskRef.current = null
        }
        try {
          await pdfDocRef.current?.destroy?.()
        } catch {
          // ignore
        }
        pdfDocRef.current = doc
        pdfDocTokenRef.current = preview.token
        setDocToken(preview.token)
      } catch {
        if (!cancelled) toast.error('Falha ao abrir a pré-visualização do PDF.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preview, previewMatchesPicked])

  // Limpa temporizadores de assinatura pendentes ao desmontar.
  React.useEffect(() => {
    return () => {
      signTimersRef.current.forEach((t) => window.clearTimeout(t))
      signTimersRef.current = []
      renderTaskRef.current?.cancel()
    }
  }, [])

  // Limpa o documento carregado ao desmontar.
  React.useEffect(() => {
    return () => {
      void (async () => {
        try {
          await pdfDocRef.current?.destroy?.()
        } catch {
          // ignore
        }
      })()
      pdfDocRef.current = null
      pdfDocTokenRef.current = null
    }
  }, [])

  const zoomIn = React.useCallback(() => {
    setZoomMode('custom')
    setZoom((z) => Math.min(4, z * 1.25))
  }, [])
  const zoomOut = React.useCallback(() => {
    setZoomMode('custom')
    setZoom((z) => Math.max(0.5, z / 1.25))
  }, [])
  const zoomFitWidth = React.useCallback(() => {
    setZoomMode('width')
    setZoom(1)
    containerRef.current?.scrollTo({ top: 0, left: 0 })
  }, [])
  const zoomFitPage = React.useCallback(() => {
    setZoomMode('page')
    setZoom(1)
    containerRef.current?.scrollTo({ top: 0, left: 0 })
  }, [])

  // Ao trocar de página ou modo de zoom, volta vista ao topo do documento.
  React.useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0 })
  }, [currentPage, zoomMode])

  // Ctrl+scroll = zoom (o ponto sob o cursor permanece sob o cursor).
  // Listener nativo não-passivo para poder dar preventDefault.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const canvas = canvasRef.current
      zoomAnchorRef.current = {
        px: event.clientX - rect.left + el.scrollLeft,
        py: event.clientY - rect.top + el.scrollTop,
        cx: event.clientX - rect.left,
        cy: event.clientY - rect.top,
        prevW: canvas?.offsetWidth ?? 0,
        prevH: canvas?.offsetHeight ?? 0,
      }
      setZoomMode('custom')
      setZoom((z) => Math.min(4, Math.max(0.5, z * (event.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [step])

  // Renderiza a página atual a partir do documento já aberto.
  // Renders são SERIALIZADOS: o anterior é cancelado e aguardado antes de
  // tocar no canvas (o pdf.js proíbe renders sobrepostos no mesmo canvas e
  // redimensionar no meio corrompe a imagem).
  // - Modo 'page': ajusta a largura E altura (página inteira visível).
  // - Modo 'width' (default): ajusta à LARGURA — texto fica grande e legível.
  // - Modo 'custom': escala livre via zoom.
  React.useEffect(() => {
    if (!preview || !previewMatchesPicked || !docToken || !canvasRef.current) return
    const doc = pdfDocRef.current
    if (!doc) return
    // Segurança: não renderiza se o documento foi destruído/trocado.
    if (pdfDocTokenRef.current !== docToken) return
    if (containerSize.width <= 0 || containerSize.height <= 0) return
    const token = ++renderTokenRef.current
    let cancelled = false
    void (async () => {
      const prevTask = renderTaskRef.current
      if (prevTask) {
        try {
          prevTask.cancel()
          await prevTask.promise
        } catch {
          // RenderingCancelledException é esperado ao cancelar.
        }
        if (renderTaskRef.current === prevTask) renderTaskRef.current = null
      }
      if (cancelled || token !== renderTokenRef.current) return
      setRenderingPage(true)
      try {
        const page = await doc.getPage(currentPage)
        if (cancelled || token !== renderTokenRef.current) return
        if (!page) {
          toast.error('Página do PDF não encontrada.')
          return
        }
        const availW = Math.max(120, containerSize.width - 32)
        const availH = Math.max(120, containerSize.height - 32)
        const baseViewport = page.getViewport({ scale: 1 })
        let fitScale: number
        if (zoomMode === 'page') {
          fitScale = Math.min(availW / baseViewport.width, availH / baseViewport.height)
        } else {
          // 'width' ou 'custom': ajusta apenas pela largura (melhor leitura).
          fitScale = availW / baseViewport.width
        }
        // No modo 'width' o fator 'zoom' funciona como multiplicador da base
        // de ajuste; em 'page' o fitScale já cabe a página toda.
        const scale = zoomMode === 'page' ? fitScale : fitScale * zoom
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas || cancelled || token !== renderTokenRef.current) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
        if (cancelled || token !== renderTokenRef.current) return
        // Nota: a camada de anotações do pdf.js NÃO é renderizada aqui.
        // Ela faz replaceChildren() no elemento pai e destrói o canvas, o
        // bloco de desenho e o carimbo (posicionamento quebrado/invisível).
        // As anotações existentes continuam intactas no arquivo assinado;
        // apenas não são pintadas por cima da prévia.
      } catch (error) {
        if (cancelled || token !== renderTokenRef.current) return
        const name = error instanceof Error ? error.name : ''
        if (name === 'RenderingCancelledException') return
        toast.error('Falha ao renderizar a previa do PDF.')
      } finally {
        // Zoom Ctrl+scroll: mantém o ponto sob o cursor no mesmo lugar.
        const anchor = zoomAnchorRef.current
        const canvas = canvasRef.current
        const container = containerRef.current
        if (anchor && canvas && container && anchor.prevW > 0 && anchor.prevH > 0) {
          zoomAnchorRef.current = null
          const sx = canvas.offsetWidth / anchor.prevW
          const sy = canvas.offsetHeight / anchor.prevH
          container.scrollLeft = anchor.px * sx - anchor.cx
          container.scrollTop = anchor.py * sy - anchor.cy
        }
        if (!cancelled && token === renderTokenRef.current) setRenderingPage(false)
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [preview, currentPage, previewMatchesPicked, docToken, containerSize, zoom, zoomMode])

  const onPickFile = async () => {
    const requestId = ++pickRequestRef.current
    setLoadingPreview(true)
    try {
      const pickedFile = await aurumBitPortal().pdf.pickFile()
      if (requestId !== pickRequestRef.current) return
      // Atômico: troca de PDF limpa preview anterior ANTES do novo loadPreview.
      setPreview(null)
      setPicked(pickedFile)
      const data = await aurumBitPortal().pdf.loadPreview(pickedFile.token)
      if (requestId !== pickRequestRef.current) return
      if (data.token !== pickedFile.token) {
        setPicked(null)
        setPreview(null)
        toast.error('Documento inconsistente — escolha o PDF novamente.')
        return
      }
      setPreview(data)
      setDocToken(null)
      setCurrentPage(1)
      setZoom(1)
      setZoomMode('width')
      setStampPt(null)
      setResult(null)
    } catch (error) {
      if (requestId !== pickRequestRef.current) return
      const msg = errorMessage(error)
      // Cancelamento do diálogo nativo não é erro.
      if (/cancelada/i.test(msg)) return
      setPicked(null)
      setPreview(null)
      toast.error(msg)
    } finally {
      if (requestId === pickRequestRef.current) setLoadingPreview(false)
    }
  }

  const stampPctToStyle = React.useMemo(
    () => ({
      left: `${stampRect.x * 100}%`,
      top: `${stampRect.y * 100}%`,
      width: `${stampRect.w * 100}%`,
      height: `${stampRect.h * 100}%`,
      willChange: 'left, top, width, height',
    }),
    [stampRect],
  )

  // Zoom da prévia: px por ponto PDF aplicado atualmente pelo render, derivado
  // da mesma fórmula usada no efeito de renderização (modo/zoom/recipiente).
  // Usado apenas para escalar o CONTEÚDO do carimbo na prévia.
  const previewPxPerPt = React.useMemo(() => {
    const page = currentPageSizePt
    if (!page) return 1.3333
    const availW = Math.max(120, containerSize.width - 32)
    const availH = Math.max(120, containerSize.height - 32)
    if (zoomMode === 'page') return Math.min(availW / page.width, availH / page.height)
    return (availW / page.width) * zoom
  }, [currentPageSizePt, containerSize, zoomMode, zoom])

  // Estágio interno do carimbo na prévia: LAYOUT de design fixo (o tamanho
  // natural 140x104 pt em px CSS 96dpi), escalado uniformemente via `zoom`
  // para o tamanho REAL do bloco na tela — como o Adobe escala a aparência
  // para dentro do retângulo desenhado. Nada estoura nem é cortado.
  const previewStageZoom = React.useMemo(() => {
    if (!stampPt) return 1
    const naturalW = SIGNATURE_STAMP_MIN.width * (4 / 3)
    const naturalH = SIGNATURE_STAMP_MIN.height * (4 / 3)
    const stampPxW = stampPt.w * previewPxPerPt
    const stampPxH = stampPt.h * previewPxPerPt
    return Math.max(0.02, Math.min(stampPxW / naturalW, stampPxH / naturalH))
  }, [stampPt, previewPxPerPt])

  // Aplica estilos diretamente no DOM durante o arrasto — sem re-render do React
  // a cada frame. Isso elimina o lag de interação do mouse.
  // recebe pt absolutos e converte para % com base no tamanho da pagina atual.
  const applyStampDom = React.useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const el = stampRef.current
      if (!el) return
      const pageW = currentPageSizePt?.width ?? 595
      const pageH = currentPageSizePt?.height ?? 842
      el.style.left = `${(rect.x / pageW) * 100}%`
      el.style.top = `${(rect.y / pageH) * 100}%`
      el.style.width = `${(rect.w / pageW) * 100}%`
      el.style.height = `${(rect.h / pageH) * 100}%`
    },
    [currentPageSizePt],
  )

  // Clamp em pt absolutos: mantem o carimbo dentro da pagina e acima do minimo premium.
  // O zoom nunca entra neste calculo, entao o tamanho fisico e estavel em qualquer escala.
  const clampPt = React.useCallback(
    (
      x: number,
      y: number,
      w: number,
      h: number,
      fixed?: { right?: number; bottom?: number },
    ): { x: number; y: number; w: number; h: number } => {
      const pageW = currentPageSizePt?.width ?? 595
      const pageH = currentPageSizePt?.height ?? 842
      let nextW = Math.min(Math.max(w, minPt.w), pageW * 0.92)
      let nextH = Math.min(Math.max(h, minPt.h), pageH * 0.92)
      if (fixed?.right !== undefined) nextW = Math.min(nextW, fixed.right)
      if (fixed?.bottom !== undefined) nextH = Math.min(nextH, fixed.bottom)
      let nextX = Math.min(Math.max(x, 0), Math.max(0, pageW - nextW))
      let nextY = Math.min(Math.max(y, 0), Math.max(0, pageH - nextH))
      if (fixed?.right !== undefined) nextX = fixed.right - nextW
      if (fixed?.bottom !== undefined) nextY = fixed.bottom - nextH
      return { x: nextX, y: nextY, w: nextW, h: nextH }
    },
    [minPt, currentPageSizePt],
  )

  // Rect da área da página: usa o valor cacheado no início do arrasto
  // (sem forçar reflow por pointermove) ou mede ao vivo fora do arrasto.
  const getWrapperRect = React.useCallback((): DOMRect | null => {
    const wrapper = pageWrapperRef.current
    if (!wrapper) return null
    return (
      dragRef.current.wrapperRect ??
      boxDragRef.current.wrapperRect ??
      wrapper.getBoundingClientRect()
    )
  }, [])

  const rectFromClient = React.useCallback(
    (
      clientX: number,
      clientY: number,
      start: { x: number; y: number; w: number; h: number },
      mode: 'move' | 'nw' | 'ne' | 'sw' | 'se',
    ): { x: number; y: number; w: number; h: number } | null => {
      const rect = getWrapperRect()
      if (!rect) return null
      if (rect.width <= 0 || rect.height <= 0) return null
      const page = currentPageSizePt
      if (!page) return null
      const scaleX = page.width / rect.width
      const scaleY = page.height / rect.height
      const dx = (clientX - dragRef.current.startClientX) * scaleX
      const dy = (clientY - dragRef.current.startClientY) * scaleY
      if (mode === 'move') {
        return clampPt(start.x + dx, start.y + dy, start.w, start.h)
      }
      if (mode === 'se') {
        return clampPt(start.x, start.y, start.w + dx, start.h + dy)
      }
      if (mode === 'nw') {
        return clampPt(start.x + dx, start.y + dy, start.w - dx, start.h - dy, {
          right: start.x + start.w,
          bottom: start.y + start.h,
        })
      }
      if (mode === 'ne') {
        return clampPt(start.x, start.y + dy, start.w + dx, start.h - dy, {
          bottom: start.y + start.h,
        })
      }
      return clampPt(start.x + dx, start.y, start.w - dx, start.h + dy, {
        right: start.x + start.w,
      })
    },
    [clampPt, currentPageSizePt, getWrapperRect],
  )

  const ptFromClient = React.useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = getWrapperRect()
      if (!rect) return null
      if (rect.width <= 0 || rect.height <= 0) return null
      const page = currentPageSizePt
      if (!page) return null
      const scaleX = page.width / rect.width
      const scaleY = page.height / rect.height
      const stampW = stampPt?.w ?? 0
      const stampH = stampPt?.h ?? 0
      const x = (clientX - rect.left) * scaleX - stampW / 2
      const y = (clientY - rect.top) * scaleY - stampH / 2
      const clamped = clampPt(x, y, stampW, stampH)
      return { x: clamped.x, y: clamped.y }
    },
    [stampPt, clampPt, currentPageSizePt, getWrapperRect],
  )

  // Coordenadas absolutas (pt) da pagina a partir do ponteiro do mouse/touch,
  // sem centralizar no carimbo. Usada para desenhar o bloco do fluxo Adobe.
  const pagePtFromClient = React.useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = getWrapperRect()
      if (!rect) return null
      if (rect.width <= 0 || rect.height <= 0) return null
      const page = currentPageSizePt
      if (!page) return null
      const scaleX = page.width / rect.width
      const scaleY = page.height / rect.height
      const x = (clientX - rect.left) * scaleX
      const y = (clientY - rect.top) * scaleY
      return { x, y }
    },
    [currentPageSizePt, getWrapperRect],
  )

  // Aplica estilos diretamente no DOM durante o desenho do bloco (sem re-render
  // do React a cada frame). recebe pt absolutos e converte para % da pagina.
  const applyBoxDom = React.useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const el = boxRef.current
      if (!el) return
      const pageW = currentPageSizePt?.width ?? 595
      const pageH = currentPageSizePt?.height ?? 842
      el.style.left = `${(rect.x / pageW) * 100}%`
      el.style.top = `${(rect.y / pageH) * 100}%`
      el.style.width = `${(Math.max(rect.w, 0) / pageW) * 100}%`
      el.style.height = `${(Math.max(rect.h, 0) / pageH) * 100}%`
    },
    [currentPageSizePt],
  )

  // Durante o arrasto: atualiza o DOM diretamente (sem re-render do React)
  // para evitar lag. O estado do React e sincronizado somente em commitDrag.
  const scheduleStampPt = React.useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      dragRef.current.pending = rect
      if (dragRef.current.raf !== null) return
      dragRef.current.raf = window.requestAnimationFrame(() => {
        dragRef.current.raf = null
        const pending = dragRef.current.pending
        if (pending) applyStampDom(pending)
      })
    },
    [applyStampDom],
  )

  const startDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
      event.preventDefault()
      event.stopPropagation()
      if (!stampPt) return
      const el = stampRef.current
      if (el) el.setPointerCapture(event.pointerId)
      const wrapper = pageWrapperRef.current
      dragRef.current.wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null
      dragRef.current.active = true
      dragRef.current.mode = mode
      dragRef.current.startX = stampPt.x
      dragRef.current.startY = stampPt.y
      dragRef.current.startW = stampPt.w
      dragRef.current.startH = stampPt.h
      dragRef.current.startClientX = event.clientX
      dragRef.current.startClientY = event.clientY
      dragRef.current.pending = null
      setDragging(true)
    },
    [stampPt],
  )

  const commitDrag = React.useCallback(() => {
    const pending = dragRef.current.pending
    if (pending) {
      setStampPt(pending)
      dragRef.current.pending = null
    }
    dragRef.current.wrapperRect = null
    if (dragRef.current.raf !== null) {
      window.cancelAnimationFrame(dragRef.current.raf)
      dragRef.current.raf = null
    }
  }, [])

  const handleStampPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!stampPt) return
    startDrag(event, 'move')
    event.currentTarget.style.cursor = 'grabbing'
  }

  const handleResizePointerDown =
    (mode: 'nw' | 'ne' | 'sw' | 'se') => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      startDrag(event, mode)
    }

  const handleStampPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const { mode, startX, startY, startW, startH } = dragRef.current
    const next = rectFromClient(
      event.clientX,
      event.clientY,
      { x: startX, y: startY, w: startW, h: startH },
      mode,
    )
    if (next) scheduleStampPt(next)
  }

  const handleStampPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false
    try {
      stampRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // captura já liberada
    }
    event.currentTarget.style.cursor = 'grab'
    commitDrag()
    setDragging(false)
  }

  const handleStampPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false
    commitDrag()
    setDragging(false)
    event.currentTarget.style.cursor = 'grab'
  }

  // Arraste no fundo da prévia desenha o bloco de assinatura (fluxo Adobe).
  // Clique simples (sem arrastar) move o carimbo para o ponto, tratado em
  // handlePanPointerEnd quando nao houve desenho de bloco.
  const handlePagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    if ((event.target as HTMLElement).closest('[data-stamp]')) return
    if ((event.target as HTMLElement).closest('[data-resize]')) return
    const wrapper = pageWrapperRef.current
    if (!wrapper) return
    event.preventDefault()
    wrapper.setPointerCapture(event.pointerId)
    boxDragRef.current.active = true
    boxDragRef.current.startClientX = event.clientX
    boxDragRef.current.startClientY = event.clientY
    boxDragRef.current.wrapperRect = wrapper.getBoundingClientRect()
    const startPt = pagePtFromClient(event.clientX, event.clientY)
    if (startPt) {
      boxDragRef.current.startX = startPt.x
      boxDragRef.current.startY = startPt.y
    } else {
      boxDragRef.current.startX = 0
      boxDragRef.current.startY = 0
    }
    boxDragRef.current.pending = null
    const el = boxRef.current
    if (el) {
      el.style.display = 'block'
      el.style.cursor = 'crosshair'
      applyBoxDom({ x: boxDragRef.current.startX, y: boxDragRef.current.startY, w: 0, h: 0 })
    }
    wrapper.style.cursor = 'crosshair'
  }

  const handlePanPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // Desenho do bloco de assinatura: arraste no fundo cria o bloco (fluxo Adobe).
    if (boxDragRef.current.active) {
      const pt = pagePtFromClient(event.clientX, event.clientY)
      if (!pt) return
      const dx = pt.x - boxDragRef.current.startX
      const dy = pt.y - boxDragRef.current.startY
      const x = Math.min(boxDragRef.current.startX, boxDragRef.current.startX + dx)
      const y = Math.min(boxDragRef.current.startY, boxDragRef.current.startY + dy)
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      boxDragRef.current.pending = { x, y, w, h }
      if (boxDragRef.current.raf !== null) return
      boxDragRef.current.raf = window.requestAnimationFrame(() => {
        boxDragRef.current.raf = null
        const pending = boxDragRef.current.pending
        if (pending) applyBoxDom(pending)
      })
      return
    }
  }

  const handlePanPointerEnd = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      panRef.current = null
      const container = containerRef.current
      if (container) container.style.cursor = ''
      try {
        container?.releasePointerCapture(event.pointerId)
      } catch {
        // captura ja liberada
      }
    }
    // Finaliza o desenho do bloco (fluxo Adobe): o usuario arrastou e soltou.
    if (boxDragRef.current.active) {
      boxDragRef.current.active = false
      if (boxDragRef.current.raf !== null) {
        window.cancelAnimationFrame(boxDragRef.current.raf)
        boxDragRef.current.raf = null
      }
      const pending = boxDragRef.current.pending
      boxDragRef.current.pending = null
      const el = boxRef.current
      if (el) {
        el.style.display = 'none'
        el.style.cursor = ''
      }
      boxDragRef.current.wrapperRect = null
      const wrapper = pageWrapperRef.current
      if (wrapper) wrapper.style.cursor = ''
      if (pending && !cancelled && (pending.w >= 4 || pending.h >= 4)) {
        // Retangulo desenhado adotado como o tamanho do carimbo (igual ao
        // Adobe): sem inflar para um minimo grande. Apenas o piso absoluto
        // contra retangulos degenerados; o conteudo encolhe proporcionalmente.
        const nextW = Math.max(pending.w, minPt.w)
        const nextH = Math.max(pending.h, minPt.h)
        const final = clampPt(pending.x, pending.y, nextW, nextH)
        setStampPt(final)
        return
      }
      // Arraste degenerado (<4 pt nas duas direções) cai no tratamento de
      // clique simples abaixo — nunca cria um carimbo por engano.
      if (!cancelled && stampPt && pending) {
        // considera um clique no ponto onde soltou
        const pt = ptFromClient(event.clientX, event.clientY)
        if (pt) {
          const next = clampPt(pt.x, pt.y, stampPt.w, stampPt.h)
          setStampPt(next)
        }
        return
      }
      if (pending || cancelled) return
    }
    // Clique simples (sem arrastar): move o carimbo para o ponto, se ja houver carimbo.
    if (!cancelled && stampPt) {
      const pt = ptFromClient(event.clientX, event.clientY)
      if (pt) {
        const next = clampPt(pt.x, pt.y, stampPt.w, stampPt.h)
        setStampPt(next)
      }
    }
  }

  const handleStampKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!stampPt) return
    const stepSize = event.shiftKey ? 10 : 4 // pontos PDF
    let dx = 0
    let dy = 0
    switch (event.key) {
      case 'ArrowLeft':
        dx = -stepSize
        break
      case 'ArrowRight':
        dx = stepSize
        break
      case 'ArrowUp':
        dy = -stepSize
        break
      case 'ArrowDown':
        dy = stepSize
        break
      default:
        return
    }
    event.preventDefault()
    let next: { x: number; y: number; w: number; h: number }
    if (event.altKey) {
      // Alt + setas redimensiona (canto SE).
      next = clampPt(stampPt.x, stampPt.y, stampPt.w + dx, stampPt.h + dy)
    } else {
      next = clampPt(stampPt.x + dx, stampPt.y + dy, stampPt.w, stampPt.h)
    }
    setStampPt(next)
  }

  const handleRetryCerts = () => {
    setLoadingCerts(true)
    setCertError(null)
    void loadCertsAndClients()
  }

  const handleRefreshCerts = () => {
    setLoadingCerts(true)
    void loadCertsAndClients()
  }

  const handleImportOpenChange = (open: boolean) => {
    setImportOpen(open)
    if (!open) {
      // A importação acontece em diálogo nesta mesma tela; ao fechar,
      // recarrega a lista para o novo certificado já aparecer selecionável
      // sem sair do fluxo nem perder o PDF escolhido.
      setLoadingCerts(true)
      void loadCertsAndClients()
    }
  }

  const handleWindowsOpenChange = (open: boolean) => {
    setWindowsOpen(open)
    if (!open) {
      setLoadingCerts(true)
      void loadCertsAndClients()
    }
  }

  const renderCertTableRow = (cert: Certificate) => {
    const selected = selectedCertId === cert.id
    const expiringSoon = cert.status === 'expiring'
    const clientNames = (cert.clients ?? []).map((c) => c.name)
    return (
      <TableRow
        key={cert.id}
        onClick={() => setSelectedCertId(cert.id)}
        className={`cursor-pointer ${
          selected ? 'bg-[var(--pv-accent-soft)]/70 hover:bg-[var(--pv-accent-soft)]' : ''
        }`}
      >
        <TableCell className="w-[52px]">
          <input
            type="radio"
            name="assinatura-certificado"
            checked={selected}
            onChange={() => setSelectedCertId(cert.id)}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 cursor-pointer accent-[var(--pv-accent-solid)]"
            aria-label={`Selecionar certificado de ${cert.holderName}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                selected
                  ? 'bg-brand-600 text-brand-50'
                  : 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'
              }`}
              aria-hidden="true"
            >
              {initials(cert.holderName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{cert.holderName}</span>
              <span className="block truncate text-xs text-[var(--pv-muted)]">
                {clientNames.length > 0 ? clientNames.join(', ') : cert.label}
              </span>
            </span>
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap">
          {formatCpfCnpj(cert.document, cert.documentType)}
        </TableCell>
        <TableCell
          className="max-w-[220px] truncate text-xs text-[var(--pv-muted)]"
          title={cert.issuerDn}
        >
          {issuerShort(cert.issuerDn)}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs">
          <div className="text-sm font-medium">
            {formatDate(certificateEffectiveValidToOf(cert))}
          </div>
          <div className="text-[var(--pv-muted)]">início {formatDate(cert.validFrom)}</div>
        </TableCell>
        <TableCell>
          {expiringSoon ? (
            <Badge variant="warning">Vence em {cert.daysUntilExpiry}d</Badge>
          ) : (
            <Badge variant="success">Válido</Badge>
          )}
        </TableCell>
      </TableRow>
    )
  }

  const handleSign = async () => {
    if (signing) return
    if (!picked || !selectedCertId) {
      toast.error('Escolha o documento e o certificado antes de assinar.')
      return
    }
    // Revalidação no clique (fail-closed): expiração pode ter virado entre etapas.
    const fresh = certs.find((c) => c.id === selectedCertId) ?? null
    const nowDate = new Date()
    if (!fresh || !isEligibleCert(fresh, nowDate.getTime())) {
      toast.error('Certificado selecionado não é mais elegível — escolha outro.')
      setSelectedCertId(null)
      return
    }
    if (!previewMatchesPicked) {
      toast.error('Prévia do documento indisponível — escolha o PDF novamente.')
      setPreview(null)
      setStep(1)
      return
    }
    if (!pageValid) {
      toast.error(`Página ${currentPage} fora do documento.`)
      return
    }
    if (!stampValid) {
      toast.error('Posição do carimbo inválida.')
      return
    }
    if (picked.expiresAt && new Date(picked.expiresAt).getTime() <= Date.now()) {
      toast.error('Sessão do documento expirou — escolha o PDF novamente.')
      setPicked(null)
      setPreview(null)
      setStep(1)
      return
    }
    setSigning(true)
    setSignPhase(0)
    // Progresso das fases enquanto o backend assina (a tela de sucesso só
    // aparece quando o PDF gerado de fato retorna).
    signTimersRef.current = [
      window.setTimeout(() => setSignPhase(1), 900),
      window.setTimeout(() => setSignPhase(2), 1800),
    ]
    try {
      const result = await aurumBitPortal().pdf.sign({
        token: picked.token,
        certificateId: selectedCertId,
        page: currentPage,
        xPct: stampRect.x,
        yPct: stampRect.y,
        size: 'medium',
        widthPct: stampRect.w,
        heightPct: stampRect.h,
      })
      setResult(result)
      toast.success(`PDF assinado: ${result.outputFileName}`)
    } catch (error) {
      const code = errorCode(error)
      if (isPdfSessionExpired(error)) {
        toast.error('Sessão do documento expirou ou o arquivo mudou — escolha o PDF novamente.')
        setPicked(null)
        setPreview(null)
        setStep(1)
      } else if (code === 'CERTIFICATE_EXPIRED') {
        toast.error('Certificado vencido — escolha outro ou importe um novo PFX.')
        setSelectedCertId(null)
        void loadCertsAndClients()
      } else if (code === 'CERTIFICATE_INVALID') {
        toast.error(errorMessage(error))
        void loadCertsAndClients()
      } else if (code === 'UNAVAILABLE') {
        toast.error(errorMessage(error))
      } else {
        toast.error(errorMessage(error))
      }
    } finally {
      signTimersRef.current.forEach((t) => window.clearTimeout(t))
      signTimersRef.current = []
      setSigning(false)
    }
  }

  const resetFlow = () => {
    const token = picked?.token
    if (token) {
      void aurumBitPortal()
        .pdf.release(token)
        .catch(() => undefined)
    }
    setPicked(null)
    setPreview(null)
    setDocToken(null)
    setCurrentPage(1)
    setStampPt(null)
    setResult(null)
    setStep(1)
  }

  // --- Retorno automático à tela de seleção do documento (10s após assinar) ---
  // A tela de sucesso exibe um contador visível; ao zerar, o fluxo volta para
  // a etapa 1 (escolha do PDF) sozinho. "Permanecer nesta tela" cancela.
  const autoReturnCancelledRef = React.useRef(false)
  const resetFlowRef = React.useRef(resetFlow)
  React.useEffect(() => {
    resetFlowRef.current = resetFlow
  })
  const [autoReturnLeft, setAutoReturnLeft] = React.useState<number | null>(null)
  const autoReturnSeconds = 10
  React.useEffect(() => {
    if (!result) {
      setAutoReturnLeft(null)
      return
    }
    autoReturnCancelledRef.current = false
    const startedAt = Date.now()
    setAutoReturnLeft(autoReturnSeconds)
    const id = window.setInterval(() => {
      if (autoReturnCancelledRef.current) {
        window.clearInterval(id)
        return
      }
      const left = Math.max(0, autoReturnSeconds - Math.floor((Date.now() - startedAt) / 1000))
      setAutoReturnLeft(left)
      if (left <= 0) {
        window.clearInterval(id)
        resetFlowRef.current()
      }
    }, 250)
    return () => {
      window.clearInterval(id)
      setAutoReturnLeft(null)
    }
  }, [result])

  const copyPath = async () => {
    if (!result?.outputPath) return
    try {
      await navigator.clipboard.writeText(result.outputPath)
      toast.success('Caminho copiado.')
    } catch {
      toast.error('Não foi possível copiar o caminho.')
    }
  }

  const revealFile = async () => {
    if (!result?.outputPath) return
    try {
      await aurumBitPortal().pdf.reveal({ path: result.outputPath })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const copySha = async () => {
    if (!result?.sha256) return
    try {
      await navigator.clipboard.writeText(result.sha256)
      toast.success('SHA-256 copiado.')
    } catch {
      toast.error('Não foi possível copiar o SHA-256.')
    }
  }

  if (loadingCerts && !certError && certs.length === 0) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24 text-[var(--pv-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell fullHeight>
      <PageHeader
        title="Assinaturas digitais"
        description="Assine PDFs com certificado ICP-Brasil A1 (PAdES-B-T). O documento assinado nunca sobrescreve o original."
        eyebrow="Assinatura PAdES-B-T"
        icon={<FileSignature className="h-5 w-5" />}
      />

      {/* Stepper */}
      <ol className="mb-6 flex items-center text-xs" aria-label="Etapas da assinatura">
        {steps.map((label, index) => {
          const n = (index + 1) as 1 | 2 | 3 | 4
          const done = step > n
          const current = step === n
          return (
            <React.Fragment key={label}>
              <li className="flex items-center gap-2.5" aria-current={current ? 'step' : undefined}>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                    done
                      ? 'border-brand-600 bg-brand-600 text-brand-50'
                      : current
                        ? 'border-brand-600 bg-[var(--pv-accent-soft)] text-brand-700 ring-2 ring-brand-500/40 dark:text-brand-200'
                        : 'border-[var(--pv-border-strong)] bg-[var(--pv-panel)] text-[var(--pv-muted)]'
                  }`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : n}
                </span>
                <span
                  className={`hidden sm:inline font-medium ${
                    current ? 'text-[var(--pv-text)]' : 'text-[var(--pv-muted)]'
                  }`}
                >
                  {label}
                </span>
              </li>
              {index < steps.length - 1 ? (
                <li aria-hidden="true" className="mx-3 h-px min-w-4 flex-1 bg-[var(--pv-border)]" />
              ) : null}
            </React.Fragment>
          )
        })}
      </ol>

      {/* Step 1: Documento (PDF) */}
      {step === 1 ? (
        <Card className="flex min-h-0 flex-1 flex-col justify-center p-6">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="h-5 w-5 text-[var(--pv-accent)]" />
            <h2 className="text-base font-semibold">Documento PDF para assinatura</h2>
          </div>

          {!picked ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--pv-border)] p-10 text-center">
              <Upload className="h-8 w-8 text-[var(--pv-muted)]" />
              <p className="text-sm text-[var(--pv-muted)]">
                Escolha um arquivo PDF (até 50 MB). O original não será alterado.
              </p>
              <Button onClick={() => void onPickFile()} disabled={loadingPreview}>
                {loadingPreview ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Escolher PDF
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--pv-border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{picked.fileName}</div>
                  <div className="text-xs text-[var(--pv-muted)]">
                    {formatBytes(picked.sizeBytes)} • {picked.pageCount} pagina(s)
                    {picked.expiresAt ? ` • expira ${formatDateTime(picked.expiresAt)}` : ''}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void onPickFile()}
                  disabled={loadingPreview}
                >
                  {loadingPreview ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Trocar PDF
                </Button>
              </div>
              {!previewMatchesPicked && !loadingPreview ? (
                <Alert variant="warning" title="Prévia indisponível">
                  Não foi possível carregar a pré-visualização. Escolha o PDF novamente antes de
                  continuar.
                </Alert>
              ) : (
                <p className="text-[11px] text-[var(--pv-muted)]">
                  A previa e a posicao do carimbo serao configuradas na etapa seguinte.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button
              disabled={!canAdvanceFromDoc}
              onClick={() => canAdvanceFromDoc && setStep(2)}
              title={!canAdvanceFromDoc ? 'Escolha um PDF e aguarde a pré-visualização' : undefined}
            >
              Próximo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Step 2: Certificados contidos na aplicação (sem sair da tela) */}
      {step === 2 ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div className="mb-2 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[var(--pv-success)]" />
              <h2 className="text-base font-semibold">Certificados digitais dos clientes</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefreshCerts}
                disabled={loadingCerts}
                title="Recarregar a lista de certificados da aplicação"
              >
                {loadingCerts ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Atualizar
              </Button>
              {/* Com certificados já instalados, só listar — não pedir arquivo/senha.
                  Os botões de importação aparecem apenas quando a aplicação ainda não tem nenhum. */}
              {totalCerts === 0 ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setWindowsOpen(true)}>
                    <MonitorCheck className="h-3.5 w-3.5" />
                    Do Windows
                  </Button>
                  <Button size="sm" onClick={() => setImportOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Importar PFX aqui
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <p className="mb-4 shrink-0 text-xs text-[var(--pv-muted)]">
            {picked?.fileName ? `Documento: ${picked.fileName} • ` : ''}
            {totalEligible} certificado(s) válido(s) para assinar
            {hiddenCount > 0 ? ` • ${hiddenCount} não elegível(is) oculto(s)` : ''}.
          </p>

          {certError ? (
            <div className="mb-4 shrink-0">
              <Alert
                variant="danger"
                title="Não foi possível carregar os certificados"
                action={
                  <Button size="sm" variant="secondary" onClick={handleRetryCerts}>
                    <RotateCcw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                }
              >
                {certError}
              </Alert>
            </div>
          ) : null}

          {certs.length === 0 ? (
            <EmptyState
              className="min-h-0 flex-1 overflow-y-auto pv-scroll"
              title="Nenhum certificado na aplicação ainda"
              description="Nenhum certificado foi importado para o cofre. Você pode importar um PFX/P12 agora nesta mesma tela — a sessão do PDF é preservada."
              action={
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setImportOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Importar PFX aqui
                  </Button>
                  <Button variant="secondary" onClick={() => setWindowsOpen(true)}>
                    <MonitorCheck className="h-4 w-4" />
                    Do Windows
                  </Button>
                </div>
              }
            />
          ) : totalEligible === 0 ? (
            <EmptyState
              className="min-h-0 flex-1 overflow-y-auto pv-scroll"
              title="Nenhum certificado válido para assinar"
              description={`Há ${totalCerts} certificado(s) na aplicação, mas nenhum é válido no momento (vencido ou sem material de assinatura). Importe um PFX nesta mesma tela — a sessão do PDF é preservada.`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setImportOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Importar PFX aqui
                  </Button>
                  <Button variant="secondary" onClick={() => setWindowsOpen(true)}>
                    <MonitorCheck className="h-4 w-4" />
                    Do Windows
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden gap-3">
              <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3">
                <div className="relative min-w-[260px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
                    aria-hidden="true"
                  />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por nome, CPF ou CNPJ…"
                    className="pl-10"
                    aria-label="Buscar certificado por nome, CPF ou CNPJ"
                  />
                </div>
                {clients.some((client) => (eligibleByClient.get(client.id) ?? 0) > 0) ? (
                  <Select
                    value={clientFilter}
                    onChange={(event) => setClientFilter(event.target.value)}
                    className="w-[220px]"
                    aria-label="Filtrar por cliente"
                  >
                    <option value="all">Todos os clientes ({totalEligible})</option>
                    {clients.map((client) => {
                      const count = eligibleByClient.get(client.id) ?? 0
                      if (count === 0) return null
                      return (
                        <option key={client.id} value={client.id}>
                          {client.name} ({count})
                        </option>
                      )
                    })}
                  </Select>
                ) : null}
                {search || clientFilter !== 'all' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setClientFilter('all')
                    }}
                  >
                    Limpar
                  </Button>
                ) : null}
              </div>

              {selectedCert ? (
                <p
                  className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--pv-muted)]"
                  aria-live="polite"
                >
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-[var(--pv-accent)]"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    Selecionado:{' '}
                    <strong className="font-semibold text-[var(--pv-text)]">
                      {selectedCert.holderName}
                    </strong>
                    {' • '}
                    {formatCpfCnpj(selectedCert.document, selectedCert.documentType)}
                    {!paginatedCerts.some((cert) => cert.id === selectedCert.id)
                      ? ' • fora desta página'
                      : ''}
                  </span>
                </p>
              ) : null}

              {visibleCerts.length === 0 ? (
                <EmptyState
                  className="min-h-0 flex-1 overflow-y-auto pv-scroll"
                  title="Nenhum certificado encontrado"
                  description="Nenhum certificado válido corresponde à busca. Limpe a busca para ver todos."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('')
                        setClientFilter('all')
                      }}
                    >
                      Limpar busca
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] pv-scroll">
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-[52px]">
                            <span className="sr-only">Selecionar</span>
                          </TableHead>
                          <TableHead>Titular</TableHead>
                          <TableHead>Documento</TableHead>
                          <TableHead>Emissor</TableHead>
                          <TableHead>Validade</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedCerts.map((cert) => renderCertTableRow(cert))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs tabular-nums text-[var(--pv-muted)]">
                        Mostrando {certRangeStart}–{certRangeEnd} de {visibleCerts.length}{' '}
                        certificado(s)
                      </p>
                      <label className="flex items-center gap-2 text-xs text-[var(--pv-muted)]">
                        <Select
                          value={String(certPageSize)}
                          onChange={(event) => setCertPageSize(Number(event.target.value))}
                          className="w-[130px]"
                          aria-label="Certificados por página"
                        >
                          <option value="10">10 por página</option>
                          <option value="25">25 por página</option>
                          <option value="50">50 por página</option>
                        </Select>
                      </label>
                    </div>
                    {certTotalPages > 1 ? (
                      <nav
                        className="flex items-center gap-1"
                        aria-label="Paginação de certificados"
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={certPage <= 1}
                          onClick={() => setCertPage((page) => Math.max(1, page - 1))}
                          aria-label="Página anterior"
                          className="px-2"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        {certPageItems.map((item, index) =>
                          item === 'ellipsis-start' || item === 'ellipsis-end' ? (
                            <span
                              key={`${item}-${index}`}
                              className="px-1 text-[var(--pv-muted)]"
                              aria-hidden="true"
                            >
                              …
                            </span>
                          ) : (
                            <Button
                              key={item}
                              size="sm"
                              variant={item === certPage ? 'default' : 'secondary'}
                              onClick={() => setCertPage(item)}
                              className="min-w-9 px-2 tabular-nums"
                              aria-current={item === certPage ? 'page' : undefined}
                            >
                              {item}
                            </Button>
                          ),
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={certPage >= certTotalPages}
                          onClick={() => setCertPage((page) => Math.min(certTotalPages, page + 1))}
                          aria-label="Próxima página"
                          className="px-2"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </nav>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="mt-4 flex shrink-0 justify-between gap-3 border-t border-[var(--pv-border)] pt-4">
            <Button variant="secondary" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <Button disabled={!canAdvanceFromCert} onClick={() => canAdvanceFromCert && setStep(3)}>
              Próximo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Step 3: Onde assinar (posicao do carimbo) */}
      {step === 3 ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {/* Cabeçalho da etapa */}
          <div className="px-6 py-5 border-b border-[var(--pv-border)] bg-[var(--pv-panel-2)]/50 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] ring-1 ring-[var(--pv-accent-soft-border)]">
                <FileSignature className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  Posição do carimbo de assinatura
                </h2>
                <p className="text-xs text-[var(--pv-muted)]">
                  Desenhe um bloco sobre o campo de assinatura e o sistema coloca a assinatura
                  dentro dele, igual ao Adobe. O bloco adota exatamente o tamanho desenhado (o
                  conteúdo do carimbo encolhe proporcionalmente para caber).
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="text-[var(--pv-muted)]">
              Etapa 3 de 4
            </Badge>
          </div>

          {!picked ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--pv-border)] p-12 text-center">
              <p className="text-sm text-[var(--pv-muted)]">Nenhum PDF selecionado.</p>
              <Button onClick={() => setStep(1)}>Voltar ao documento</Button>
            </div>
          ) : (
            <>
              {!previewMatchesPicked && !loadingPreview ? (
                <div className="px-6 py-4">
                  <Alert variant="danger" title="Prévia indisponível">
                    A pré-visualização não corresponde ao documento selecionado. Volte ao documento
                    e escolha o PDF novamente.
                  </Alert>
                </div>
              ) : (
                <>
                  <div className="px-6 py-3 shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--pv-border)] bg-[var(--pv-panel-2)]/50">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{picked.fileName}</div>
                        <div className="text-xs text-[var(--pv-muted)]">
                          {formatBytes(picked.sizeBytes)} • {picked.pageCount} página(s)
                          {picked.expiresAt ? ` • expira ${formatDateTime(picked.expiresAt)}` : ''}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onPickFile()}
                      disabled={loadingPreview}
                    >
                      {loadingPreview ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Trocar PDF
                    </Button>
                  </div>

                  {/* Área de visualização do PDF */}
                  <div className="flex min-h-0 flex-1 flex-col gap-0">
                    <div
                      ref={containerRef}
                      onPointerDown={handlePagePointerDown}
                      onPointerMove={handlePanPointerMove}
                      onPointerUp={(event) => handlePanPointerEnd(event)}
                      onPointerCancel={(event) => handlePanPointerEnd(event, true)}
                      className="min-h-0 flex-1 cursor-grab touch-none overflow-auto rounded-b-xl border-t-0 border-[var(--pv-border)] bg-[var(--pv-bg)]"
                    >
                      <div className="grid min-h-full min-w-full place-items-center [place-items:safe_center] p-4">
                        <div
                          ref={pageWrapperRef}
                          className="relative w-fit bg-white shadow-[0_20px_50px_rgba(15,23,42,0.15)] ring-1 ring-black/5 rounded-xl overflow-hidden"
                        >
                          <canvas
                            ref={canvasRef}
                            className="block bg-white"
                            aria-label="Prévia da página do PDF"
                          />
                          <div
                            ref={boxRef}
                            data-stamp-box="true"
                            className="absolute hidden pointer-events-none border-2 border-dashed border-brand-600 bg-brand-50/20 z-10"
                          />
                          <div
                            ref={stampRef}
                            data-stamp="true"
                            tabIndex={0}
                            role="slider"
                            aria-label="Posição do carimbo de assinatura"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            onPointerDown={handleStampPointerDown}
                            onPointerMove={handleStampPointerMove}
                            onPointerUp={handleStampPointerUp}
                            onPointerCancel={handleStampPointerCancel}
                            onKeyDown={handleStampKeyDown}
                            className={`absolute flex cursor-grab touch-none select-none items-center justify-center overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-[var(--pv-border-strong)]/70 transition-shadow duration-150 ${!stampPt ? 'hidden' : ''} ${dragging ? 'shadow-lg ring-2 ring-brand-500/40' : ''}`}
                            style={stampPctToStyle}
                            aria-valuenow={Math.round(stampRect.x * 100)}
                            aria-valuetext={`Posição ${Math.round(stampRect.x * 100)}% horizontal, ${Math.round(stampRect.y * 100)}% vertical, largura ${Math.round(stampRect.w * 100)}%, altura ${Math.round(stampRect.h * 100)}%`}
                          >
                            {/* Alças de redimensionamento */}
                            {(
                              [
                                ['nw', '-left-1 -top-1 cursor-nwse-resize'],
                                ['ne', '-right-1 -top-1 cursor-nesw-resize'],
                                ['sw', '-left-1 -bottom-1 cursor-nesw-resize'],
                                ['se', '-right-1 -bottom-1 cursor-nwse-resize'],
                              ] as const
                            ).map(([mode, pos]) => (
                              <div
                                key={mode}
                                data-resize={mode}
                                onPointerDown={handleResizePointerDown(mode)}
                                onPointerMove={handleStampPointerMove}
                                onPointerUp={handleStampPointerUp}
                                onPointerCancel={handleStampPointerCancel}
                                className={`absolute ${pos} z-20 h-3 w-3 rounded-sm border border-white bg-brand-600 shadow-md touch-none`}
                                aria-hidden="true"
                              />
                            ))}
                            {/* Estágio de design fixo (natural 140x104 pt em px CSS),
                                escalado uniformemente via `zoom` para o tamanho real
                                do bloco — conteúdo nunca transborda nem é cortado. */}
                            <div
                              aria-hidden="true"
                              className="pointer-events-none relative flex h-[138.67px] w-[186.67px] shrink-0 flex-col overflow-hidden rounded-[10px] bg-white"
                              style={{ zoom: previewStageZoom }}
                            >
                              {/* Marca d'água (biometria) centralizada no meio de tudo,
                                atrás de todo o conteúdo do carimbo. */}
                              <img
                                src="/biometria-watermark.png"
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                                className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-[62%] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.18]"
                              />
                              {/* Cabeçalho do carimbo */}
                              <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 px-2.5 py-1.5 bg-[#1b1a17] text-[#ece9e2]">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <GripHorizontal
                                    className="h-3 w-3 shrink-0 text-[#D4AF37] rotate-180"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate text-[9px] font-bold tracking-[0.1em] text-[#D4AF37]/90">
                                    ASSINADO DIGITALMENTE
                                  </span>
                                </div>
                                <img
                                  src="/iti-certificacao.png"
                                  alt="Selo ITI — Instituto Tecnológico"
                                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/40"
                                  draggable={false}
                                />
                              </div>
                              <div
                                className="relative z-10 h-[1px] shrink-0 bg-[#D4AF37]/60"
                                aria-hidden="true"
                              />
                              <div className="relative z-10 flex min-w-0 flex-1 items-end gap-2 px-2.5 pt-1 pb-1.5">
                                <div className="relative min-w-0 flex-1">
                                  <div className="line-clamp-2 break-words text-[10px] font-bold leading-tight text-[var(--pv-text)]">
                                    {selectedCert?.holderName ?? ''}
                                  </div>
                                  {selectedCert ? (
                                    <div className="mt-0.5 truncate text-[8px] font-bold text-[var(--pv-text)]">
                                      {formatCpfCnpj(
                                        selectedCert.document,
                                        selectedCert.documentType,
                                      )}
                                    </div>
                                  ) : null}
                                  {selectedCert ? (
                                    <div
                                      className="truncate text-[8px] font-bold text-[var(--pv-muted)]"
                                      title={selectedCert.issuerDn}
                                    >
                                      Emissor: {issuerShort(selectedCert.issuerDn)}
                                    </div>
                                  ) : null}
                                  <div className="truncate text-[8px] font-bold text-[var(--pv-muted)]">
                                    Data: {new Date().toLocaleDateString('pt-BR')} -03:00
                                  </div>
                                </div>
                                {qrDataUrl ? (
                                  <img
                                    src={qrDataUrl}
                                    alt="QR Code para validar em validar.iti.gov.br"
                                    className="h-12 w-12 shrink-0 rounded-sm ring-1 ring-[var(--pv-border-strong)]/60"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed border-[var(--pv-border-strong)] text-[8px] text-[var(--pv-faint)]">
                                    QR
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {renderingPage ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm z-30">
                              <Loader2 className="h-5 w-5 animate-spin text-[var(--pv-accent)]" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Barra de controle: páginas + zoom */}
                    <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] px-4 py-3">
                      <div
                        className="flex items-center gap-1"
                        role="group"
                        aria-label="Escolher página"
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        {getPageItems(currentPage, picked.pageCount).map((item) => {
                          if (item === 'ellipsis-start' || item === 'ellipsis-end') {
                            return (
                              <span
                                key={`ell-${item}`}
                                className="px-1 text-[var(--pv-muted)] text-xs"
                                aria-hidden="true"
                              >
                                …
                              </span>
                            )
                          }
                          return (
                            <Button
                              key={item}
                              size="sm"
                              variant={item === currentPage ? 'default' : 'secondary'}
                              onClick={() => setCurrentPage(item)}
                              className="min-w-8 px-2 tabular-nums"
                              aria-current={item === currentPage ? 'page' : undefined}
                            >
                              {item}
                            </Button>
                          )
                        })}
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage >= picked.pageCount}
                          onClick={() => setCurrentPage((p) => Math.min(picked.pageCount, p + 1))}
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="text-xs tabular-nums text-[var(--pv-muted)]">
                        {currentPage} de {picked.pageCount}
                      </span>
                      <div
                        className="mx-1 hidden h-5 w-px bg-[var(--pv-border)] sm:block"
                        aria-hidden="true"
                      />
                      <div
                        className="flex items-center gap-1"
                        role="group"
                        aria-label="Zoom do PDF"
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={zoomOut}
                          disabled={zoom <= 0.5}
                          aria-label="Diminuir zoom"
                          title="Diminuir zoom"
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span
                          className="min-w-10 text-center text-xs font-semibold tabular-nums text-[var(--pv-muted)]"
                          aria-live="polite"
                        >
                          {zoomDisplay}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={zoomIn}
                          disabled={zoom >= 4}
                          aria-label="Aumentar zoom"
                          title="Aumentar zoom"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={zoomMode === 'width' ? 'default' : 'secondary'}
                          size="sm"
                          onClick={zoomFitWidth}
                          aria-label="Ajustar à largura"
                          title="Ajustar à largura (leitura)"
                        >
                          <Maximize className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={zoomMode === 'page' ? 'default' : 'secondary'}
                          size="sm"
                          onClick={zoomFitPage}
                          aria-label="Ajustar à página"
                          title="Ajustar à página inteira"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </div>
                      <span
                        className="ml-auto hidden text-[11px] tabular-nums text-[var(--pv-faint)] md:inline"
                        title="Ctrl + scroll para zoom; arraste o fundo para mover a vista. Arraste o carimbo para mover; alças redimensionam. Teclado: setas movem, Alt + setas redimensiona."
                      >
                        Carimbo{' '}
                        {stampPt ? `${Math.round(stampPt.w)} × ${Math.round(stampPt.h)} pt` : '—'}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div className="px-6 py-4 border-t border-[var(--pv-border)] bg-[var(--pv-panel-2)]/50 shrink-0 flex justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
            <Button
              disabled={!canAdvanceFromStamp}
              onClick={() => canAdvanceFromStamp && setStep(4)}
            >
              Próximo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Step 4: Revisar, assinar e concluir */}
      {step === 4 ? (
        result ? (
          <Card className="flex min-h-[440px] flex-col justify-center p-6 sm:p-8">
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 text-center pv-anim-slide-up">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--pv-success-soft)] text-[var(--pv-success)] ring-1 ring-[var(--pv-success-border)]/20 dark:bg-[var(--pv-success-soft)]">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h2 className="text-lg font-semibold">PDF assinado com sucesso</h2>
              <p className="text-sm text-[var(--pv-muted)]">
                O original foi preservado — um novo documento verificado foi gravado ao lado dele
                (nunca sobrescreve).
              </p>
              <div className="w-full space-y-2 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4 text-left text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-[var(--pv-muted)]">Arquivo gerado</span>
                  <span className="min-w-0 truncate text-right font-semibold">
                    {result.outputFileName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-[var(--pv-muted)]">Local</span>
                  <span
                    className="min-w-0 truncate text-right font-mono text-xs"
                    title={result.outputPath}
                  >
                    {result.outputPath}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-[var(--pv-muted)]">SHA-256</span>
                  <span
                    className="min-w-0 truncate text-right font-mono text-xs"
                    title={result.sha256}
                  >
                    {result.sha256.slice(0, 24)}…
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-[var(--pv-muted)]">Certificado</span>
                  <span className="min-w-0 truncate text-right font-mono text-xs">
                    thumbprint {result.certificateThumbprint.slice(0, 16)}…
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="shrink-0 text-[var(--pv-muted)]">Carimbo de tempo</span>
                  <span className="min-w-0 truncate text-right text-xs">
                    {result.tsaHost === 'offline'
                      ? `Sem carimbo (offline) • ${new Date(result.signedAt).toLocaleString('pt-BR')}`
                      : `${result.tsaHost} • ${new Date(result.signedAt).toLocaleString('pt-BR')}`}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-nowrap items-center justify-center gap-2 overflow-x-auto pb-1">
                <Button onClick={() => void revealFile()}>
                  <FolderOpen className="h-4 w-4" />
                  Abrir local do arquivo
                </Button>
                <Button variant="secondary" onClick={() => void copyPath()}>
                  <Copy className="h-4 w-4" />
                  Copiar caminho
                </Button>
                <Button variant="secondary" onClick={() => void copySha()}>
                  <Copy className="h-4 w-4" />
                  Copiar SHA-256
                </Button>
                <Button variant="secondary" onClick={resetFlow}>
                  Assinar outro PDF
                </Button>
              </div>
              {autoReturnLeft !== null ? (
                <div
                  className="mt-4 flex w-full max-w-sm flex-col items-center gap-2"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-xs tabular-nums text-[var(--pv-muted)]">
                    Voltando para a escolha do documento em{' '}
                    <span className="font-semibold text-[var(--pv-text)]">{autoReturnLeft}s</span>
                  </p>
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-[var(--pv-border)]"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--pv-accent-solid)] transition-[width] duration-250 ease-linear"
                      style={{ width: `${(autoReturnLeft / autoReturnSeconds) * 100}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      autoReturnCancelledRef.current = true
                      setAutoReturnLeft(null)
                    }}
                    className="text-[11px] font-medium text-[var(--pv-muted)] underline-offset-2 hover:text-[var(--pv-text)] hover:underline"
                  >
                    Permanecer nesta tela
                  </button>
                </div>
              ) : null}
            </div>
          </Card>
        ) : signing ? (
          <Card
            className="flex min-h-[440px] flex-col justify-center p-6 sm:p-8"
            aria-live="polite"
          >
            <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-4 text-center pv-anim-slide-up">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] ring-1 ring-brand-600/20">
                <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold">Assinando documento</h2>
              <ol className="w-full space-y-3 text-left">
                {SIGN_PHASES.map((label, index) => {
                  const done = index < signPhase
                  const active = index === signPhase
                  return (
                    <li
                      key={label}
                      className="flex items-center gap-3"
                      aria-current={active ? 'step' : undefined}
                    >
                      {done ? (
                        <CheckCircle2
                          className="h-5 w-5 shrink-0 text-[var(--pv-success)]"
                          aria-hidden="true"
                        />
                      ) : active ? (
                        <Loader2
                          className="h-5 w-5 shrink-0 animate-spin text-[var(--pv-accent)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--pv-border-strong)] bg-[var(--pv-panel-2)] text-[10px] font-semibold text-[var(--pv-muted)]">
                          {index + 1}
                        </span>
                      )}
                      <span
                        className={
                          done
                            ? 'text-sm text-[var(--pv-muted)]'
                            : active
                              ? 'text-sm font-semibold text-[var(--pv-text)]'
                              : 'text-sm text-[var(--pv-faint)]'
                        }
                      >
                        {label}
                      </span>
                    </li>
                  )
                })}
              </ol>
              <p className="text-xs text-[var(--pv-muted)]">
                Finalizando a geração do documento assinado…
              </p>
            </div>
          </Card>
        ) : (
          <Card className="flex min-h-[440px] flex-col justify-center p-6">
            <div className="mb-4 flex items-center gap-2">
              <PenLine className="h-5 w-5 text-[var(--pv-accent)]" />
              <h2 className="text-base font-semibold">Revisar e assinar</h2>
            </div>
            {!canSign ? (
              <Alert variant="warning" title="Verificação incompleta" className="mb-4">
                <span className="flex items-center gap-1.5">
                  <TriangleAlert className="h-4 w-4" />
                  {[
                    !canAdvanceFromDoc && 'documento/prévia não conferem',
                    !canAdvanceFromCert && 'certificado não elegível',
                    !pageValid && 'página inválida',
                    !stampValid && 'posição inválida',
                  ]
                    .filter(Boolean)
                    .join(' • ') || 'aguarde'}
                </span>
              </Alert>
            ) : null}
            <div className="space-y-3 rounded-lg border border-[var(--pv-border)] p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-[var(--pv-muted)]">Certificado</span>
                <span className="text-right font-medium">{selectedCert?.holderName ?? '—'}</span>
              </div>
              {selectedClientName ? (
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--pv-muted)]">Cliente</span>
                  <span className="text-right font-medium">{selectedClientName}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <span className="text-[var(--pv-muted)]">Documento</span>
                <span className="text-right font-medium">{picked?.fileName ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--pv-muted)]">Pagina do carimbo</span>
                <span className="text-right font-medium">
                  {currentPage} de {picked?.pageCount ?? 0}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--pv-muted)]">Tamanho desenhado</span>
                <span className="text-right font-medium tabular-nums">
                  {(stampRect.w * 100).toFixed(1)}% × {(stampRect.h * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--pv-muted)]">Emissor do certificado</span>
                <span className="min-w-0 truncate text-right font-medium">
                  {selectedCert ? issuerShort(selectedCert.issuerDn) : '—'}
                </span>
              </div>
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)} disabled={signing}>
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button disabled={!canSign} onClick={() => void handleSign()}>
                {signing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSignature className="h-4 w-4" />
                )}
                {signing ? 'Assinando…' : 'Assinar PDF'}
              </Button>
            </div>
          </Card>
        )
      ) : null}

      {/* Importação em diálogo nesta mesma tela: nunca navega para /certificates,
          preserva picked/preview e recarrega a lista ao fechar. */}
      <CertificateImportWizard open={importOpen} onOpenChange={handleImportOpenChange} />
      <WindowsCertificateDialog open={windowsOpen} onOpenChange={handleWindowsOpenChange} />
    </AppShell>
  )
}
