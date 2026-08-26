import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto'
import { semAspas } from './env'

/**
 * Cifra das senhas de SMTP guardadas no banco.
 *
 * POR QUE NAO HASH
 * Hash e de via unica: serve para conferir uma senha que alguem digitou, nunca
 * para recupera-la. O SMTP exige a senha EM CLARO no momento de autenticar,
 * entao o que cabe aqui e cifra reversivel — AES-256-GCM, que alem de cifrar
 * autentica: mexer no texto cifrado faz a decifragem falhar em vez de devolver
 * lixo silenciosamente.
 *
 * A CHAVE
 * Vem de SMTP_CRYPTO_KEY, no .env. E ela, e nao o banco, que protege as senhas:
 * quem tiver so o dump nao consegue abrir nada. Consequencias praticas:
 *   - perder a chave = perder as senhas (basta recadastrar as contas);
 *   - o MESMO banco precisa da MESMA chave em toda maquina que o usa, senao um
 *     ambiente nao le o que o outro gravou;
 *   - trocar a chave invalida o que ja esta gravado.
 *
 * Nao ha fallback para SESSION_SECRET de proposito: rotacionar o segredo de
 * sessao e rotina, e derrubaria todas as contas de e-mail junto, sem que o
 * motivo aparecesse em lugar nenhum.
 */

const PREFIXO = 'v1'

function bruta() {
  return semAspas(process.env.SMTP_CRYPTO_KEY || '')
}

/** A tela de configuracoes usa isto para explicar o que falta, em vez de dar erro 500. */
export function chaveConfigurada() {
  return bruta().length > 0
}

/**
 * 32 bytes a partir do que estiver no .env.
 *
 * 64 caracteres hex sao usados direto (e o formato que documentamos, gerado por
 * `openssl rand -hex 32`). Qualquer outro texto passa por scrypt, para que uma
 * chave curta ou uma frase nao virem material fraco.
 */
function chave() {
  const k = bruta()
  if (!k) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'SMTP_CRYPTO_KEY nao configurada no .env — sem ela as senhas das contas nao podem ser guardadas. '
        + 'Gere uma com: openssl rand -hex 32'
    })
  }
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex')
  // sal fixo: nao ha por conta onde guardar um sal por registro, e o objetivo
  // aqui e so normalizar o tamanho da chave, nao proteger senha de usuario
  return scryptSync(k, 'gaulke-mail-smtp', 32)
}

/** Identifica a chave em uso sem revela-la — util para diagnosticar "nao decifra". */
export function impressaoDaChave() {
  if (!chaveConfigurada()) return null
  return createHash('sha256').update(chave()).digest('hex').slice(0, 8)
}

export function cifrar(texto: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave(), iv)
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return [
    PREFIXO,
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    dados.toString('base64url')
  ].join(':')
}

export function decifrar(valor: string) {
  const [versao, iv, tag, dados] = valor.split(':')
  if (versao !== PREFIXO || !iv || !tag || !dados) {
    throw new Error('senha gravada em formato desconhecido')
  }
  try {
    const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8')
  } catch {
    // Erro tipico de chave trocada. A mensagem precisa apontar para isso: sem
    // ela, o sintoma vira "SMTP recusou a senha" e a investigacao vai para o
    // lado errado.
    throw new Error(
      'nao foi possivel decifrar a senha desta conta. '
      + 'SMTP_CRYPTO_KEY provavelmente e diferente da usada quando ela foi salva.'
    )
  }
}
