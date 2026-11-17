import forge from 'node-forge'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { requestTimestamp, TsaError } from './timestamp'

/**
 * Montagem do contêiner CMS (PKCS#7) CAdES detached para PAdES-B-T.
 *
 * Estrutura produzida:
 *   ContentInfo (signedData)
 *     └─ SignedData
 *          encapContentInfo { eContentType: data }   // sem conteúdo (detached)
 *          certificates [certs do PFX, signer first]
 *          signerInfos [ SignerInfo ]
 *            signedAttrs   contentType | signingTime | messageDigest
 *            signature     RSA/SHA-256 sobre o DER do SET OF signedAttrs
 *            unsignedAttrs signatureTimeStampToken (OID 1.2.840.113549.1.9.16.1.4)
 *
 * Nada aqui toca disco, console ou rede além do parâmetro tsaUrl.
 */

export class CmsError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CmsError'
  }
}

export interface PfxMaterial {
  privateKey: forge.pki.rsa.PrivateKey
  certificates: forge.pki.Certificate[]
  subjectCertificate: forge.pki.Certificate
}

/** Extrai chave privada RSA e certificados do PFX/P12 (senha errada → erro PT-BR). */
export function loadPfx(pfxInput: Buffer, password: string): PfxMaterial {
  // WorkerData chega como Uint8Array — normaliza para Buffer para
  // toString('binary') (latin1) ficar correto.
  const pfx = Buffer.isBuffer(pfxInput) ? pfxInput : Buffer.from(pfxInput as unknown as Uint8Array)
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const p12Asn1 = forge.asn1.fromDer(pfx.toString('binary'))
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password)
  } catch (error) {
    throw new CmsError('Senha do PFX incorreta ou arquivo corrompido', error)
  }

  const oidShrouded = forge.pki.oids.pkcs8ShroudedKeyBag as string
  const oidKeyBag = forge.pki.oids.keyBag as string
  const oidPkcs8 = forge.pki.oids.pkcs8KeyBag as string
  const oidCertBag = forge.pki.oids.certBag as string

  const shrouded = (p12.getBags({ bagType: oidShrouded })[oidShrouded] ?? []) as forge.pkcs12.Bag[]
  const unencrypted = (p12.getBags({ bagType: oidKeyBag })[oidKeyBag] ?? []) as forge.pkcs12.Bag[]
  const pkcs8 = (p12.getBags({ bagType: oidPkcs8 })[oidPkcs8] ?? []) as forge.pkcs12.Bag[]
  const keyBag = shrouded[0] ?? unencrypted[0] ?? pkcs8[0]
  const privateKey = (keyBag?.key as forge.pki.rsa.PrivateKey | undefined) ?? null
  if (!privateKey) {
    throw new CmsError('O PFX nao contem uma chave privada RSA utilizavel')
  }

  const certBags = (p12.getBags({ bagType: oidCertBag })[oidCertBag] ?? []) as forge.pkcs12.Bag[]
  const certificates = certBags.map((bag) => bag.cert).filter(Boolean) as forge.pki.Certificate[]
  if (certificates.length === 0) {
    throw new CmsError('O PFX nao contem certificados')
  }

  // O certificado assinante é o que casa com a chave privada (compare pelo módulo).
  const subject =
    certificates.find(
      (cert) => (cert.publicKey as forge.pki.rsa.PublicKey).n.compareTo(privateKey.n) === 0,
    ) ?? certificates[0]
  if (!subject) {
    throw new CmsError('Nao foi possivel associar o certificado a chave privada')
  }
  return { privateKey, certificates, subjectCertificate: subject }
}

/** Envolve a RSAPrivateKey PKCS#1 em PrivateKeyInfo PKCS#8 para o WebCrypto. */
export function exportPkcs8Der(key: forge.pki.rsa.PrivateKey): Buffer {
  const rsaDer = forge.asn1.toDer(forge.pki.privateKeyToAsn1(key)).getBytes()
  const info = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.INTEGER,
      false,
      forge.asn1.integerToDer(0).getBytes(),
    ),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(forge.pki.oids.rsaEncryption as string).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
    ]),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, rsaDer),
  ])
  return Buffer.from(forge.asn1.toDer(info).getBytes(), 'binary')
}

function forgeCertToDer(cert: forge.pki.Certificate): Buffer {
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
}

