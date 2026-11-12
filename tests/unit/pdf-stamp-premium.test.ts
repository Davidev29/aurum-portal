import { describe, expect, it, beforeAll } from 'vitest'
import forge from 'node-forge'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { verifySignedPdf } from '../../electron/main/pdf/verify'
import {
  computeStampLayout,
  prepareFonts,
  qrModuleCountAndData,
  resolveCustomStampRect,
  wrapText,
} from '../../electron/main/pdf/stamp'
import { SIGNATURE_STAMP_FLOOR, SIGNATURE_STAMP_MIN, STAMP_TITLE } from '../../shared/signature'
import { inflateSync } from 'node:zlib'

/** Texto do PDF com streams FlateDecode inflados (conteudo do carimbo). */
function pdfText(buf: Buffer): string {
  const latin = buf.toString('latin1')
  let out = latin
  const re = /stream\r?\n([\s\S]*?)endstream/g
  const inflated: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(latin)) !== null) {
    try {
      const decoded = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1')
      inflated.push(decoded)
      out += decoded
    } catch {
      // stream nao comprimido ou parcial: ignora
    }
  }
  // pdf-lib escreve textos Tj como <hex> WinAnsi — decodifica para busca.
  for (const source of [latin, ...inflated]) {
    const hexes = source.match(/<([0-9A-Fa-f]{4,})>/g) ?? []
    for (const hex of hexes) {
      try {
        out += Buffer.from(hex.slice(1, -1), 'hex').toString('latin1')
      } catch {
        // ignora
      }
    }
  }
  return out
}

const PFX_PATH = path.resolve(process.cwd(), 'scripts/spike/.certs/spike-a1-test.pfx')
const PFX_PASSWORD = 'SpikeSenha123!'

let material: any

beforeAll(() => {
  const pfxBuffer = readFileSync(PFX_PATH)
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(pfxBuffer.toString('binary')),
    false,
    PFX_PASSWORD,
  )
  const keyBags = (p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag as string,
  })[forge.pki.oids.pkcs8ShroudedKeyBag as string] ?? []) as any[]
  const certBags = (p12.getBags({
    bagType: forge.pki.oids.certBag as string,
  })[forge.pki.oids.certBag as string] ?? []) as any[]
  const privateKey = keyBags[0].key
  const cert =
    certBags.find((b: any) => b.cert.publicKey.n.compareTo(privateKey.n) === 0)?.cert ??
    certBags[0].cert
  material = {
    pfx: pfxBuffer,
    password: PFX_PASSWORD,
    holderName: 'SPIKE TESTE:12345678909 MARIA FERNANDA SOUZA',
    document: '12345678909',
    documentType: 'CPF',
    issuerDn: `CN=Autoridade de Certificacao Muito Longa Para Teste de Quebra de Texto No Carimbo, OU=Teste, ${cert.issuer.attributes
      .map((a: any) => `${a.shortName ?? a.name}=${a.value}`)
      .join(', ')}`,
    thumbprintSha256: '052295E95BB4DB1BAFDC0A1FB2CB61A54FFD737FB159E4F02F25973C93FBDB01',
    validTo: '2027-11-04T11:18:17.628Z',
  }
})

function pageOf(width: number, height: number): any {
  return { getSize: () => ({ width, height }) }
}

