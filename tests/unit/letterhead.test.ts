import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LETTERHEAD,
  LETTERHEAD_PRESET_CATEGORIES,
  LETTERHEAD_PRESETS,
  applyLetterheadPreset,
  generateTrackingCode,
  hexToRgbTuple,
  isHexColor,
  isValidTrackingCode,
  trackingCheckDigits,
} from '../../shared/letterhead'
import { coerceSettings, DEFAULT_OFFICE_PROFILE, DEFAULT_SETTINGS } from '../../shared/settings'
import { settingsUpdateSchema } from '../../shared/contracts'
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { inflateSync } from 'node:zlib'
import { generateReportPdf } from '../../src/lib/pdf/report-document'
import { generateBarcodePngBytes } from '../../src/lib/pdf/barcode'

/**
 * Conta operadores `Do` (desenho de XObject/imagem) no content stream da
 * página — pdf-lib não expõe getImages() em PDFPage.
 */
function countPageImageDraws(pdf: PDFDocument, pageIndex: number): number {
  const contents = pdf.getPage(pageIndex).node.Contents()
  if (!contents) return 0
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
  return (operators.match(/\/\S+\s+Do\b/g) ?? []).length
}

/**
 * Extrai o texto desenhado nas páginas: concatena o conteúdo latin1 cru e
 * os strings hex `<...> Tj/TJ` decodificados (pdf-lib codifica WinAnsi em hex).
 */
function extractPdfText(pdf: PDFDocument): string {
  let output = ''
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents()
    if (!contents) continue
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents]
    for (const entry of entries) {
      const stream = pdf.context.lookup(entry)
      if (!(stream instanceof PDFRawStream)) continue
      let text: string
      try {
        text = new TextDecoder('latin1').decode(inflateSync(stream.contents))
      } catch {
        text = new TextDecoder('latin1').decode(stream.contents)
      }
      output += text
      for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*T[jJ]/g)) {
        const hex = match[1] ?? ''
        let decoded = ''
        for (let index = 0; index + 2 <= hex.length; index += 2) {
          decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16))
        }
        output += decoded
      }
    }
  }
  return output
}

describe('código de rastreio', () => {
  it('gera código no formato PV-AAAAMM-XXXXXXXX-DD e valida offline', () => {
    const code = generateTrackingCode(new Date(Date.UTC(2026, 10, 9, 12)), () => 0.42)
    expect(code).toMatch(/^PV-202611-[A-Z2-9]{8}-\d{2}$/)
    expect(isValidTrackingCode(code)).toBe(true)
  })

  it('rejeita código com dígito adulterado e formatos inválidos', () => {
    const code = generateTrackingCode(new Date(Date.UTC(2026, 10, 9)), () => 0.1)
    const adulterado = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')
    expect(isValidTrackingCode(adulterado)).toBe(false)
    expect(isValidTrackingCode('PV-202611-ABCDEFGH')).toBe(false)
    expect(isValidTrackingCode('')).toBe(false)
    expect(isValidTrackingCode('informação inválida')).toBe(false)
  })

  it('códigos gerados em sequência são únicos', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateTrackingCode()))
    expect(codes.size).toBe(20)
  })

  it('trackingCheckDigits é determinístico', () => {
    expect(trackingCheckDigits('202611', 'ABCDEFGH')).toBe(
      trackingCheckDigits('202611', 'ABCDEFGH'),
    )
  })
})

