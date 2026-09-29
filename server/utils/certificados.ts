import { createHash } from 'node:crypto'
import forge from 'node-forge'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { useDb, certificados, type Certificado } from '../db'
import { cifrar, decifrar } from './cripto'

/**
 * Certificado A1 (e-CNPJ) da Gaulke.
 *
 * Mesmo desenho do cofre do painel (/fiscal/nfce/certificados): o .pfx e aberto
 * com node-forge — JS puro, que abre os PKCS#12 com RC2/3DES dos A1
 * brasileiros sem o --openssl-legacy-provider do Node 22 —, a chave privada e
 * guardada CIFRADA (AES-256-GCM, SMTP_CRYPTO_KEY) e a SENHA E DESCARTADA na
 * hora. Nao ha arquivo no disco nem senha no banco: o que vaza de um dump e o
 * certificado publico e um texto cifrado.
 */

export class ErroCertificado extends Error {}

export type DadosCertificado = {
  titular: string
  documento: string | null
  documentoTipo: 'CNPJ' | 'CPF' | null
  responsavel: string | null
  emissor: string | null
  serial: string
  fingerprintSha256: string
  validoDe: Date
  validoAte: Date
  icpBrasil: boolean
  cadeia: { assunto: string; emissor: string }[]
  certPem: string
  keyPem: string
}

// OIDs ICP-Brasil (DOC-ICP-04) no subjectAltName
const OID_CNPJ = '2.16.76.1.3.3'
const OID_RESPONSAVEL_NOME = '2.16.76.1.3.2'
const OID_PF_DADOS = '2.16.76.1.3.1'
const OID_RESPONSAVEL_DADOS = '2.16.76.1.3.4'

// tipos de "bag" do PKCS#12 (o @types do forge os declara opcionais)
const BAG_CHAVE_CIFRADA = '1.2.840.113549.1.12.10.1.2'
const BAG_CHAVE = '1.2.840.113549.1.12.10.1.1'
const BAG_CERT = '1.2.840.113549.1.12.10.1.3'

const binario = (b: Buffer) => forge.util.createBuffer(b.toString('binary'))

function nomeDe(attrs: forge.pki.CertificateField[]) {
  const cn = attrs.find(a => a.shortName === 'CN')?.value
  const o = attrs.find(a => a.shortName === 'O')?.value
  return String(cn || o || attrs.map(a => `${a.shortName}=${a.value}`).join(', '))
}

/** Valores de otherName do subjectAltName, por OID. */
function otherNames(cert: forge.pki.Certificate) {
  const saida = new Map<string, string>()
  const ext = cert.extensions.find(e => e.name === 'subjectAltName') as { value?: string } | undefined
  if (!ext?.value) return saida
  try {
    const seq = forge.asn1.fromDer(ext.value)
    for (const gn of (seq.value as forge.asn1.Asn1[]) ?? []) {
      // otherName = [0] { type-id OID, [0] EXPLICIT value }
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue
      const partes = gn.value as forge.asn1.Asn1[]
      const oid = forge.asn1.derToOid(partes[0]!.value as string)
      let v: forge.asn1.Asn1 | string = partes[1]!
      // desce ate o primeiro valor primitivo (OCTET STRING, PrintableString, UTF8...)
      while (typeof v !== 'string' && Array.isArray(v.value)) v = (v.value as forge.asn1.Asn1[])[0]!
      const texto = typeof v === 'string' ? v : String(v.value ?? '')
      saida.set(oid, forge.util.decodeUtf8(texto).replace(/\0/g, '').trim())
    }
  } catch {
    // SAN fora do padrao: os dados ICP ficam de fora, o resto segue
  }
  return saida
}

/**
 * Abre o .pfx/.p12 com a senha e extrai tudo o que o sistema precisa. Lanca
 * ErroCertificado com uma mensagem para a tela ("Senha incorreta"...).
 */
