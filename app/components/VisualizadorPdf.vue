<script setup lang="ts">
/**
 * Mostra um PDF página a página (pdf.js, só no navegador) e deixa um slot
 * sobre cada página para desenhar os campos de assinatura.
 *
 * Coordenadas: o slot recebe a escala (pixels por ponto do PDF) e o tamanho
 * da página em PONTOS. Quem usa converte com isso — o banco guarda pontos do
 * PDF com origem no canto inferior esquerdo, o navegador desenha a partir do
 * canto superior esquerdo.
 */
const props = defineProps<{
  /** URL do PDF ou o conteúdo (arquivo escolhido na tela, antes de subir) */
  fonte: string | ArrayBuffer
  /** largura máxima da página na tela, em pixels */
  larguraMax?: number
}>()
const emit = defineEmits<{ carregado: [paginas: { largura: number; altura: number }[]]; erro: [mensagem: string] }>()

type Pagina = { numero: number; largura: number; altura: number }
const paginas = shallowRef<Pagina[]>([])
const caixa = ref<HTMLElement | null>(null)
const largura = ref(0)
const carregando = ref(true)
const falha = ref<string | null>(null)
const canvases = new Map<number, HTMLCanvasElement>()
let doc: any = null

const escala = computed(() => {
  const maior = Math.max(1, ...paginas.value.map(p => p.largura))
  return Math.min((props.larguraMax ?? 900) / maior, Math.max(0.3, largura.value / maior))
})

async function carregar() {
  carregando.value = true
  falha.value = null
  try {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const origem = typeof props.fonte === 'string' ? { url: props.fonte, withCredentials: true } : { data: new Uint8Array(props.fonte.slice(0)) }
    doc = await pdfjs.getDocument(origem).promise
    const lista: Pagina[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i)
      const vp = pg.getViewport({ scale: 1 })
      lista.push({ numero: i, largura: vp.width, altura: vp.height })
    }
    paginas.value = lista
    emit('carregado', lista.map(p => ({ largura: p.largura, altura: p.altura })))
    await nextTick()
    await desenhar()
  } catch (e: any) {
    falha.value = 'Não foi possível abrir o PDF.'
    emit('erro', e?.message ?? String(e))
  } finally {
    carregando.value = false
  }
}

/**
 * Uma pintura por vez. Abrir o PDF e o ajuste de largura disparam desenhar()
 * quase juntos; duas render() do pdf.js no MESMO canvas se atropelam (a
 * segunda redimensiona o canvas no meio da primeira) e a página sai preta e
 * espelhada. Por isso a pintura em curso é CANCELADA e esperada antes de a
 * próxima começar.
 */
let desenhando = 0
let tarefa: { cancel: () => void; promise: Promise<unknown> } | null = null
let fila: Promise<void> = Promise.resolve()
function desenhar() {
  const vez = ++desenhando
  tarefa?.cancel()
  fila = fila.then(() => pintar(vez)).catch(() => {})
  return fila
}
async function pintar(vez: number) {
  if (!doc) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  for (const p of paginas.value) {
    if (vez !== desenhando) return // outra pintura foi pedida: ela recomeça do zero
    const canvas = canvases.get(p.numero)
    if (!canvas) continue
    const pg = await doc.getPage(p.numero)
    const vp = pg.getViewport({ scale: escala.value * dpr })
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    tarefa = pg.render({ canvas, viewport: vp })
    try {
      await tarefa!.promise
    } catch {
      return // cancelada: a pintura nova assume
    } finally {
      tarefa = null
    }
  }
}

let obs: ResizeObserver | null = null
let atraso: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  obs = new ResizeObserver(([e]) => {
    largura.value = e!.contentRect.width
  })
  if (caixa.value) {
    obs.observe(caixa.value)
    largura.value = caixa.value.clientWidth
  }
  carregar()
})
onBeforeUnmount(() => {
  obs?.disconnect()
  doc?.destroy?.()
})
watch(escala, () => {
  clearTimeout(atraso)
  atraso = setTimeout(desenhar, 150)
})
watch(() => props.fonte, carregar)

function registrar(numero: number, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(numero, el)
}
defineExpose({ paginas, escala })
</script>

<template>
  <div ref="caixa" class="w-full">
    <p v-if="carregando" class="py-16 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="mr-1 size-4 animate-spin align-[-3px]" />Abrindo o PDF…
    </p>
    <p v-else-if="falha" class="py-16 text-center text-sm text-error">{{ falha }}</p>
    <div class="flex flex-col items-center gap-4">
      <div
        v-for="p in paginas"
        :key="p.numero"
        class="relative bg-white shadow-md ring-1 ring-black/5"
        :style="{ width: `${p.largura * escala}px`, height: `${p.altura * escala}px` }"
        :data-pagina="p.numero"
      >
        <canvas :ref="el => registrar(p.numero, el)" class="absolute inset-0 h-full w-full" />
        <div class="absolute inset-0">
          <slot name="pagina" :numero="p.numero" :largura="p.largura" :altura="p.altura" :escala="escala" />
        </div>
        <span class="absolute -bottom-5 right-0 text-[10px] text-muted">{{ p.numero }} / {{ paginas.length }}</span>
      </div>
    </div>
  </div>
</template>
