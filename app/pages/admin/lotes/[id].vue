<script setup lang="ts">
import { dataHora, hora, CORES_STATUS } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)

const { data, refresh } = await useFetch<RespostaLote>(api(`/api/admin/batches/${id}`))
useHead({ title: () => `${data.value?.lote.nome || 'Lote'} — Gaulke Envios` })

const { data: destinatarios, refresh: refreshDest } = await useFetch<RespostaDestinatarios>(
  api(`/api/admin/batches/${id}/destinatarios`),
  { query: { porPagina: 50 } }
)

/* ---------- Log ao vivo via SSE ---------- */
type Linha = { tipo: string; email?: string; codigo?: string; mensagem?: string; at: string; recipientId?: number }
const log = ref<Linha[]>([])
const conectado = ref(false)
let es: EventSource | null = null

function conectar() {
  if (es) return
  es = new EventSource(api(`/api/admin/batches/${id}/stream`))
  es.onopen = () => (conectado.value = true)
  es.onerror = () => (conectado.value = false)
  es.onmessage = ev => {
    let p: any
    try { p = JSON.parse(ev.data) } catch { return }
    if (p.tipo === 'ping') return

    log.value.unshift(p)
    if (log.value.length > 300) log.value.length = 300

    /**
     * Os contadores vem junto do evento, entao a barra de progresso anda sem
     * bater no servidor. Precisa TROCAR o objeto: o `data` do useFetch e um
     * shallowRef, e escrever `data.value.lote.enviados = x` nao avisa o Vue —
     * o progresso ficaria congelado durante todo o disparo.
     */
    if (data.value && (p.enviados !== undefined || p.falhas !== undefined)) {
      data.value = {
        ...data.value,
        lote: {
          ...data.value.lote,
          enviados: p.enviados ?? data.value.lote.enviados,
          falhas: p.falhas ?? data.value.lote.falhas
        }
      }
    }
    if (['concluido', 'pausado', 'iniciado'].includes(p.tipo)) {
      refresh()
      refreshDest()
    }
  }
}

onMounted(conectar)
onUnmounted(() => { es?.close(); es = null })

// a lista completa e recarregada devagar; o log ao vivo cobre o imediato
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    const st = data.value?.lote.status
    if (st === 'enviando') refreshDest()
    // agendado: precisa perceber sozinho quando o horario chegar
    else if (st === 'agendado') refresh()
  }, 15000)
})
onUnmounted(() => clearInterval(timer))

/* ---------- Controles ---------- */
const agindo = ref(false)

