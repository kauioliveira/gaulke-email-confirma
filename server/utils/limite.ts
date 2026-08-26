/**
 * Limitador de requisicoes por janela deslizante, em memoria.
 *
 * EM MEMORIA DE PROPOSITO: um limitador em Postgres gravaria uma linha por
 * request, que e exatamente o que estamos tentando evitar — as rotas publicas
 * ja gravam um evento por acerto em sys_mail_events, e essa tabela e a trilha
 * de auditoria do sistema.
 *
 * RESSALVA: com mais de uma replica, cada processo tem seu proprio contador,
 * entao o limite efetivo e (limite x replicas). Os valores usados sao
 * generosos o bastante para isso nao importar; o objetivo e barrar loop e
 * varredura, nao cobrar quota.
 */

type Janela = { marcas: number[] }

const janelas = new Map<string, Janela>()

/** Sem isso o Map cresceria para sempre com chaves de visitantes de uma vez so. */
const LIMPEZA_MS = 5 * 60 * 1000
let limpezaAgendada = false

function agendarLimpeza() {
  if (limpezaAgendada) return
  limpezaAgendada = true

  const timer = setInterval(() => {
    const agora = Date.now()
    for (const [chave, janela] of janelas) {
      // uma janela sem marca recente nao serve mais para nada
      if (!janela.marcas.length || agora - janela.marcas[janela.marcas.length - 1]! > LIMPEZA_MS) {
        janelas.delete(chave)
      }
    }
  }, LIMPEZA_MS)

  // nao segura o processo no ar so por causa da limpeza
  timer.unref?.()
}

export type Resultado = {
  permitido: boolean
  restante: number
  /** milissegundos ate a marca mais antiga sair da janela */
  resetEmMs: number
}

/**
 * Consome uma unidade da chave. A janela e deslizante: contamos quantas
 * marcas existem nos ultimos `janelaMs`, e nao acertos dentro de um balde
 * fixo — assim ninguem consegue o dobro do limite virando o balde.
 */
export function consumir(chave: string, limite: number, janelaMs: number): Resultado {
  agendarLimpeza()

  const agora = Date.now()
  const corte = agora - janelaMs

  const janela = janelas.get(chave) ?? { marcas: [] }
  // as marcas estao em ordem crescente: basta descartar o prefixo vencido
  let i = 0
  while (i < janela.marcas.length && janela.marcas[i]! <= corte) i++
  if (i) janela.marcas.splice(0, i)

  const resetEmMs = janela.marcas.length ? janela.marcas[0]! + janelaMs - agora : janelaMs

  if (janela.marcas.length >= limite) {
    janelas.set(chave, janela)
    return { permitido: false, restante: 0, resetEmMs: Math.max(resetEmMs, 0) }
  }

  janela.marcas.push(agora)
  janelas.set(chave, janela)
  return { permitido: true, restante: limite - janela.marcas.length, resetEmMs }
}

/** Descarta a contagem de uma chave (ex.: login correto zera as falhas). */
export function zerar(chave: string) {
  janelas.delete(chave)
}

/**
 * Registra uma marca sem impor limite. Serve para contar eventos que so
 * depois serao comparados com um teto — como as falhas de login.
 */
export function marcar(chave: string, janelaMs: number) {
  const agora = Date.now()
  const corte = agora - janelaMs
  const janela = janelas.get(chave) ?? { marcas: [] }
  let i = 0
  while (i < janela.marcas.length && janela.marcas[i]! <= corte) i++
  if (i) janela.marcas.splice(0, i)
  janela.marcas.push(agora)
  janelas.set(chave, janela)
  agendarLimpeza()
  return janela.marcas.length
}

/** Milissegundos ate a marca mais antiga sair da janela. Nao consome nada. */
export function msAteReset(chave: string, janelaMs: number) {
  const janela = janelas.get(chave)
  if (!janela?.marcas.length) return 0
  const corte = Date.now() - janelaMs
  const viva = janela.marcas.find(m => m > corte)
  return viva ? Math.max(0, viva + janelaMs - Date.now()) : 0
}

/** Quantas marcas validas a chave tem agora, sem consumir nada. */
export function contar(chave: string, janelaMs: number) {
  const janela = janelas.get(chave)
  if (!janela) return 0
  const corte = Date.now() - janelaMs
  return janela.marcas.filter(m => m > corte).length
}

/** Apenas para testes e diagnostico: descarta todas as contagens. */
export function limparTudo() {
  janelas.clear()
}