describe('carimbo premium (AurumBit Portal)', () => {
  it('tamanho desenhado e adotado exatamente, limitado apenas pelo piso anti-degenerado', () => {
    const rect = resolveCustomStampRect(pageOf(595, 842), 0.2, 0.2, 0.05, 0.03)
    // 0.05*595 = 29.75 pt -> piso absoluto; 0.03*842 = 25.26 pt -> acima do piso
    expect(rect.width).toBe(SIGNATURE_STAMP_FLOOR.width)
    expect(rect.height).toBeCloseTo(0.03 * 842, 6)
    // Tamanho real desenhado: sem inflacao (comportamento Adobe Reader)
    const exact = resolveCustomStampRect(pageOf(595, 842), 0.2, 0.2, 0.18, 0.08)
    expect(exact.width).toBeCloseTo(0.18 * 595, 6)
    expect(exact.height).toBeCloseTo(0.08 * 842, 6)
  })

  it('quebra de texto nunca excede a largura do quadro', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    const longName = 'MARIA FERNANDA SOUZA SILVA OLIVEIRA SANTOS DESSA FORMA NOME ENORME'
    const wrapped = wrapText(longName, fonts.bold, 10.5, 200)
    expect(wrapped.length).toBeGreaterThan(0)
    for (const line of wrapped) {
      expect(fonts.bold.widthOfTextAtSize(line, 10.5)).toBeLessThanOrEqual(200)
    }
    const noSpace = wrapText('X'.repeat(120), fonts.regular, 7, 150)
    expect(noSpace.length).toBeGreaterThan(1)
    for (const line of noSpace) {
      expect(fonts.regular.widthOfTextAtSize(line, 7)).toBeLessThanOrEqual(150)
    }
  })

  it('QR fica auto-contido na lateral direita (sem cobrir os dados)', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    const fontOf = (key: 'bold' | 'regular' | 'oblique') =>
      key === 'bold' ? fonts.bold : key === 'oblique' ? fonts.oblique : fonts.regular
    for (const size of [
      { width: SIGNATURE_STAMP_MIN.width, height: SIGNATURE_STAMP_MIN.height },
      { width: 220, height: 130 },
      { width: 250, height: 128 },
      { width: 320, height: 150 },
      { width: 180, height: 70 }, // abaixo do minimo: degrada, mas nunca invade a coluna do QR
    ]) {
      const layout = computeStampLayout({
        width: size.width,
        height: size.height,
        signerName: material.holderName,
        documentLine: '123.456.789-09',
        signedAt: new Date('2026-11-09T15:00:00Z'),
        issuerLine: `Emissor: ${material.issuerDn.slice(0, 80)}`,
        fonts,
        hasLogo: true,
      })
      // QR dentro do quadro, na lateral direita, proporcional.
      expect(layout.qrSize).toBeGreaterThanOrEqual(16)
      expect(layout.qrX).toBeGreaterThanOrEqual(0)
      expect(layout.qrX + layout.qrSize).toBeLessThanOrEqual(size.width)
      expect(layout.qrY).toBeGreaterThanOrEqual(0)
      expect(layout.qrY + layout.qrSize).toBeLessThanOrEqual(size.height)
      expect(layout.qrX).toBeGreaterThanOrEqual(size.width / 2)
      // Bloco de texto na coluna esquerda: termina ANTES da coluna do QR.
      for (const line of layout.lines) {
        const w = fontOf(line.font).widthOfTextAtSize(line.text, line.size)
        expect(line.x + w).toBeLessThanOrEqual(layout.qrX - 1)
        expect(line.y).toBeGreaterThanOrEqual(2)
        expect(line.y + line.size).toBeLessThanOrEqual(size.height)
      }
    }
  })

  it('layout cabe no quadro em qualquer tamanho (inclusive abaixo do minimo)', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    for (const size of [
      { width: 220, height: 94 },
      { width: 270, height: 112 },
      { width: 330, height: 132 },
      { width: 180, height: 70 },
    ]) {
      const layout = computeStampLayout({
        width: size.width,
        height: size.height,
        signerName: material.holderName,
        documentLine: '123.456.789-09',
        signedAt: new Date('2026-11-09T15:00:00Z'),
        issuerLine: `Emissor: ${material.issuerDn.slice(0, 80)}`,
        fonts,
      })
      // Título do cabeçalho presente.
      expect(layout.headerLines.length).toBeGreaterThan(0)
      expect(layout.headerLines[0]!.text).toBe(STAMP_TITLE)
      const all = [...layout.lines]
      const fontOf = (key: 'bold' | 'regular' | 'oblique') =>
        key === 'bold' ? fonts.bold : key === 'oblique' ? fonts.oblique : fonts.regular
      for (const line of all) {
        expect(line.y).toBeGreaterThanOrEqual(2)
        expect(line.y).toBeLessThan(size.height)
        expect(
          line.x + fontOf(line.font).widthOfTextAtSize(line.text, line.size),
        ).toBeLessThanOrEqual(size.width + 0.5)
      }
    }
  })

  it('layout encolhe proporcionalmente em quadros pequenos (abaixo do natural)', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    const fontOf = (key: 'bold' | 'regular' | 'oblique') =>
      key === 'bold' ? fonts.bold : key === 'oblique' ? fonts.oblique : fonts.regular
    for (const size of [
      { width: 96, height: 54 },
      { width: 64, height: 34 },
    ]) {
      const layout = computeStampLayout({
        width: size.width,
        height: size.height,
        signerName: material.holderName,
        documentLine: '123.456.789-09',
        signedAt: new Date('2026-11-09T15:00:00Z'),
        issuerLine: `Emissor: ${material.issuerDn.slice(0, 80)}`,
        fonts,
        hasLogo: true,
      })
      // Título presente (encolhido) e todas as linhas dentro do quadro.
      expect(layout.headerLines.length).toBe(1)
      for (const line of layout.lines) {
        expect(line.y).toBeGreaterThanOrEqual(2)
        expect(line.y + line.size).toBeLessThanOrEqual(size.height)
        expect(
          line.x + fontOf(line.font).widthOfTextAtSize(line.text, line.size),
        ).toBeLessThanOrEqual(size.width + 0.5)
      }
      // QR auto-contido, na lateral direita.
      expect(layout.qrSize).toBeGreaterThanOrEqual(3)
      expect(layout.qrX).toBeGreaterThanOrEqual(0)
      expect(layout.qrX + layout.qrSize).toBeLessThanOrEqual(size.width)
      expect(layout.qrY).toBeGreaterThanOrEqual(0)
      expect(layout.qrY + layout.qrSize).toBeLessThanOrEqual(size.height)
    }
  })

  it('QR proporcional ao bloco interno, escaneavel e nunca sobre os dados', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    const fontOf = (key: 'bold' | 'regular' | 'oblique') =>
      key === 'bold' ? fonts.bold : key === 'oblique' ? fonts.oblique : fonts.regular
    const { size: modules } = qrModuleCountAndData()
    for (const size of [
      { width: 140, height: 104 }, // natural
      { width: 220, height: 130 },
      { width: 320, height: 150 },
      { width: 150, height: 70 },
      { width: 96, height: 54 },
    ]) {
      const layout = computeStampLayout({
        width: size.width,
        height: size.height,
        signerName: material.holderName,
        documentLine: '123.456.789-09',
        signedAt: new Date('2026-11-09T15:00:00Z'),
        issuerLine: `Emissor: ${material.issuerDn.slice(0, 80)}`,
        fonts,
        hasLogo: true,
      })
      // Proporcional: o QR ocupa a área útil, mas nunca ultrapassa a
      // metade direita do quadro (45% da largura) nem a altura.
      expect(layout.qrSize).toBeLessThanOrEqual(Math.floor(size.width * 0.45))
      expect(layout.qrSize).toBeLessThanOrEqual(size.height)
      // Legível: largura do módulo viável para escaneamento.
      expect(layout.qrSize / modules).toBeGreaterThanOrEqual(0.6)
      // Texto NUNCA entra na moldura/quiet zone do QR.
      for (const line of layout.lines) {
        const w = fontOf(line.font).widthOfTextAtSize(line.text, line.size)
        expect(line.x + w).toBeLessThanOrEqual(layout.qrX - layout.qrPad - 1)
      }
      // Moldura auto-contida dentro do quadro.
      expect(layout.qrX - layout.qrPad).toBeGreaterThanOrEqual(0)
      expect(layout.qrX + layout.qrSize + layout.qrPad).toBeLessThanOrEqual(size.width)
      expect(layout.qrY - layout.qrPad).toBeGreaterThanOrEqual(0)
      expect(layout.qrY + layout.qrSize + layout.qrPad).toBeLessThanOrEqual(size.height)
    }
  })

  it('no tamanho minimo, nada e descartado: titulo e todos os dados cabem', async () => {
    const doc = await PDFDocument.create()
    const fonts = await prepareFonts(doc)
    const layout = computeStampLayout({
      width: SIGNATURE_STAMP_MIN.width,
      height: SIGNATURE_STAMP_MIN.height,
      signerName: material.holderName,
      documentLine: '123.456.789-09',
      signedAt: new Date('2026-11-09T15:00:00Z'),
      issuerLine: `Emissor: ${material.issuerDn.slice(0, 80)}`,
      fonts,
    })
    // Título + nome, documento, emissor e data presentes e dentro dos limites.
    expect(layout.headerLines[0]!.text).toBe(STAMP_TITLE)
    const dataJoined = layout.lines.map((l) => l.text).join(' ')
    expect(dataJoined).toContain('MARIA FERNANDA')
    expect(dataJoined).toContain('123.456.789-09')
    expect(dataJoined).toContain('Emissor:')
    expect(dataJoined).toContain('Data:')
    for (const line of layout.lines) {
      expect(line.y).toBeGreaterThanOrEqual(2)
      expect(line.y + line.size).toBeLessThanOrEqual(SIGNATURE_STAMP_MIN.height)
    }
  })

  it('assina com titulo, emissor e selo ITI, sem localizacao e sem legenda', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const original = Buffer.from(await doc.save())
    const signed = await signPdfDocument({
      fileName: 'premium.pdf',
      pdfBytes: original,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.2,
      yPct: 0.2,
      size: 'small',
      tsaUrl: 'not-a-url',
    })
    expect(await verifySignedPdf(signed.pdf)).toBe(true)
    const latin = signed.pdf.toString('latin1')
    const text = pdfText(signed.pdf)
    expect(text).toContain(STAMP_TITLE)
    expect(text).not.toContain('rastreabilidade')
    expect(text).not.toContain('plataforma AurumBit Portal')
    expect(text).toContain('Emissor')
    expect(text).not.toContain('Local:')
    expect(text).not.toContain('nao informada')
    expect(latin).toContain('/Subtype /Image')
  }, 60000)

  it('segunda assinatura (incremental) mantem titulo e selo ITI', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const original = Buffer.from(await doc.save())
    const first = await signPdfDocument({
      fileName: 'premium.pdf',
      pdfBytes: original,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'small',
      tsaUrl: 'not-a-url',
    })
    const second = await signPdfDocument({
      fileName: 'premium2.pdf',
      pdfBytes: Buffer.from(first.pdf),
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.3,
      yPct: 0.3,
      size: 'small',
      tsaUrl: 'not-a-url',
    })
    expect(await verifySignedPdf(second.pdf)).toBe(true)
    const latin = second.pdf.toString('latin1')
    const text = pdfText(second.pdf)
    expect(latin).toContain('/Im1')
    expect(latin).toContain('/Subtype /Image')
    expect(text).toContain(STAMP_TITLE)
    expect(text).not.toContain('rastreabilidade')
    expect(text).not.toContain('plataforma AurumBit Portal')
    expect(text).not.toContain('Local:')
  }, 60000)
})
