<script setup lang="ts">
/**
 * Página de quem ASSINA. Lê o documento, escolhe digitar o nome (fonte
 * manuscrita fixa) ou desenhar, confirma com o código de 6 dígitos que chega no
 * e-mail e assina. Sempre clara, pensada primeiro para o celular.
 */
definePageMeta({ layout: false, colorMode: 'light' })

const route = useRoute()
const toast = useToast()
const token = String(route.params.token)
const { data, error, refresh } = await useFetch<LandingAssinatura>(api(`/api/a/${token}`))
useHead({
  title: () => (data.value ? `Assinar: ${data.value.titulo} — Contábil Gaulke` : 'Assinatura — Contábil Gaulke'),
  // a mesma fonte que vai para o PDF: o que a pessoa vê é o que sai no documento
  style: [{ innerHTML: `@font-face{font-family:'Gaulke Manuscrita';src:url('${api('/fontes/GreatVibes-Regular.ttf')}') format('truetype');font-display:swap}` }]
})

const podeAssinar = computed(() => data.value?.status === 'aguardando' && data.value.eu.status === 'aguardando')

/* ---------- painel de assinatura ---------- */
const painel = ref(false)
const tipo = ref<'digitada' | 'desenhada'>('digitada')
const nome = ref('')
watch(data, v => { if (v && !nome.value) nome.value = v.eu.nome }, { immediate: true })
const aceite = ref(false)
const codigo = ref('')
const codigoEnviado = ref(false)
const enviandoCodigo = ref(false)
const assinando = ref(false)
const emailMascarado = computed(() => data.value?.eu.email ?? '')

