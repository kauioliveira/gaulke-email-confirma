import { createHash, createSign } from 'node:crypto'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { SignPdf } from '@signpdf/signpdf'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils'

/**
 * Selo PAdES (PDF assinado com o certificado A1), padrao B-B:
 * SubFilter ETSI.CAdES.detached, CMS com contentType + messageDigest +
 * signingCertificateV2 e sem signingTime (no PAdES a hora vai no /M da
 * assinatura). SEM carimbo do tempo (decisao D6: nada pago, sem TSA) — a hora
 * e a do servidor, em Sao Paulo.
 *
 * O CMS e montado aqui, e nao pelo pkcs7 do node-forge: ele so sabe gerar
 * tres atributos fixos (contentType, messageDigest, signingTime) e o PAdES exige
 * o signingCertificateV2. O forge entra so para ler certificados e escrever
 * ASN.1; a assinatura RSA e do crypto do proprio Node.
 */

const { asn1, pki } = forge
const U = asn1.Class.UNIVERSAL
const T = asn1.Type

const oid = (o: string) => asn1.create(U, T.OID, false, asn1.oidToDer(o).getBytes())
const seq = (v: forge.asn1.Asn1[]) => asn1.create(U, T.SEQUENCE, true, v)
const nulo = () => asn1.create(U, T.NULL, false, '')
const octeto = (b: Buffer) => asn1.create(U, T.OCTETSTRING, false, b.toString('binary'))
const inteiro = (n: number) => asn1.create(U, T.INTEGER, false, asn1.integerToDer(n).getBytes())
const der = (a: forge.asn1.Asn1) => Buffer.from(asn1.toDer(a).getBytes(), 'binary')

/** SET OF em DER: os elementos vao ordenados pela codificacao (X.690 11.6). */
function conjunto(itens: forge.asn1.Asn1[], classe = U, tipo: number = T.SET) {
  const ordenados = [...itens].sort((a, b) => Buffer.compare(der(a), der(b)))
  return asn1.create(classe, tipo, true, ordenados)
}

const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  rsa: '1.2.840.113549.1.1.1',
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47'
}

export function certificadosDoPem(pem: string) {
  return pem
    .split(/(?=-----BEGIN CERTIFICATE-----)/)
    .filter(p => p.includes('BEGIN CERTIFICATE'))
    .map(p => pki.certificateFromPem(p))
}

/** INTEGER a partir do serial em hex, positivo em complemento de dois. */
function serialAsn1(hex: string) {
  let bytes = forge.util.hexToBytes(hex.length % 2 ? `0${hex}` : hex)
  if (bytes.charCodeAt(0) & 0x80) bytes = `\0${bytes}`
  return asn1.create(U, T.INTEGER, false, bytes)
}

/** CMS SignedData destacado (o conteudo nao vai dentro) sobre `conteudo`. */
export function cmsDestacado(conteudo: Buffer, certPem: string, keyPem: string): Buffer {
  const certs = certificadosDoPem(certPem)
  const titular = certs[0]
  if (!titular) throw new Error('certificado vazio')
  const algSha256 = seq([oid(OID.sha256), nulo()])
  const issuerSerial = seq([pki.distinguishedNameToAsn1(titular.issuer), serialAsn1(titular.serialNumber)])

  const atributos = [
    seq([oid(OID.contentType), conjunto([oid(OID.data)])]),
    seq([oid(OID.messageDigest), conjunto([octeto(createHash('sha256').update(conteudo).digest())])]),
    // SigningCertificateV2 { certs: SEQUENCE OF ESSCertIDv2 { certHash, issuerSerial } } (hash sha256 = padrao, omitido)
    seq([
      oid(OID.signingCertificateV2),
      conjunto([
        seq([
          seq([
            seq([
              octeto(createHash('sha256').update(der(pki.certificateToAsn1(titular))).digest()),
              seq([seq([asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [pki.distinguishedNameToAsn1(titular.issuer)])]), serialAsn1(titular.serialNumber)])
            ])
          ])
        ])
      ])
    ])
  ]

  // o que se assina e o SET dos atributos (tag 0x31); no SignerInfo ele vai como [0] IMPLICIT
  const assinados = conjunto(atributos)
  const assinatura = createSign('sha256').update(der(assinados)).sign(keyPem)

  const signerInfo = seq([
    inteiro(1),
    issuerSerial,
    algSha256,
    conjunto(atributos, asn1.Class.CONTEXT_SPECIFIC, 0),
    seq([oid(OID.rsa), nulo()]),
    octeto(assinatura)
  ])
  const signedData = seq([
    inteiro(1),
    conjunto([algSha256]),
    seq([oid(OID.data)]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, certs.map(c => pki.certificateToAsn1(c))),
    conjunto([signerInfo])
  ])
  return der(seq([oid(OID.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]))
}

class SignerCades extends Signer {
  constructor(
    private certPem: string,
    private keyPem: string
  ) {
    super()
  }

  override async sign(pdf: Buffer): Promise<Buffer> {
    return cmsDestacado(pdf, this.certPem, this.keyPem)
  }
}

/**
 * Aplica o selo ao PDF. `pdf` precisa estar pronto (folha de assinaturas ja
 * incluida): qualquer byte mudado depois invalida o selo — e e isso que ele
 * garante.
 */
export async function selarPdf(
  pdf: Uint8Array,
  o: { certPem: string; keyPem: string; nome: string; motivo: string; local?: string; contato?: string }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf)
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: o.motivo,
    contactInfo: o.contato ?? '',
    name: o.nome,
    location: o.local ?? 'Brasil',
    signingTime: new Date(),
    // cadeia com 3-4 certificados passa de 6 KB; folga para nao estourar
    signatureLength: 16384,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: 'Gaulke Comunica'
  })
  // sem object streams: o signpdf procura o /ByteRange no texto do arquivo
  const comEspaco = await doc.save({ useObjectStreams: false })
  // instancia propria (e nao o default): o default do pacote CJS chega
  // diferente conforme quem importa (Nitro, tsx), e a classe e a mesma
  return new SignPdf().sign(Buffer.from(comEspaco), new SignerCades(o.certPem, o.keyPem))
}