async function acao(rota: string, sucesso: string) {
  agindo.value = true
  try {
    const r = await $fetch<any>(api(`/api/admin/batches/${id}/${rota}`), { method: 'POST' })
    if (r?.aviso) toast.add({ title: 'Atenção', description: r.aviso, color: 'warning' })
    toast.add({ title: sucesso, color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível concluir', description: e?.statusMessage, color: 'error' })
  } finally {
    agindo.value = false
  }
}

const intervaloSegundos = ref(10)
watchEffect(() => { if (data.value) intervaloSegundos.value = data.value.lote.intervaloMs / 1000 })

async function salvarIntervalo() {
  await $fetch(api(`/api/admin/batches/${id}/intervalo`), {
    method: 'POST',
    body: { intervaloMs: intervaloSegundos.value * 1000 }
  })
  toast.add({ title: `Intervalo ajustado para ${intervaloSegundos.value}s`, color: 'success' })
  refresh()
}

const agendado = computed(() => data.value?.lote.status === 'agendado')
const cancelando = ref(false)

async function cancelarAgendamento() {
  cancelando.value = true
  try {
    await $fetch(api(`/api/admin/batches/${id}/agendar`), {
      method: 'POST',
      body: { agendadoPara: null }
    })
    toast.add({ title: 'Agendamento cancelado', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível cancelar', description: e?.statusMessage, color: 'error' })
  } finally {
    cancelando.value = false
  }
}

const progresso = computed(() => {
  const l = data.value?.lote
  if (!l?.total) return 0
  return Math.round(((l.enviados + l.falhas) / l.total) * 100)
})

const rodando = computed(() => data.value?.lote.status === 'enviando')
const CORES_LOG: Record<string, string> = {
  enviado: 'text-success',
  erro: 'text-error',
  pausado: 'text-warning',
  concluido: 'text-success',
  iniciado: 'text-info',
  conectado: 'text-muted'
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <!-- Cabeçalho -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <UButton to="/admin/lotes" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="xs" />
          <h1 class="text-2xl font-semibold">{{ data.lote.nome }}</h1>
          <UBadge :color="(CORES_STATUS[data.lote.status] as any) || 'neutral'" variant="subtle" :label="data.lote.status" />
        </div>
        <p class="mt-1 text-sm text-muted">{{ data.lote.assuntoSnapshot }}</p>
        <p class="text-xs text-muted">
          Criado em {{ dataHora(data.lote.createdAt) }}
          <template v-if="data.lote.arquivoNome"> · {{ data.lote.arquivoNome }}</template>
        </p>
        <p v-if="data.lote.agendadoPara" class="mt-1 flex items-center gap-1.5 text-xs" :class="agendado ? 'text-info' : 'text-muted'">
          <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
          {{ agendado ? 'Disparo agendado para' : 'Estava agendado para' }}
          {{ dataHora(data.lote.agendadoPara) }}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="agendado"
          label="Cancelar agendamento"
          icon="i-lucide-calendar-x"
          color="neutral"
          variant="outline"
          :loading="cancelando"
          @click="cancelarAgendamento"
        />
        <UButton
          v-if="!rodando"
          :label="agendado ? 'Disparar agora' : 'Iniciar disparo'"
          icon="i-lucide-play"
          :loading="agindo"
          :disabled="data.lote.status === 'concluido' && !data.contagem.pendentes"
          @click="acao('start', 'Disparo iniciado')"
        />
        <UButton
          v-else
          label="Pausar"
          icon="i-lucide-pause"
          color="warning"
          :loading="agindo"
          @click="acao('pause', 'Disparo pausado')"
        />
        <UButton
          v-if="data.contagem.erros"
          :label="`Reenviar ${data.contagem.erros} falha(s)`"
          icon="i-lucide-rotate-cw"
          color="neutral"
          variant="outline"
          :loading="agindo"
          @click="acao('retry', 'Falhas recolocadas na fila')"
        />
        <UButton
          :to="`/admin/relatorio?batchId=${id}`"
          label="Relatório"
          icon="i-lucide-chart-no-axes-column"
          color="neutral"
          variant="outline"
        />
      </div>
    </div>

    <!--
      Quando o proprio sistema muda o status (agendamento vencido durante uma
      queda, por exemplo), o motivo precisa aparecer — senao o operador so ve
      um lote pausado sem explicacao.
    -->
    <UAlert
      v-if="data.lote.observacao"
      color="warning"
      variant="subtle"
      icon="i-lucide-calendar-x"
      title="Este lote foi pausado pelo sistema"
      :description="data.lote.observacao"
    />

    <!-- Progresso -->
    <UCard>
      <div class="space-y-4">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium">
            {{ data.lote.enviados + data.lote.falhas }} de {{ data.lote.total }} processados
          </span>
          <span class="text-muted">{{ progresso }}%</span>
        </div>
        <UProgress :model-value="progresso" :max="100" :color="data.lote.falhas ? 'warning' : 'primary'" />

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          <div v-for="m in [
            { r: 'Pendentes', v: data.contagem.pendentes, i: 'i-lucide-clock', c: 'text-muted' },
            { r: 'Enviados', v: data.contagem.enviados, i: 'i-lucide-send', c: 'text-success' },
            { r: 'Falhas', v: data.contagem.erros, i: 'i-lucide-triangle-alert', c: 'text-error' },
            { r: 'Prov. leituras', v: data.contagem.aberturasPessoa, i: 'i-lucide-eye', c: 'text-info' },
            { r: 'Só automático', v: data.contagem.aberturasMaquina, i: 'i-lucide-bot', c: 'text-muted' },
            { r: 'Acessos', v: data.contagem.acessos, i: 'i-lucide-mouse-pointer-click', c: 'text-info' },
            { r: 'Confirmações', v: data.contagem.confirmacoes, i: 'i-lucide-badge-check', c: 'text-primary' },
            { r: 'Downloads', v: data.contagem.downloads, i: 'i-lucide-download', c: 'text-primary' },
            { r: 'Total', v: data.contagem.total, i: 'i-lucide-users', c: '' }
          ]" :key="m.r" class="rounded-lg border border-default p-3">
            <div class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon :name="m.i" class="size-3.5" />{{ m.r }}
            </div>
            <p class="mt-1 text-xl font-semibold" :class="m.c">{{ m.v }}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-3 border-t border-default pt-4">
          <UFormField label="Intervalo entre envios (segundos)" class="w-56" help="Pode ser ajustado com o lote rodando.">
            <UInput v-model.number="intervaloSegundos" type="number" min="1" max="600" class="w-full" />
          </UFormField>
          <UButton label="Aplicar" icon="i-lucide-check" color="neutral" variant="outline" @click="salvarIntervalo" />
        </div>
      </div>
    </UCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Log ao vivo -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Disparo em tempo real</h2>
            <UBadge
              :color="conectado ? 'success' : 'neutral'"
              variant="subtle"
              :icon="conectado ? 'i-lucide-radio' : 'i-lucide-radio-tower'"
              :label="conectado ? 'ao vivo' : 'reconectando'"
            />
          </div>
        </template>

        <div class="h-[420px] overflow-y-auto rounded-lg bg-elevated/50 p-3 font-mono text-xs">
          <p v-if="!log.length" class="py-8 text-center text-muted">
            Aguardando eventos… inicie o disparo para acompanhar aqui.
          </p>
          <div v-for="(l, i) in log" :key="i" class="border-b border-default/50 py-1.5 last:border-0">
            <span class="text-muted">{{ hora(l.at) }}</span>
            <span class="mx-2 font-semibold" :class="CORES_LOG[l.tipo] || ''">{{ l.tipo }}</span>
            <span v-if="l.email">{{ l.email }}</span>
            <span v-if="l.codigo" class="ml-2 text-muted">{{ l.codigo }}</span>
            <p v-if="l.mensagem" class="truncate pl-14 text-muted">{{ l.mensagem }}</p>
          </div>
        </div>
      </UCard>

      <!-- Destinatários -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Destinatários</h2>
            <UButton icon="i-lucide-refresh-cw" size="xs" color="neutral" variant="ghost" @click="refreshDest()" />
          </div>
        </template>

        <div class="h-[420px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-default text-left text-xs uppercase text-muted">
              <tr>
                <th class="px-2 py-2">Destinatário</th>
                <th class="px-2 py-2">Código</th>
                <th class="px-2 py-2">Status</th>
                <th class="px-2 py-2">Marcos</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in destinatarios?.destinatarios" :key="d.id" class="border-t border-default">
                <td class="max-w-[180px] px-2 py-2">
                  <NuxtLink :to="`/admin/destinatario/${d.id}`" class="block truncate hover:text-primary">
                    {{ d.nome || d.email }}
                  </NuxtLink>
                  <span v-if="d.nome" class="block truncate text-xs text-muted">{{ d.email }}</span>
                </td>
                <td class="px-2 py-2 font-mono text-xs">{{ d.codigo }}</td>
                <td class="px-2 py-2">
                  <UBadge :color="(CORES_STATUS[d.status] as any) || 'neutral'" variant="subtle" size="xs" :label="d.status" />
                </td>
                <td class="px-2 py-2">
                  <div class="flex gap-1">
                    <UTooltip text="Indício de abertura">
                      <UIcon name="i-lucide-eye" class="size-4" :class="d.firstOpenAt ? 'text-info' : 'text-muted/30'" />
                    </UTooltip>
                    <UTooltip text="Acessou a página">
                      <UIcon name="i-lucide-mouse-pointer-click" class="size-4" :class="d.firstAccessAt ? 'text-info' : 'text-muted/30'" />
                    </UTooltip>
                    <UTooltip text="Confirmou a leitura">
                      <UIcon name="i-lucide-badge-check" class="size-4" :class="d.confirmedAt ? 'text-primary' : 'text-muted/30'" />
                    </UTooltip>
                    <UTooltip text="Baixou o arquivo">
                      <UIcon name="i-lucide-download" class="size-4" :class="d.firstDownloadAt ? 'text-primary' : 'text-muted/30'" />
                    </UTooltip>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="(destinatarios?.total || 0) > (destinatarios?.destinatarios.length || 0)" class="px-2 py-3 text-center text-xs text-muted">
            Mostrando {{ destinatarios?.destinatarios.length }} de {{ destinatarios?.total }} —
            <NuxtLink :to="`/admin/relatorio?batchId=${id}`" class="text-primary">ver todos no relatório</NuxtLink>
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>
