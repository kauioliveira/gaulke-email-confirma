<script setup lang="ts">
/**
 * E-mails enviados e confirmações por dia (duas séries, mesma unidade, um só
 * eixo). SVG próprio, sem biblioteca: linhas de 2px, grade discreta, legenda
 * + rótulo direto no fim de cada linha, linha-guia com tooltip ao passar o
 * mouse, e a mesma informação em tabela (para leitor de tela e para quem
 * prefere números).
 *
 * Cores: slots 1 e 2 da paleta de referência, validados (claro e escuro) —
 * a diferença entre as séries não depende só da cor: legenda e rótulos dizem
 * quem é quem.
 */
type Ponto = { dia: string; enviados: number; confirmados: number }
const props = defineProps<{ serie: Ponto[] }>()

/**
 * O SVG tem a largura REAL do espaço (medida com ResizeObserver), e não uma
 * viewBox fixa esticada: esticar aumentava junto o texto dos eixos.
 */
const caixa = ref<HTMLElement | null>(null)
const L = ref(720)
const A = 240
const M = { cima: 14, dir: 92, baixo: 26, esq: 40 }
const areaL = computed(() => Math.max(120, L.value - M.esq - M.dir))
const areaA = A - M.cima - M.baixo
let observador: ResizeObserver | undefined
onMounted(() => {
  if (!caixa.value) return
  L.value = caixa.value.clientWidth || 720
  observador = new ResizeObserver(e => { L.value = Math.round(e[0]!.contentRect.width) || L.value })
  observador.observe(caixa.value)
})
onBeforeUnmount(() => observador?.disconnect())

const maximo = computed(() => {
  const m = Math.max(1, ...props.serie.flatMap(p => [p.enviados, p.confirmados]))
  // teto "redondo" para as marcas do eixo
  const passo = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / passo) * passo
})
const x = (i: number) => M.esq + (props.serie.length <= 1 ? areaL.value / 2 : (i / (props.serie.length - 1)) * areaL.value)
const y = (v: number) => M.cima + areaA - (v / maximo.value) * areaA