// desenho
const tela = ref<HTMLCanvasElement | null>(null)
let desenhando = false
let ultimo: { x: number; y: number } | null = null
const limites = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
const temDesenho = ref(false)
function prepararTela() {
  const c = tela.value
  if (!c) return
  const r = c.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  c.width = r.width * dpr
  c.height = r.height * dpr
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.lineWidth = 2.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#0d1a59'
  limpar()
}
function ponto(e: PointerEvent) {
  const r = tela.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function comecar(e: PointerEvent) {
  desenhando = true
  ultimo = ponto(e)
  tela.value!.setPointerCapture(e.pointerId)
}
function tracar(e: PointerEvent) {
  if (!desenhando || !ultimo) return
  const p = ponto(e)
  const ctx = tela.value!.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(ultimo.x, ultimo.y)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  for (const q of [ultimo, p]) {
    limites.x0 = Math.min(limites.x0, q.x)
    limites.y0 = Math.min(limites.y0, q.y)
    limites.x1 = Math.max(limites.x1, q.x)
    limites.y1 = Math.max(limites.y1, q.y)
  }
  temDesenho.value = true
  ultimo = p
}
function parar() {
  desenhando = false
  ultimo = null
}
function limpar() {
  const c = tela.value
  if (!c) return
  c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
  Object.assign(limites, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  temDesenho.value = false
}
/** PNG só com o traço (recortado), para caber bem no campo do PDF. */
function imagemDesenho() {
  const c = tela.value!
  const dpr = window.devicePixelRatio || 1
  const m = 6
  const x = Math.max(0, (limites.x0 - m) * dpr)
  const y = Math.max(0, (limites.y0 - m) * dpr)
  const w = Math.min(c.width - x, (limites.x1 - limites.x0 + 2 * m) * dpr)
  const h = Math.min(c.height - y, (limites.y1 - limites.y0 + 2 * m) * dpr)
  const saida = document.createElement('canvas')
  const escala = Math.min(1, 800 / w)
  saida.width = Math.round(w * escala)
  saida.height = Math.round(h * escala)
  saida.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, saida.width, saida.height)
  return saida.toDataURL('image/png')
}
watch([painel, tipo], async () => {
  if (painel.value && tipo.value === 'desenhada') {
    await nextTick()
    setTimeout(prepararTela, 50)
  }
})

const pronto = computed(() => aceite.value && (tipo.value === 'digitada' ? nome.value.trim().length >= 3 : temDesenho.value))

async function pedirCodigo() {
  enviandoCodigo.value = true
  try {
    await $fetch(api(`/api/a/${token}/codigo`), { method: 'POST' })
    codigoEnviado.value = true
    toast.add({ title: 'Código enviado', description: `Confira o e-mail ${emailMascarado.value} (e a caixa de spam).`, color: 'success', icon: 'i-lucide-mail' })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível enviar o código', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    enviandoCodigo.value = false
  }
}

async function assinar() {
  assinando.value = true
  try {
    await $fetch(api(`/api/a/${token}/assinar`), {
      method: 'POST',
      body: {
        codigo: codigo.value.replace(/\D/g, ''),
        tipo: tipo.value,
        nome: nome.value.trim(),
        imagem: tipo.value === 'desenhada' ? imagemDesenho() : null,
        aceite: true
      }
    })
    painel.value = false
    toast.add({ title: 'Documento assinado', icon: 'i-lucide-badge-check', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível assinar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    assinando.value = false
  }
}

/* ---------- recusar ---------- */
const recusando = ref(false)
const motivo = ref('')
async function recusar() {
  try {
    await $fetch(api(`/api/a/${token}/recusar`), { method: 'POST', body: { motivo: motivo.value } })
    recusando.value = false
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível registrar', description: e?.data?.statusMessage, color: 'error' })
  }
}

function irParaCampo() {
  const c = data.value?.campos[0]
  if (!c) return
  document.querySelector(`[data-pagina="${c.pagina}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
const ROTULO_CAMPO: Record<TipoCampoAssinatura, string> = { assinatura: 'Sua assinatura', rubrica: 'Sua rubrica', data: 'Data', nome: 'Seu nome' }
</script>

<template>
  <div class="flex min-h-screen flex-col bg-elevated/40">
    <main class="mx-auto w-full max-w-4xl flex-1 px-4 pb-32 pt-8">
      <UCard v-if="error" class="mx-auto max-w-xl">
        <div class="space-y-3 py-6 text-center">
          <UIcon name="i-lucide-link-2-off" class="size-12 text-muted" />
          <h1 class="text-xl font-semibold">Link inválido ou expirado</h1>
          <p class="text-muted">Confira se o endereço foi copiado por completo, ou responda ao e-mail que você recebeu.</p>
        </div>
      </UCard>

      <template v-else-if="data">
        <div class="mb-6 flex flex-col items-center gap-2 text-center">
          <img :src="api('/brand/logo.png')" alt="Contábil Gaulke" class="h-14 w-auto" />
          <h1 class="text-2xl font-semibold">Olá, {{ data.eu.nome.split(' ')[0] }}!</h1>
          <p class="max-w-lg text-muted">
            {{ data.remetente ? `${data.remetente}, da Contábil Gaulke,` : 'A Contábil Gaulke' }} enviou este documento para a sua assinatura eletrônica.
          </p>
        </div>

        <UCard class="mx-auto mb-4 max-w-2xl">
          <p class="text-xs uppercase tracking-wide text-muted">Documento {{ data.codigo }}</p>
          <h2 class="mt-1 text-lg font-semibold">{{ data.titulo }}</h2>
          <p v-if="data.mensagem" class="mt-2 whitespace-pre-line text-sm">{{ data.mensagem }}</p>
          <p v-if="data.prazo" class="mt-2 text-sm text-muted"><UIcon name="i-lucide-calendar-clock" class="mr-1 size-4 align-[-3px]" />Prazo: {{ formatarPrazo(data.prazo) }}</p>
          <ul class="mt-4 space-y-1.5">
            <li v-for="(s, i) in data.signatarios" :key="i" class="flex items-center gap-2 text-sm">
              <UIcon :name="s.status === 'assinado' ? 'i-lucide-circle-check' : s.status === 'recusado' ? 'i-lucide-circle-x' : 'i-lucide-circle-dashed'" class="size-4" :class="s.status === 'assinado' ? 'text-success' : s.status === 'recusado' ? 'text-error' : 'text-muted'" />
              <span :class="{ 'font-medium': s.eu }">{{ s.nome }}{{ s.eu ? ' (você)' : '' }}</span>
              <span class="text-xs text-muted">{{ s.assinadoEm ? `assinou em ${formatarDataHora(s.assinadoEm)}` : ROTULO_SIGNATARIO[s.status].toLowerCase() }}</span>
            </li>
          </ul>
        </UCard>

        <div class="mx-auto mb-4 max-w-2xl space-y-3">
          <UAlert v-if="data.status === 'cancelado'" color="neutral" variant="subtle" icon="i-lucide-ban" title="Este documento foi cancelado" description="Não é preciso fazer nada. Em caso de dúvida, fale com a Contábil Gaulke." />
          <UAlert v-else-if="data.status === 'recusado' && data.eu.status !== 'assinado'" color="neutral" variant="subtle" icon="i-lucide-circle-x" title="Este documento foi recusado" description="Alguém recusou a assinatura e o documento não aceita mais assinaturas." />
          <UAlert v-else-if="data.eu.status === 'recusado'" color="neutral" variant="subtle" icon="i-lucide-circle-x" title="Você recusou este documento" />
          <UAlert v-else-if="data.eu.status === 'pendente'" color="info" variant="subtle" icon="i-lucide-hourglass" title="Ainda não é a sua vez" description="As assinaturas seguem uma ordem. Você recebe um e-mail quando chegar a sua vez; pode ler o documento abaixo." />
          <template v-else-if="data.eu.status === 'assinado'">
            <UAlert color="success" variant="subtle" icon="i-lucide-badge-check" title="Você assinou este documento" :description="`Em ${formatarDataHora(data.eu.assinadoEm)} (horário de Brasília). ${data.temFinal ? 'Todos assinaram: baixe o documento final abaixo.' : 'Quando todos assinarem, você recebe o documento final por e-mail.'}`" />
            <UButton v-if="data.temFinal" label="Baixar o documento assinado" icon="i-lucide-download" size="lg" block :to="api(`/api/a/${token}/final`)" external />
          </template>
          <UAlert v-else-if="podeAssinar && data.campos.length" color="primary" variant="subtle" icon="i-lucide-pen-line" :title="`${data.campos.length} lugar(es) marcado(s) para você no documento`" :actions="[{ label: 'Ver', variant: 'link', onClick: irParaCampo }]" />
        </div>

        <div v-if="data.status !== 'cancelado'" class="rounded-xl bg-elevated/70 p-3 sm:p-4">
          <ClientOnly>
            <VisualizadorPdf :fonte="api(`/api/a/${token}/pdf`)" :largura-max="840">
              <template #pagina="{ numero, altura, escala }">
                <div
                  v-for="(c, i) in data.campos.filter(c => c.pagina === numero)"
                  :key="i"
                  class="absolute flex items-center justify-center rounded-sm border-2 border-dashed text-[10px] font-semibold"
                  :class="data.eu.status === 'assinado' ? 'border-success/60 bg-success/10 text-success' : 'animate-pulse border-primary bg-primary/10 text-primary'"
                  :style="{ left: `${c.x * escala}px`, top: `${(altura - c.y - c.altura) * escala}px`, width: `${c.largura * escala}px`, height: `${c.altura * escala}px` }"
                >
                  {{ data.eu.status === 'assinado' ? 'Assinado' : ROTULO_CAMPO[c.tipo] }}
                </div>
              </template>
            </VisualizadorPdf>
          </ClientOnly>
        </div>
      </template>
    </main>

    <!-- barra fixa: o botão de assinar sempre à mão, no celular -->
    <div v-if="podeAssinar" class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default/95 p-3 backdrop-blur">
      <div class="mx-auto flex max-w-2xl items-center gap-2">
        <UButton label="Recusar" color="neutral" variant="ghost" @click="motivo = ''; recusando = true" />
        <UButton label="Assinar o documento" icon="i-lucide-signature" size="lg" class="flex-1 justify-center" @click="painel = true" />
      </div>
    </div>

    <footer class="border-t border-default px-4 pb-24 pt-6 text-center text-xs text-muted">
      Contábil Gaulke · Assinatura eletrônica com confirmação por e-mail. Registramos data, hora (Brasília), IP e dispositivo, conforme a LGPD.
    </footer>

    <UModal v-model:open="painel" title="Assinar o documento" :ui="{ content: 'sm:max-w-xl' }">
      <template #body>
        <div class="space-y-5">
          <UFieldGroup class="w-full">
            <UButton class="flex-1 justify-center" :color="tipo === 'digitada' ? 'primary' : 'neutral'" :variant="tipo === 'digitada' ? 'soft' : 'outline'" icon="i-lucide-type" label="Digitar" @click="tipo = 'digitada'" />
            <UButton class="flex-1 justify-center" :color="tipo === 'desenhada' ? 'primary' : 'neutral'" :variant="tipo === 'desenhada' ? 'soft' : 'outline'" icon="i-lucide-pen-tool" label="Desenhar" @click="tipo = 'desenhada'" />
          </UFieldGroup>

          <div v-if="tipo === 'digitada'" class="space-y-2">
            <UFormField label="Seu nome completo">
              <UInput v-model="nome" size="lg" class="w-full" />
            </UFormField>
            <div class="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-default bg-white px-4">
              <span class="truncate text-5xl text-[#0d1a59]" style="font-family: 'Gaulke Manuscrita', cursive">{{ nome || 'Seu nome' }}</span>
            </div>
          </div>
          <div v-else class="space-y-2">
            <div class="relative">
              <canvas
                ref="tela"
                class="h-40 w-full touch-none rounded-lg border border-default bg-white"
                @pointerdown="comecar"
                @pointermove="tracar"
                @pointerup="parar"
                @pointerleave="parar"
              />
              <span v-if="!temDesenho" class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">Desenhe aqui com o dedo ou o mouse</span>
            </div>
            <div class="flex justify-end"><UButton label="Limpar" icon="i-lucide-eraser" color="neutral" variant="ghost" size="xs" @click="limpar" /></div>
            <UFormField label="Seu nome completo" help="Vai na folha de assinaturas, junto do desenho.">
              <UInput v-model="nome" class="w-full" />
            </UFormField>
          </div>

          <UCheckbox v-model="aceite" label="Li o documento e concordo em assiná-lo eletronicamente." description="A assinatura fica registrada com data, hora, IP e o código enviado ao seu e-mail." />

          <div class="space-y-3 rounded-lg border border-default p-3">
            <p class="text-sm">Para confirmar que é você, enviamos um código de 6 dígitos para <strong>{{ emailMascarado }}</strong>.</p>
            <UButton
              :label="codigoEnviado ? 'Enviar outro código' : 'Enviar código'"
              icon="i-lucide-mail"
              :color="codigoEnviado ? 'neutral' : 'primary'"
              :variant="codigoEnviado ? 'outline' : 'solid'"
              :disabled="!pronto"
              :loading="enviandoCodigo"
              @click="pedirCodigo"
            />
            <UFormField v-if="codigoEnviado" label="Código recebido">
              <UInput v-model="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" size="lg" class="w-40 font-mono tracking-[0.3em]" />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="painel = false" />
          <UButton label="Assinar" icon="i-lucide-signature" :disabled="!pronto || codigo.replace(/\D/g, '').length !== 6" :loading="assinando" @click="assinar" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="recusando" title="Recusar a assinatura" description="Quem enviou o documento é avisado com o motivo.">
      <template #body>
        <UFormField label="Motivo" required><UTextarea v-model="motivo" :rows="3" autoresize class="w-full" /></UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="recusando = false" />
          <UButton label="Recusar" color="error" :disabled="motivo.trim().length < 3" @click="recusar" />
        </div>
      </template>
    </UModal>
  </div>
</template>
