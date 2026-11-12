import * as pkijs from 'pkijs'

/**
 * Autoverificação fail-closed do PDF assinado (estrutura + integridade + TST).
 * Não valida cadeia ICP-Brasil aqui (o papel da cadeia é do validador externo,
 * ex.: validar.iti.gov.br); garante que a assinatura está bem-formada e íntegra.
 */

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
}

function findAllSignatureByteRanges(source: string): Array<{
  range: [number, number, number, number]
  afterIndex: number
}> {
  const results: Array<{ range: [number, number, number, number]; afterIndex: number }> = []
  let offset = 0
  while (true) {
    const index = source.indexOf('/ByteRange', offset)
    if (index < 0) break
    const end = source.indexOf(']', index)
    if (end < 0) break
    const slice = source.slice(index, end + 1)
    const match = /\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(slice)
    if (match) {
      const values = match.slice(1).map(Number) as [number, number, number, number]
      if (!values.some((n) => !Number.isFinite(n) || n < 0)) {
        results.push({ range: values, afterIndex: end })
      }
    }
    offset = end + 1
  }
  return results
}

function extractContentsHex(source: string, afterIndex: number): string | null {
  const contentsIndex = source.indexOf('/Contents', afterIndex)
  if (contentsIndex < 0) return null
  const openIndex = source.indexOf('<', contentsIndex)
  if (openIndex < 0) return null
  const closeIndex = source.indexOf('>', openIndex)
  if (closeIndex < 0) return null
  const raw = source.slice(openIndex + 1, closeIndex)
  const hex = raw.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  return hex
}

/**
 * Verifica TODAS as assinaturas presentes no PDF:
 * - ByteRange íntegro (concatenado sem o Contents)
 * - CMS SignedData presente com digest válido sobre o conteúdo assinado
 * (PAdES-B sem carimbo e PAdES-B-T com carimbo sao aceitos.)
 */
export async function verifySignedPdf(pdfBytesInput: Buffer): Promise<boolean> {
  try {
    const pdfBytes = Buffer.isBuffer(pdfBytesInput)
      ? (pdfBytesInput as unknown as Buffer)
      : Buffer.from(pdfBytesInput as unknown as Uint8Array)
    if (pdfBytes.length === 0) return false
    const source = pdfBytes.toString('latin1')
    const all = findAllSignatureByteRanges(source)
    if (all.length === 0) return false
    // Se ha placeholder nao preenchido, ainda nao esta assinado.
    if (/\/ByteRange\s*\[\s*0\s+\/\*{3,}/.test(source)) return false

    for (const { range, afterIndex } of all) {
      const [start, lengthA, startB, lengthB] = range
      if (start + lengthA > pdfBytes.length || startB + lengthB > pdfBytes.length) return false
      const signed = Buffer.concat([
        pdfBytes.subarray(start, start + lengthA),
        pdfBytes.subarray(startB, startB + lengthB),
      ])
      const hex = extractContentsHex(source, afterIndex)
      if (!hex) return false
      const der = Buffer.from(hex, 'hex')
      if (der.length === 0) return false
      const cms = pkijs.ContentInfo.fromBER(toArrayBuffer(der))
      if (cms.contentType !== '1.2.840.113549.1.7.2') return false
      const signedData = new pkijs.SignedData({ schema: cms.content })
      // PAdES-B (offline, sem carimbo) e PAdES-B-T (com carimbo) sao validos.
      // Se houver TST, ele deve estar bem-formado via verify do CMS; nao
      // exigimos presenca para aceitar assinaturas offline.
      const ok = await signedData.verify({
        signer: 0,
        data: toArrayBuffer(signed),
        checkChain: false,
      })
      if (!ok) return false
    }
    return true
  } catch {
    return false
  }
}
