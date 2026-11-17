import { createHash, randomBytes } from 'node:crypto'
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

async function buildTimeStampRequestWithNonce(
  message: ArrayBuffer | Uint8Array | Buffer,
): Promise<{ body: ArrayBuffer; nonceHex: string }> {
  const imprint = await pkijs.MessageImprint.create(
    'SHA-256',
    toUint8Array(message) as unknown as Uint8Array,
  )
  const nonceBytes = randomBytes(16)
  const nonce = new asn1js.Integer({ valueHex: nonceBytes as unknown as Uint8Array })
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: imprint,
    certReq: true,
    nonce,
  })
  return { body: request.toSchema().toBER(), nonceHex: Buffer.from(nonceBytes).toString('hex') }
}

export async function buildTimeStampRequest(
  message: ArrayBuffer | Uint8Array | Buffer,
  policyOid?: string,
): Promise<ArrayBuffer> {
  // Política customizada não é usada internamente; mantida pela API estável.
  void policyOid
  const { body } = await buildTimeStampRequestWithNonce(message)
  return body
}

export async function requestTimestamp(
  tsaUrl: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<TimeStampResult> {
  // HTTPS é obrigatório: HTTP expõe o imprint a substituição de TSA e
  // permitiria carimbo forjado por um MITM na mesma rede.
  if (!/^https:\/\//i.test(tsaUrl)) {
    throw new TsaError('A URL da TSA deve usar HTTPS')
  }
  const { body, nonceHex } = await buildTimeStampRequestWithNonce(data)

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

  // Extrai serial, data e TSTInfo para verificar o token antes de anexá-lo.
  let signingTime: Date | undefined
  let serialHex = ''
  try {
    const signedData = new pkijs.SignedData({ schema: token.content })
    const eContent = signedData.encapContentInfo?.eContent
    if (!eContent) {
      throw new TsaError('TimeStampToken nao contem o TSTInfo')
    }
    const tstInfo = pkijs.TSTInfo.fromBER(eContent.getValue())
    // 1) O messageImprint precisa bater exatamente com o SHA-256 do dado
    //    enviado — senão o carimbo é de outro dado (ou de outra requisição).
    //    Um hash de 32 bytes igual está matematicamente ligado ao SHA-256.
    const expectedHash = createHash('sha256')
      .update(Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array))
      .digest('hex')
    const actualHash = Buffer.from(tstInfo.messageImprint.hashedMessage.valueBlock.valueHex)
      .toString('hex')
      .toLowerCase()
    if (actualHash !== expectedHash) {
      throw new TsaError('messageImprint do token nao corresponde ao dado carimbado')
    }
    // 2) O nonce devolvido precisa ser obrigatoriamente o que enviamos
    //    (RFC 3161 — a TSA DEVE devolver o nonce do TimeStampReq). Sem isso,
    //    não há prova de que o token pertence a esta requisição.
    const stripLeadingZero = (buffer: Buffer) =>
      buffer.length > 0 && buffer[0] === 0 ? buffer.subarray(1) : buffer
    const sent = stripLeadingZero(Buffer.from(nonceHex, 'hex'))
    const echoedValue = tstInfo.nonce?.valueBlock?.valueHex
    if (!echoedValue) {
      throw new TsaError('A TSA nao devolveu o nonce — token rejeitado')
    }
    const echoed = stripLeadingZero(Buffer.from(echoedValue))
    if (sent.length !== echoed.length || !sent.equals(echoed)) {
      throw new TsaError('nonce do token nao corresponde a requisicao enviada')
    }
    signingTime = tstInfo.genTime
    serialHex = Buffer.from(tstInfo.serialNumber.valueBlock.valueHex).toString('hex').toUpperCase()
  } catch (error) {
    // Token presente mas com estrutura inesperada: falha fechada sem expor detalhes.
    if (error instanceof TsaError) throw error
    throw new TsaError('TimeStampToken recebido esta malformado', error)
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
