import { describe, expect, it, vi } from 'vitest'

// Simula a indisponibilidade do bwip-js/canvas: a geração do barcode real
// sempre falha. O relatório deve mesmo assim carregar um barcode (figurativo).
vi.mock('../../src/lib/pdf/barcode', () => ({
  generateBarcodePngBytes: async () => {
    throw new Error('falha simulada no ambiente')
  },
}))

import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { inflateSync } from 'node:zlib'
import { DEFAULT_LETTERHEAD } from '../../shared/letterhead'
import { DEFAULT_OFFICE_PROFILE } from '../../shared/settings'
import { generateReportPdf } from '../../src/lib/pdf/report-document'
import { drawFallbackBarcode, fallbackBarcodeRuns } from '../../src/lib/pdf/fallback-barcode'

function pageContentOperators(pdf: PDFDocument, pageIndex: number): string {
  const contents = pdf.getPage(pageIndex).node.Contents()
  if (!contents) return ''
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents]
  let operators = ''
  for (const entry of entries) {
    const stream = pdf.context.lookup(entry)
    if (!(stream instanceof PDFRawStream)) continue
    try {
      operators += new TextDecoder('latin1').decode(inflateSync(stream.contents))
    } catch {
      operators += new TextDecoder('latin1').decode(stream.contents)
    }
  }
  return operators
}

describe('barcode figurativo (fallback)', () => {
  it('padrão é determinístico e possui guardas de início e fim', () => {
    const first = fallbackBarcodeRuns('PV-202611-ABCDEFGH-00')
    const second = fallbackBarcodeRuns('PV-202611-ABCDEFGH-00')
    const other = fallbackBarcodeRuns('PV-202611-00000000-00')
    expect(first).toEqual(second)
    expect(first).not.toEqual(other)
    expect(first.slice(0, 6)).toEqual([2, 1, 2, 1, 1, 2])
    expect(first.length).toBeGreaterThanOrEqual(52)
    // Todos os runs são positivos
    for (const run of first) expect(run).toBeGreaterThanOrEqual(1)
  })

  it('drawFallbackBarcode desenha sem erros em uma página real', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 100])
    expect(() =>
      drawFallbackBarcode(page, 'PV-202611-ABCDEFGH-00', { x: 10, y: 10, width: 120, height: 20 }),
    ).not.toThrow()
    const before = pageContentOperators(await PDFDocument.load(await doc.save()), 0)
    // drawRectangle do pdf-lib desenha path (… l / h / f): 1 "h" por retângulo.
    expect((before.match(/\nh\n/g) ?? []).length).toBeGreaterThan(10)
  })

  it('relatório é gerado e carrega o barcode figurativo mesmo com o bwip-js fora', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await generateReportPdf({
      title: 'Relatorio Sem Barcode Real',
      office: DEFAULT_OFFICE_PROFILE,
      letterhead: DEFAULT_LETTERHEAD,
      trackingCode: 'PV-202611-ABCDEFGH-00',
      sections: [{ paragraphs: ['Corpo do relatorio.'] }],
    })
    expect(result.trackingCode).toBe('PV-202611-ABCDEFGH-00')
    expect(warn).toHaveBeenCalled()
    const loaded = await PDFDocument.load(result.bytes)
    // Sem imagem embutida — o figurativo é vetorial, mas DEVE desenhar barras.
    const operators = pageContentOperators(loaded, 0)
    expect((operators.match(/\nh\n/g) ?? []).length).toBeGreaterThan(10)
    warn.mockRestore()
  })
})
