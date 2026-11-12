import { randomBytes } from 'node:crypto'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

/**
 * Cliente de carimbo de tempo RFC 3161 para o carimbo PAdES-B-T.
 *
 * A TSA recebe APENAS o imprint SHA-256 do valor da assinatura — nunca o
 * conteúdo do PDF. O token retornado (TimeStampToken) é anexado como
 * unsigned attribute 1.2.840.113549.1.9.16.1.4 no CMS.
 */

export class TsaError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'TsaError'
  }
}

export interface TimeStampResult {
  /** DER completo do ContentInfo(TimeStampToken). */
  tokenDer: Buffer
  genTime: Date
  serialHex: string
  tsaHost: string
}

const REQUEST_TIMEOUT_MS = 12_000
const MAX_RESPONSE_BYTES = 1024 * 1024

function toUint8Array(value: ArrayBuffer | Uint8Array | Buffer): Uint8Array {
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new TsaError('Resposta da TSA excedeu o tamanho maximo esperado')
  }
  if (!response.body) throw new TsaError('Resposta vazia da TSA')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new TsaError('Resposta da TSA excedeu o tamanho maximo esperado')
    }
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export async function buildTimeStampRequest(
  message: ArrayBuffer | Uint8Array | Buffer,
  policyOid?: string,
): Promise<ArrayBuffer> {
  // MessageImprint.create calcula o hash — passar os bytes crus (valor da assinatura).
  const imprint = await pkijs.MessageImprint.create(
    'SHA-256',
    toUint8Array(message) as unknown as Uint8Array,
  )
  const nonce = new asn1js.Integer({ valueHex: randomBytes(16) as unknown as Uint8Array })
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: imprint,
    certReq: true,
    nonce,
    ...(policyOid ? { reqPolicy: policyOid } : {}),
  })
  return request.toSchema().toBER()
}

export async function requestTimestamp(
  tsaUrl: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<TimeStampResult> {
  if (!/^https?:\/\//i.test(tsaUrl)) {
    throw new TsaError('A URL da TSA deve ser HTTP ou HTTPS')
  }
  const body = await buildTimeStampRequest(data)

  let response: Response
  try {
    response = await fetch(tsaUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/timestamp-query',
        accept: 'application/timestamp-reply',
        'user-agent': 'AurumBit Portal/0.1 (desktop)',
      },
      body: Buffer.from(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new TsaError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'A TSA nao respondeu dentro do tempo limite (12 s). Verifique a URL e a conexao.'
        : 'Falha ao contatar a TSA. Verifique a URL e a rede.',
      error,
    )
  }

  if (!response.ok) {
    throw new TsaError(`A TSA respondeu com HTTP ${response.status}`)
  }

  const payload = await readCapped(response, MAX_RESPONSE_BYTES)

  let parsed: pkijs.TimeStampResp
  try {
    parsed = new pkijs.TimeStampResp({ schema: asn1js.fromBER(payload).result })
  } catch (error) {
    throw new TsaError('Resposta da TSA nao contem um TimeStampResp valido', error)
  }

  const status = parsed.status?.status
  if (status !== pkijs.PKIStatus.granted && status !== pkijs.PKIStatus.grantedWithMods) {
    throw new TsaError(`TSA recusou o carimbo (status ${String(status ?? 'desconhecido')})`)
  }

  const token = parsed.timeStampToken
  if (!token) {
    throw new TsaError('TSA concedeu o carimbo, mas nao enviou o TimeStampToken')
  }

  // Extrai serial e data do TSTInfo (encapContentInfo => SignedData => TSTInfo).
  let signingTime: Date | undefined
  let serialHex = ''
  try {
    const signedData = new pkijs.SignedData({ schema: token.content })
    const eContent = signedData.encapContentInfo?.eContent
    if (eContent) {
      const tstInfo = pkijs.TSTInfo.fromBER(eContent.getValue())
      signingTime = tstInfo.genTime
      serialHex = Buffer.from(tstInfo.serialNumber.valueBlock.valueHex)
        .toString('hex')
        .toUpperCase()
    }
  } catch {
    // Token presente mas com estrutura inesperada: falha fechada sem expor detalhes.
    throw new TsaError('TimeStampToken recebido esta malformado')
  }

  return {
    tokenDer: Buffer.from(token.toSchema().toBER()),
    genTime: signingTime ?? new Date(),
    serialHex,
    tsaHost: new URL(tsaUrl).host,
  }
}

/**
 * Testa se a TSA configurada responde a uma requisicao de carimbo valida
 * (usa um imprint fixo de documento vazio como probe).
 */
export async function testTsa(
  tsaUrl: string,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const started = Date.now()
  try {
    await requestTimestamp(tsaUrl, Buffer.from('aurumbit-portal-tsa-probe', 'utf8'))
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: 'TSA respondeu e concedeu o carimbo de tempo.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao contatar a TSA'
    return { ok: false, latencyMs: Date.now() - started, message }
  }
}