export function lerPfx(arquivo: Buffer, senha: string): DadosCertificado {
  let asn1: forge.asn1.Asn1
  try {
    asn1 = forge.asn1.fromDer(binario(arquivo))
  } catch {
    throw new ErroCertificado('O arquivo não é um certificado .pfx/.p12 válido.')
  }

  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/password|MAC could not be verified|decrypt/i.test(msg)) throw new ErroCertificado('Senha incorreta.')
    throw new ErroCertificado(`Não foi possível abrir o certificado: ${msg}`)
  }

  const bagsChave = [
    ...(p12.getBags({ bagType: BAG_CHAVE_CIFRADA })[BAG_CHAVE_CIFRADA] ?? []),
    ...(p12.getBags({ bagType: BAG_CHAVE })[BAG_CHAVE] ?? [])
  ]
  const chave = bagsChave.find(b => b.key)?.key as forge.pki.rsa.PrivateKey | undefined
  if (!chave) {
    // sem MAC, senha errada decifra lixo: a chave simplesmente nao aparece
    throw new ErroCertificado('Senha incorreta, ou o arquivo não contém a chave privada (só o certificado público).')
  }
  const certs = (p12.getBags({ bagType: BAG_CERT })[BAG_CERT] ?? [])
    .map(b => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c)
  if (!certs.length) throw new ErroCertificado('O arquivo não contém certificado (ou usa um algoritmo não suportado — só RSA).')

  const titularCert = certs.find(c => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(chave.n))
  if (!titularCert) throw new ErroCertificado('A chave privada não corresponde a nenhum certificado do arquivo.')

  // cadeia: do titular subindo pelos emissores presentes no arquivo
  const cadeia = [titularCert]
  for (let atual = titularCert; cadeia.length < 10; ) {
    if (atual.isIssuer(atual)) break // autoassinado: chegou na raiz
    const pai = certs.find(c => !cadeia.includes(c) && c.subject.hash === atual.issuer.hash)
    if (!pai) break
    cadeia.push(pai)
    atual = pai
  }

  const nomes = otherNames(titularCert)
  const cnpj = (nomes.get(OID_CNPJ) || '').replace(/\D/g, '')
  const dadosPf = (nomes.get(OID_PF_DADOS) || '').replace(/\D/g, '')
  const cnDigitos = /:(\d{14}|\d{11})\s*$/.exec(nomeDe(titularCert.subject.attributes))?.[1] ?? ''
  const documento = cnpj.length === 14 ? cnpj : dadosPf.length >= 19 ? dadosPf.slice(8, 19) : cnDigitos || null
  const responsavelNome = nomes.get(OID_RESPONSAVEL_NOME) || null
  const responsavelCpf = (nomes.get(OID_RESPONSAVEL_DADOS) || '').replace(/\D/g, '').slice(8, 19)

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(titularCert)).getBytes()
  const ultimo = cadeia[cadeia.length - 1]!
  const icpBrasil = [...cadeia.flatMap(c => [c.subject, c.issuer]), ultimo.issuer].some(n =>
    n.attributes.some(a => a.shortName === 'O' && /ICP-Brasil/i.test(String(a.value)))
  )

  return {
    titular: nomeDe(titularCert.subject.attributes).replace(/:\d{11,14}\s*$/, ''),
    documento,
    documentoTipo: documento ? (documento.length === 14 ? 'CNPJ' : 'CPF') : null,
    responsavel: responsavelNome ? `${responsavelNome}${responsavelCpf.length === 11 ? ` (CPF ${responsavelCpf})` : ''}` : null,
    emissor: nomeDe(titularCert.issuer.attributes),
    serial: titularCert.serialNumber,
    fingerprintSha256: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
    validoDe: titularCert.validity.notBefore,
    validoAte: titularCert.validity.notAfter,
    icpBrasil,
    cadeia: cadeia.map(c => ({ assunto: nomeDe(c.subject.attributes), emissor: nomeDe(c.issuer.attributes) })),
    certPem: cadeia.map(c => forge.pki.certificateToPem(c)).join(''),
    keyPem: forge.pki.privateKeyToPem(chave)
  }
}

/** O que a tela mostra de um certificado. Nunca a chave. */
export function resumoCertificado(c: Certificado | DadosCertificado & { id?: number }) {
  const cadeia = 'cadeia' in c ? c.cadeia : cadeiaDoPem(c.certPem)
  return {
    id: 'id' in c ? (c.id ?? null) : null,
    nome: 'nome' in c ? c.nome : null,
    titular: c.titular,
    documento: c.documento,
    documentoTipo: c.documentoTipo,
    responsavel: c.responsavel,
    emissor: c.emissor,
    serial: c.serial,
    fingerprintSha256: c.fingerprintSha256,
    validoDe: c.validoDe.toISOString(),
    validoAte: c.validoAte.toISOString(),
    diasParaVencer: Math.floor((c.validoAte.getTime() - Date.now()) / 86_400_000),
    icpBrasil: c.icpBrasil,
    cadeia
  }
}

function cadeiaDoPem(pem: string) {
  return pem
    .split(/(?=-----BEGIN CERTIFICATE-----)/)
    .filter(p => p.includes('BEGIN CERTIFICATE'))
    .map(p => {
      const c = forge.pki.certificateFromPem(p)
      return { assunto: nomeDe(c.subject.attributes), emissor: nomeDe(c.issuer.attributes) }
    })
}

export async function gravarCertificado(d: DadosCertificado, o: { nome: string; nomeArquivo: string | null; criadoPorNome: string }) {
  const db = useDb()
  const [existente] = await db
    .select({ id: certificados.id })
    .from(certificados)
    .where(and(eq(certificados.fingerprintSha256, d.fingerprintSha256), isNull(certificados.revogadoEm)))
  if (existente) throw new ErroCertificado('Este certificado já está cadastrado.')
  // o primeiro certificado vira o padrao
  const [algum] = await db.select({ id: certificados.id }).from(certificados).where(isNull(certificados.revogadoEm)).limit(1)
  const [c] = await db
    .insert(certificados)
    .values({
      nome: o.nome,
      titular: d.titular,
      documento: d.documento,
      documentoTipo: d.documentoTipo,
      responsavel: d.responsavel,
      emissor: d.emissor,
      serial: d.serial,
      fingerprintSha256: d.fingerprintSha256,
      validoDe: d.validoDe,
      validoAte: d.validoAte,
      icpBrasil: d.icpBrasil,
      certPem: d.certPem,
      chaveCifrada: cifrar(d.keyPem),
      nomeArquivo: o.nomeArquivo,
      padrao: !algum,
      criadoPorNome: o.criadoPorNome
    })
    .returning()
  return c!
}

/** Certificado pronto para assinar: a chave e decifrada aqui, na hora do uso, e so vive em memoria. */
export async function certificadoParaAssinar(id?: number | null) {
  const db = useDb()
  const [c] = id
    ? await db.select().from(certificados).where(and(eq(certificados.id, id), isNull(certificados.revogadoEm)))
    : await db
        .select()
        .from(certificados)
        .where(isNull(certificados.revogadoEm))
        .orderBy(desc(certificados.padrao), desc(certificados.validoAte))
        .limit(1)
  if (!c) throw new ErroCertificado('Nenhum certificado cadastrado. Cadastre em Configurações → Certificado digital.')
  if (c.validoAte.getTime() < Date.now()) throw new ErroCertificado(`O certificado "${c.nome}" venceu em ${formatarData(c.validoAte)}.`)
  return { registro: c, certPem: c.certPem, keyPem: decifrar(c.chaveCifrada) }
}