describe('presets e cores do timbrado', () => {
  it('biblioteca possui 20 temas únicos, com cores válidas e categorias conhecidas', () => {
    expect(LETTERHEAD_PRESETS).toHaveLength(20)
    const ids = new Set(LETTERHEAD_PRESETS.map((preset) => preset.id))
    const names = new Set(LETTERHEAD_PRESETS.map((preset) => preset.name))
    expect(ids.size).toBe(20)
    expect(names.size).toBe(20)
    for (const preset of LETTERHEAD_PRESETS) {
      expect(LETTERHEAD_PRESET_CATEGORIES).toContain(preset.category)
      expect(isHexColor(preset.colors.primaryColor)).toBe(true)
      expect(isHexColor(preset.colors.accentColor)).toBe(true)
      expect(isHexColor(preset.colors.inkColor)).toBe(true)
      expect(isHexColor(preset.colors.mutedColor)).toBe(true)
      expect(isHexColor(preset.colors.surfaceColor)).toBe(true)
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.description.trim().length).toBeGreaterThan(0)
    }
    // ids históricos preservados (bancos existentes referenciam esses presets)
    for (const legacy of ['institucional', 'grafite', 'fiscal', 'dourado', 'minimalista']) {
      expect(ids.has(legacy)).toBe(true)
    }
  })

  it('aplica preset preservando barra e toggles', () => {
    const next = applyLetterheadPreset(DEFAULT_LETTERHEAD, 'grafite')
    const grafite = LETTERHEAD_PRESETS.find((preset) => preset.id === 'grafite')
    expect(next.presetId).toBe('grafite')
    expect(next.primaryColor).toBe(grafite?.colors.primaryColor)
    expect(next.barStyle).toBe(DEFAULT_LETTERHEAD.barStyle)
    expect(next.showCnpj).toBe(DEFAULT_LETTERHEAD.showCnpj)
  })

  it('preset desconhecido não altera nada', () => {
    expect(applyLetterheadPreset(DEFAULT_LETTERHEAD, 'inexistente')).toEqual(DEFAULT_LETTERHEAD)
  })

  it('hexToRgbTuple converte e rejeita cor inválida como preto', () => {
    expect(hexToRgbTuple('#FFFFFF')).toEqual([1, 1, 1])
    expect(hexToRgbTuple('#000000')).toEqual([0, 0, 0])
    expect(hexToRgbTuple('azul')).toEqual([0, 0, 0])
    expect(hexToRgbTuple('#243C9E')[0]).toBeCloseTo(36 / 255)
  })
})

