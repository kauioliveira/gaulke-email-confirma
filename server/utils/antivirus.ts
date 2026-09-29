import { connect, type Socket } from 'node:net'
import { createReadStream } from 'node:fs'
import { semAspas } from './env'

/**
 * Cliente do clamd (ClamAV) pelo protocolo TCP, sem dependencia.
 *
 * INSTREAM: manda "zINSTREAM\0", depois o arquivo em pedacos precedidos do
 * tamanho (4 bytes, big-endian) e fecha com um pedaco de tamanho zero. O clamd
 * responde uma linha:
 *   "stream: OK"                        limpo
 *   "stream: Win.Test.EICAR_HDB-1 FOUND" infectado
 *   "INSTREAM size limit exceeded. ERROR" e outros "... ERROR"
 *
 * O arquivo vai do disco para o socket em streaming: um upload de 25 MB nao
 * precisa caber inteiro na memoria de novo so para ser verificado.
 */

export type ResultadoAntivirus =
  | { status: 'limpo'; mensagem: string }
  | { status: 'infectado'; mensagem: string }
  /** CLAMAV_HOST vazio: o arquivo passa, marcado como nao verificado (desenvolvimento) */
  | { status: 'sem_antivirus'; mensagem: string }
  /** o clamd nao respondeu ou recusou: o arquivo FICA em quarentena e e tentado de novo */
  | { status: 'erro'; mensagem: string }

const PEDACO = 64 * 1024
const TIMEOUT_MS = 60_000

export function configAntivirus() {
  const host = semAspas(process.env.CLAMAV_HOST)
  const port = Number(semAspas(process.env.CLAMAV_PORT)) || 3310
  return { host, port, configurado: !!host }
}

function abrir(host: string, port: number): Promise<Socket> {
  return new Promise((ok, falha) => {
    const s = connect({ host, port })
    s.setTimeout(TIMEOUT_MS)
    s.once('connect', () => ok(s))
    s.once('error', falha)
    s.once('timeout', () => {
      s.destroy()
      falha(new Error(`clamd em ${host}:${port} nao respondeu`))
    })
  })
}

/** Le a resposta ate o \0 (ou o fim da conexao). */
function resposta(s: Socket): Promise<string> {
  return new Promise((ok, falha) => {
    const partes: Buffer[] = []
    s.on('data', (d: Buffer) => {
      partes.push(d)
      if (d.includes(0)) s.end()
    })
    s.once('end', () => ok(Buffer.concat(partes).toString('utf8').replace(/\0/g, '').trim()))
    s.once('error', falha)
    s.once('timeout', () => {
      s.destroy()
      falha(new Error('clamd parou de responder no meio da verificacao'))
    })
  })
}

async function comando(cmd: string) {
  const { host, port } = configAntivirus()
  const s = await abrir(host, port)
  const r = resposta(s)
  s.write(`z${cmd}\0`)
  return r
}

/** PING + VERSION, para a tela de status. */
export async function estadoAntivirus(): Promise<{ configurado: boolean; ok: boolean; mensagem: string }> {
  const c = configAntivirus()
  if (!c.configurado) return { configurado: false, ok: false, mensagem: 'CLAMAV_HOST não configurado' }
  try {
    const pong = await comando('PING')
    if (pong !== 'PONG') return { configurado: true, ok: false, mensagem: `Resposta inesperada: ${pong}` }
    const versao = await comando('VERSION')
    return { configurado: true, ok: true, mensagem: versao }
  } catch (e) {
    return { configurado: true, ok: false, mensagem: e instanceof Error ? e.message : String(e) }
  }
}

export async function verificarArquivo(caminhoAbsoluto: string): Promise<ResultadoAntivirus> {
  const c = configAntivirus()
  if (!c.configurado) {
    return { status: 'sem_antivirus', mensagem: 'Antivírus não configurado (CLAMAV_HOST vazio)' }
  }

  let s: Socket
  try {
    s = await abrir(c.host, c.port)
  } catch (e) {
    return { status: 'erro', mensagem: e instanceof Error ? e.message : String(e) }
  }

  try {
    const r = resposta(s)
    s.write('zINSTREAM\0')

    for await (const pedaco of createReadStream(caminhoAbsoluto, { highWaterMark: PEDACO })) {
      const buf = pedaco as Buffer
      const tam = Buffer.alloc(4)
      tam.writeUInt32BE(buf.length)
      // respeita o backpressure: o clamd le no ritmo dele
      if (!s.write(Buffer.concat([tam, buf]))) {
        await new Promise<void>((ok, falha) => {
          s.once('drain', ok)
          s.once('error', falha)
        })
      }
    }
    s.write(Buffer.alloc(4))

    const linha = await r
    if (/:\s*OK$/.test(linha)) return { status: 'limpo', mensagem: 'Nenhuma ameaça encontrada' }
    const achado = /:\s*(.+)\s+FOUND$/.exec(linha)
    if (achado) return { status: 'infectado', mensagem: achado[1]! }
    return { status: 'erro', mensagem: linha || 'clamd fechou a conexão sem resposta' }
  } catch (e) {
    s.destroy()
    return { status: 'erro', mensagem: e instanceof Error ? e.message : String(e) }
  }
}