function caminho(chave: 'enviados' | 'confirmados') {
  return props.serie.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[chave]).toFixed(1)}`).join(' ')
}
const marcasY = computed(() => [0, 0.5, 1].map(f => Math.round(maximo.value * f)))
const marcasX = computed(() => {
  const n = props.serie.length
  if (!n) return []
  const idx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])]
  // a primeira data alinha à esquerda e a última à direita: nada sai da área
  return idx.map(i => ({
    i,
    rotulo: formatarDia(props.serie[i]!.dia),
    ancora: i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'
  }))
})
function formatarDia(dia: string) {
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

/* hover: o ponto mais perto do mouse */
const svg = ref<SVGSVGElement | null>(null)
const foco = ref<number | null>(null)
function mover(e: PointerEvent) {
  if (!svg.value || !props.serie.length) return
  const r = svg.value.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * L.value
  const rel = (px - M.esq) / areaL.value
  foco.value = Math.max(0, Math.min(props.serie.length - 1, Math.round(rel * (props.serie.length - 1))))
}
const pontoFoco = computed(() => (foco.value === null ? null : props.serie[foco.value]))
const ultimo = computed(() => props.serie[props.serie.length - 1])

/**
 * Rótulos diretos no fim das linhas, sem colisão: se as duas linhas terminam
 * perto (ou no mesmo ponto, como dois zeros), o de cima sobe — nunca desce
 * para cima das datas do eixo.
 */
const rotulosFim = computed(() => {
  const u = ultimo.value
  if (!u) return []
  const itens = [
    { texto: 'enviados', y: y(u.enviados) },
    { texto: 'confirmações', y: y(u.confirmados) }
  ].sort((a, b) => b.y - a.y)
  const baseMax = M.cima + areaA
  itens[0]!.y = Math.min(itens[0]!.y, baseMax)
  if (itens[0]!.y - itens[1]!.y < 13) itens[1]!.y = itens[0]!.y - 13
  return itens
})
const verTabela = ref(false)
const vazio = computed(() => !props.serie.some(p => p.enviados || p.confirmados))
</script>

<template>
  <div class="viz-root space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <!-- legenda: 2 séries, sempre presente -->
      <div class="flex items-center gap-4 text-xs text-muted">
        <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background: var(--serie-1)" />E-mails enviados</span>
        <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background: var(--serie-2)" />Confirmações de leitura</span>
      </div>
      <UButton :label="verTabela ? 'Ver gráfico' : 'Ver tabela'" :icon="verTabela ? 'i-lucide-chart-line' : 'i-lucide-table'" size="xs" color="neutral" variant="ghost" @click="verTabela = !verTabela" />
    </div>

    <div v-if="!verTabela" ref="caixa" class="relative">
      <p v-if="vazio" class="py-16 text-center text-sm text-muted">Nenhum envio no período.</p>
      <svg
        v-else
        ref="svg"
        :width="L"
        :height="A"
        :viewBox="`0 0 ${L} ${A}`"
        class="block touch-none select-none"
        role="img"
        aria-label="E-mails enviados e confirmações de leitura por dia"
        @pointermove="mover"
        @pointerleave="foco = null"
      >
        <!-- grade e eixo Y, recessivos -->
        <g v-for="v in marcasY" :key="v">
          <line :x1="M.esq" :x2="M.esq + areaL" :y1="y(v)" :y2="y(v)" class="grade" />
          <text :x="M.esq - 6" :y="y(v) + 3.5" text-anchor="end" class="eixo">{{ v }}</text>
        </g>
        <text v-for="m in marcasX" :key="m.i" :x="x(m.i)" :y="A - 8" :text-anchor="m.ancora" class="eixo">{{ m.rotulo }}</text>

        <path :d="caminho('enviados')" fill="none" stroke="var(--serie-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <path :d="caminho('confirmados')" fill="none" stroke="var(--serie-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        <!-- rótulo direto no fim de cada linha -->
        <text v-for="r in rotulosFim" :key="r.texto" :x="x(serie.length - 1) + 8" :y="r.y + 3.5" class="rotulo">{{ r.texto }}</text>

        <!-- linha-guia e marcadores do dia em foco -->
        <template v-if="pontoFoco && foco !== null">
          <line :x1="x(foco)" :x2="x(foco)" :y1="M.cima" :y2="M.cima + areaA" class="guia" />
          <circle :cx="x(foco)" :cy="y(pontoFoco.enviados)" r="4.5" fill="var(--serie-1)" class="anel" />
          <circle :cx="x(foco)" :cy="y(pontoFoco.confirmados)" r="4.5" fill="var(--serie-2)" class="anel" />
        </template>
      </svg>

      <div
        v-if="pontoFoco && foco !== null && !vazio"
        class="pointer-events-none absolute top-1 z-10 rounded-md border border-default bg-default px-3 py-2 text-xs shadow"
        :style="{ left: `${Math.min(78, (x(foco) / L) * 100)}%` }"
      >
        <p class="font-medium">{{ formatarData(`${pontoFoco.dia}T12:00:00-03:00`) }}</p>
        <p><span class="mr-1 inline-block h-0.5 w-3 align-middle" style="background: var(--serie-1)" />{{ pontoFoco.enviados }} enviado(s)</p>
        <p><span class="mr-1 inline-block h-0.5 w-3 align-middle" style="background: var(--serie-2)" />{{ pontoFoco.confirmados }} confirmaram</p>
      </div>
    </div>

    <div v-else class="max-h-72 overflow-y-auto rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-default text-left text-xs text-muted">
          <tr><th class="px-3 py-2">Dia</th><th class="px-3 py-2 text-right">Enviados</th><th class="px-3 py-2 text-right">Confirmaram</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in serie" :key="p.dia" class="border-t border-default">
            <td class="px-3 py-1.5">{{ formatarData(`${p.dia}T12:00:00-03:00`) }}</td>
            <td class="px-3 py-1.5 text-right tabular-nums">{{ p.enviados }}</td>
            <td class="px-3 py-1.5 text-right tabular-nums">{{ p.confirmados }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.viz-root {
  --serie-1: #2a78d6;
  --serie-2: #eb6834;
}
:global(.dark) .viz-root {
  --serie-1: #3987e5;
  --serie-2: #d95926;
}
.grade { stroke: var(--ui-border); stroke-width: 1; }
.guia { stroke: var(--ui-border-accented); stroke-width: 1; stroke-dasharray: 3 3; }
.eixo { font-size: 11px; fill: var(--ui-text-muted); font-variant-numeric: tabular-nums; }
.rotulo { font-size: 11px; fill: var(--ui-text-toned); }
.anel { stroke: var(--ui-bg); stroke-width: 2; }
</style>