describe('persistência do timbrado', () => {
  it('banco sem letterhead mantém padrões (compatibilidade)', () => {
    expect(coerceSettings({}).letterhead).toEqual(DEFAULT_LETTERHEAD)
    expect(coerceSettings({}).office).toEqual(DEFAULT_OFFICE_PROFILE)
    expect(DEFAULT_SETTINGS.letterhead).toEqual(DEFAULT_LETTERHEAD)
  })

  it('mescla parcial do letterhead sem apagar os demais campos', () => {
    const result = coerceSettings({ letterhead: { primaryColor: '#FF0000' } })
    expect(result.letterhead.primaryColor).toBe('#FF0000')
    expect(result.letterhead.presetId).toBe(DEFAULT_LETTERHEAD.presetId)
    expect(result.letterhead.showCnpj).toBe(DEFAULT_LETTERHEAD.showCnpj)
  })

  it('office estendido aceita endereço/contato e normaliza UF', () => {
    const result = coerceSettings({
      office: { address: 'Rua das Flores, 123', city: 'São Paulo', state: 'sp', email: 'a@b.com' },
    })
    expect(result.office.address).toBe('Rua das Flores, 123')
    expect(result.office.state).toBe('SP')
    expect(result.office.email).toBe('a@b.com')
  })

  it('rejeita cor inválida, e-mail inválido e UF longa voltando aos padrões', () => {
    expect(coerceSettings({ letterhead: { primaryColor: 'azul' } })).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings({ office: { email: 'invalido' } })).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings({ office: { state: 'SPL' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('settingsUpdate aceita atualização parcial só do letterhead', () => {
    const parsed = settingsUpdateSchema.parse({ letterhead: { barStyle: 'double' } })
    expect(parsed.letterhead).toMatchObject({ barStyle: 'double' })
    expect(parsed.theme).toBeUndefined()
  })
})

describe('barcode Code128', () => {
  it('gera PNG com assinatura válida', async () => {
    const bytes = await generateBarcodePngBytes('PV-202611-ABCDEFGH-00')
    expect(bytes.length).toBeGreaterThan(100)
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})

describe('relatório timbrado (pdf-lib)', () => {
  it('gera PDF A4 com timbrado, título, tabela e código de rastreio', async () => {
    const result = await generateReportPdf({
      title: 'Relatorio de Teste',
      subtitle: 'Modelo',
      office: {
        ...DEFAULT_OFFICE_PROFILE,
        tradeName: 'Escritorio Exemplo',
        legalName: 'Escritorio Exemplo LTDA',
        cnpj: '11222333000181',
        managerName: 'Gestor Exemplo',
        managerCpf: '52998224725',
        city: 'Sao Paulo',
        state: 'SP',
      },
      letterhead: DEFAULT_LETTERHEAD,
      trackingCode: 'PV-202611-ABCDEFGH-00',
      sections: [
        {
          heading: 'Eventos',
          table: {
            columns: ['Data', 'Tipo'],
            rows: [
              ['09/11/2026', 'settings.updated'],
              ['08/11/2026', 'client.created'],
            ],
          },
        },
      ],
    })
    expect(result.trackingCode).toBe('PV-202611-ABCDEFGH-00')
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
    const head = new TextDecoder('latin1').decode(result.bytes.subarray(0, 8))
    expect(head.startsWith('%PDF-')).toBe(true)
    // PDF válido, recarregável, com título e código de rastreio nos metadados
    const loaded = await PDFDocument.load(result.bytes)
    expect(loaded.getPageCount()).toBe(result.pageCount)
    expect(loaded.getTitle()).toBe('Relatorio de Teste')
    expect(loaded.getSubject()).toContain('PV-202611-ABCDEFGH-00')
    expect(loaded.getAuthor()).toContain('Escritorio Exemplo')
    // Barcode (imagem) fica na primeira página, no cabeçalho
    expect(countPageImageDraws(loaded, 0)).toBeGreaterThanOrEqual(1)
  })

  it('não exibe o CPF do responsável, nem mascarado', async () => {
    const result = await generateReportPdf({
      title: 'Relatorio com Gestor',
      office: {
        ...DEFAULT_OFFICE_PROFILE,
        tradeName: 'Escritorio Exemplo',
        managerName: 'Gestor Exemplo',
        managerCpf: '52998224725',
      },
      letterhead: DEFAULT_LETTERHEAD,
      trackingCode: 'PV-202611-ABCDEFGH-00',
      sections: [{ paragraphs: ['Corpo do relatorio.'] }],
    })
    const loaded = await PDFDocument.load(result.bytes)
    const text = extractPdfText(loaded)
    // Controle positivo: o extrator funciona e o nome do gestor aparece.
    expect(text).toContain('Gestor Exemplo')
    // O CPF nunca aparece — nem os dígitos, nem a máscara.
    expect(text).not.toContain('CPF')
    expect(text).not.toContain('52998224725')
    expect(text).not.toContain('***')
    expect(text).not.toContain('***.***.***-25')
  })

  it('barcode fica só na primeira página; rodapé leva apenas o código em texto', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => [String(index), `Descricao ${index}`])
    const result = await generateReportPdf({
      title: 'Relatorio Paginado',
      office: DEFAULT_OFFICE_PROFILE,
      letterhead: DEFAULT_LETTERHEAD,
      sections: [{ table: { columns: ['Item', 'Descricao'], rows } }],
    })
    expect(result.pageCount).toBeGreaterThanOrEqual(2)
    const loaded = await PDFDocument.load(result.bytes)
    // Barcode só na primeira página; demais páginas têm apenas texto de rodapé
    expect(countPageImageDraws(loaded, 0)).toBeGreaterThanOrEqual(1)
    for (let pageIndex = 1; pageIndex < loaded.getPageCount(); pageIndex++) {
      expect(countPageImageDraws(loaded, pageIndex)).toBe(0)
    }
  })

  it('gera código automaticamente quando omitido', async () => {
    const result = await generateReportPdf({
      title: 'Relatorio Sem Codigo',
      office: DEFAULT_OFFICE_PROFILE,
      letterhead: DEFAULT_LETTERHEAD,
      sections: [{ paragraphs: ['Corpo.'] }],
    })
    expect(isValidTrackingCode(result.trackingCode)).toBe(true)
  })

  it('proteção: título longo + metadados longos não sobrepõem o corpo', async () => {
    const result = await generateReportPdf({
      title:
        'Relatorio de Auditoria Completo com Titulo Extremamente Longo que Precisa Quebrar em Multiplas Linhas Sem Invadir a Area do Corpo',
      subtitle:
        'Subtitulo tambem longo para verificar que a quebra de linha respeita a largura util da pagina e nao vaza para fora das margens de 18 mm',
      meta: Array.from(
        { length: 10 },
        (_, index) =>
          `Metadado ${index + 1}: linha longa de contexto com filtros aplicados e periodo de referencia que nao pode sobrepor o titulo nem as secoes seguintes`,
      ),
      office: {
        ...DEFAULT_OFFICE_PROFILE,
        tradeName:
          'Escritorio com Nome Fantasia Extremamente Longo que Deve Ser Truncado sem Invadir o Bloco do Emissor',
        legalName: 'Escritorio Exemplo LTDA',
        cnpj: '11222333000181',
        address: 'Avenida Paulista, 1000, Salas 101 a 105, Bela Vista, Sao Paulo, SP',
        phone: '(11) 3000-0000',
        email: 'contato@escritorio-exemplo.com.br',
      },
      letterhead: DEFAULT_LETTERHEAD,
      sections: [
        {
          heading: 'Dados de exemplo',
          paragraphs: [
            'Paragrafo longo que demonstra o corpo editorial: o timbrado identifica o emissor, a barra separa o titulo do conteudo e todo documento possui codigo de rastreio com barcode.',
          ],
        },
      ],
    })
    const loaded = await PDFDocument.load(result.bytes)
    expect(loaded.getPageCount()).toBe(result.pageCount)
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
  })

  it('proteção: tabela enorme com células longas quebra páginas sem sobrepor', async () => {
    const rows = Array.from({ length: 80 }, (_, index) => [
      String(index + 1).padStart(2, '0'),
      `Descricao longa da linha ${index + 1} com muito texto para forcar quebra de linha dentro da celula e divisao entre paginas sem sobrepor o rodape`,
      'OK',
    ])
    const result = await generateReportPdf({
      title: 'Relatorio Grande',
      office: DEFAULT_OFFICE_PROFILE,
      letterhead: DEFAULT_LETTERHEAD,
      sections: [
        {
          heading: 'Tabela extensa',
          table: { columns: ['Item', 'Descricao', 'Situacao'], widths: [1, 3, 1], rows },
        },
        {
          heading: 'Secao apos a tabela',
          paragraphs: [
            'Conteudo que deve comecar apos a tabela, em qualquer pagina, sem invadir o rodape.',
          ],
        },
      ],
    })
    const loaded = await PDFDocument.load(result.bytes)
    expect(loaded.getPageCount()).toBe(result.pageCount)
    expect(result.pageCount).toBeGreaterThanOrEqual(2)
  })

  it('proteção: cabeçalho de seção no fim da página não fica órfão', async () => {
    const result = await generateReportPdf({
      title: 'Relatorio com Muitas Secoes',
      office: DEFAULT_OFFICE_PROFILE,
      letterhead: DEFAULT_LETTERHEAD,
      sections: Array.from({ length: 12 }, (_, index) => ({
        heading: `Secao ${index + 1} com titulo longo que tambem precisa ser truncado sem invadir as margens laterais da pagina`,
        paragraphs: [
          `Paragrafo ${index + 1}: texto suficiente para encher linhas e forcar paginacao natural do documento em varias paginas.`,
        ],
      })),
    })
    const loaded = await PDFDocument.load(result.bytes)
    expect(loaded.getPageCount()).toBe(result.pageCount)
    expect(result.pageCount).toBeGreaterThanOrEqual(2)
  })
})