async function getSubtle(): Promise<any> {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle
  const { webcrypto } = await import('node:crypto')
  return webcrypto.subtle
}

const OID_CONTENT_TYPE_DATA = '1.2.840.113549.1.9.3'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_DATA = '1.2.840.113549.1.7.1'
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_SIGNATURE_TIME_STAMP_TOKEN = '1.2.840.113549.1.9.16.1.4'

/**
 * Assina `data` (detached) com o PFX e retorna o ContentInfo DER (Buffer).
 */
export interface BuiltDetachedCms {
  der: Buffer
  /** Host da TSA usada, ou null quando assinado offline sem carimbo (PAdES-B). */
  tsaHost: string | null
}

export async function buildDetachedCmsWithInfo(options: {
  data: Buffer
  pfx: Buffer
  password: string
  tsaUrl: string
  signingTime?: Date
}): Promise<BuiltDetachedCms> {
  const { data, pfx, password, tsaUrl } = options
  const signingTime = options.signingTime ?? new Date()

  const material = loadPfx(pfx, password)
  const pkijsCerts = material.certificates.map((cert) =>
    pkijs.Certificate.fromBER(forgeCertToDer(cert)),
  )
  const subjectPkijs = pkijs.Certificate.fromBER(forgeCertToDer(material.subjectCertificate))

  const subtle = await getSubtle()
  const pkcs8Der = exportPkcs8Der(material.privateKey)
  const privateKey = await subtle.importKey(
    'pkcs8',
    pkcs8Der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // Zeroiza o PKCS#8 intermediário assim que a chave importada existe.
  pkcs8Der.fill(0)

  const digest = await subtle.digest('SHA-256', data)

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: OID_CONTENT_TYPE_DATA,
        values: [new asn1js.ObjectIdentifier({ value: OID_DATA })],
      }),
      new pkijs.Attribute({
        type: OID_SIGNING_TIME,
        values: [new asn1js.UTCTime({ valueDate: signingTime })],
      }),
      new pkijs.Attribute({
        type: OID_MESSAGE_DIGEST,
        values: [new asn1js.OctetString({ valueHex: digest })],
      }),
    ],
  })

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: subjectPkijs.issuer,
      serialNumber: subjectPkijs.serialNumber,
    }),
    signedAttrs,
  })

  const cms = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID_DATA }),
    certificates: pkijsCerts,
    signerInfos: [signerInfo],
  })

  await cms.sign(privateKey, 0, 'SHA-256', data)

  const signatureValue = cms.signerInfos[0]?.signature?.valueBlock.valueHex
  if (!signatureValue || (signatureValue as ArrayBuffer).byteLength === 0) {
    throw new CmsError('O CMS nao foi assinado — assinatura vazia')
  }
  const signatureBytes = Buffer.from(signatureValue as ArrayBuffer)

  // Carimbo de tempo RFC 3161 sobre o VALOR da assinatura.
  // Fail-closed: sem um carimbo válido, a assinatura é CANCELADA — nunca se
  // produz um PAdES-B silencioso fingindo ser PAdES-B-T. Ver ADR-0008.
  let tsaHost: string | null = null
  try {
    const timestamp = await requestTimestamp(tsaUrl, signatureBytes)
    const tokenContentInfo = new pkijs.ContentInfo({
      schema: asn1js.fromBER(timestamp.tokenDer).result,
    })
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [
        new pkijs.Attribute({
          type: OID_SIGNATURE_TIME_STAMP_TOKEN,
          values: [tokenContentInfo.toSchema()],
        }),
      ],
    })
    tsaHost = timestamp.tsaHost
  } catch (error) {
    if (!(error instanceof TsaError)) throw error
    throw new CmsError(`Carimbo de tempo indisponível — assinatura cancelada: ${error.message}`)
  }

  const contentInfo = new pkijs.ContentInfo({
    contentType: OID_SIGNED_DATA,
    content: cms.toSchema(true),
  })
  return { der: Buffer.from(contentInfo.toSchema().toBER()), tsaHost }
}

export async function buildDetachedCms(options: {
  data: Buffer
  pfx: Buffer
  password: string
  tsaUrl: string
  signingTime?: Date
}): Promise<Buffer> {
  const { der } = await buildDetachedCmsWithInfo(options)
  return der
}
