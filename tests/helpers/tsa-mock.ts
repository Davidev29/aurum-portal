/**
 * Mock de TSA RFC 3161 para testes de assinatura PAdES-B-T.
 *
 * Responde um TimeStampResp válido ECOANDO o messageImprint e o nonce da
 * requisição (o cliente valida ambos — ver electron/main/pdf/timestamp.ts).
 * A assinatura do token usa a própria chave do certificado de teste.
 */
import { vi } from 'vitest'
import forge from 'node-forge'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

export interface ValidTsaMockInput {
  /** Certificado forge do certificado de teste (scripts/spike/.certs). */
  cert: forge.pki.Certificate
  privateKey: forge.pki.rsa.PrivateKey
}

export function makeValidTsaMock({ cert, privateKey }: ValidTsaMockInput) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as Buffer | Uint8Array
    const req = pkijs.TimeStampReq.fromBER(body instanceof Buffer ? body : Buffer.from(body))
    const imprint = req.messageImprint.hashedMessage.valueBlock.valueHex
    const crypto = pkijs.getCrypto(true)
    const tstInfo = new pkijs.TSTInfo({
      version: 1,
      policy: '1.2.3.4.5',
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: req.messageImprint.hashAlgorithm,
        hashedMessage: new asn1js.OctetString({ valueHex: imprint }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: new Date(),
      nonce: req.nonce,
    })
    const certWithKey = {
      certificate: pkijs.Certificate.fromBER(
        Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'),
      ),
      privateKey,
    }
    const rsaDer = forge.asn1.toDer(forge.pki.privateKeyToAsn1(privateKey)).getBytes()
    const pkcs8 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
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
    const webKey = await crypto.subtle.importKey(
      'pkcs8',
      Buffer.from(forge.asn1.toDer(pkcs8).getBytes(), 'binary'),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const cms = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: '1.2.840.113549.1.9.16.1.4',
        eContent: new asn1js.OctetString({ valueHex: tstInfo.toSchema().toBER() }),
      }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({
            issuer: certWithKey.certificate.issuer,
            serialNumber: certWithKey.certificate.serialNumber,
          }),
        }),
      ],
      certificates: [certWithKey.certificate],
    })
    await cms.sign(webKey, 0, 'SHA-256')
    const resp = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
      timeStampToken: new pkijs.ContentInfo({
        schema: new pkijs.ContentInfo({
          contentType: '1.2.840.113549.1.7.2',
          content: cms.toSchema(true),
        }).toSchema(),
      }),
    })
    return new Response(Buffer.from(resp.toSchema().toBER()), {
      status: 200,
      headers: { 'content-type': 'application/timestamp-reply' },
    })
  })
}
