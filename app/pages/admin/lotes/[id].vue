<script setup lang="ts">
import { dataHora, duracao, CORES_STATUS } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)
const { sessao, eSupervisor, eAdmin } = usePapel()

const { data, refresh } = await useFetch<RespostaLote>(api(`/api/admin/batches/${id}`))
useHead({ title: () => `${data.value?.lote.nome || 'Lote'} — Gaulke Comunica` })

const { data: destinatarios, refresh: refreshDest } = await useFetch<RespostaDestinatarios>(
  api(`/api/admin/batches/${id}/destinatarios`),
  { query: { porPagina: 50 } }
)

/* ---------- Log: histórico gravado + ao vivo via SSE ---------- */
type Linha = { tipo: string; email?: string; codigo?: string; mensagem?: string; at: string; recipientId?: number }
const log = ref<Linha[]>([])

/**
 * Histórico PERMANENTE (eventos gravados no banco), com a resposta do servidor
 * SMTP. O SSE só mostra o que acontece com a tela aberta; o histórico é o que
 * permite depurar depois. Quando o histórico é recarregado, o ao vivo é
 * zerado — ele já está contido no histórico.
 */
const { data: historico, refresh: refreshLogBruto } = await useFetch<{ log: LinhaLogLote[] }>(
  api(`/api/admin/batches/${id}/log`)
)
async function refreshLog() {
  await refreshLogBruto()
  log.value = []
}
function mensagemDoHistorico(l: LinhaLogLote) {
  const m = l.meta ?? {}
  if (l.tipo === 'erro') {
    return `${m.reenvio ? 'Reenvio falhou: ' : ''}${m.erro ?? 'falha'}${m.tentativa ? ` (tentativa ${m.tentativa})` : ''}`
  }
  const resposta = m.resposta ?? (m.messageId ? `aceito pelo servidor · ${m.messageId}` : 'aceito pelo servidor')
  return l.tipo === 'reenvio' ? `Reenvio nº ${m.envio ?? '?'}${m.por ? ` por ${m.por}` : ''}: ${resposta}` : resposta
}
const linhasLog = computed<Linha[]>(() => [
  ...log.value.filter(l => !['ping'].includes(l.tipo)),
  ...(historico.value?.log ?? []).map(l => ({
    tipo: l.tipo,
    email: l.email,
    codigo: l.codigo,
    recipientId: l.recipientId,
    at: l.at,
    mensagem: mensagemDoHistorico(l)
  }))
])
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
      if (p.tipo !== 'iniciado') refreshLog()
    }
    // reenvio e o que volta pela caixa mudam a pessoa: a lista e os numeros mostram
    if (['reenvio', 'devolucao', 'resposta', 'recibo'].includes(p.tipo)) {
      refreshDest()
      if (p.tipo !== 'reenvio') refresh()
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

/* lembrete automatico a quem nao confirmou */
const lembrete = reactive({ ligado: false, dias: 3, max: 2 })
watchEffect(() => {
  const l = data.value?.lote
  if (!l) return
  lembrete.ligado = !!l.lembreteDias && (l.lembreteMax ?? 0) > 0
  lembrete.dias = l.lembreteDias || 3
  lembrete.max = l.lembreteMax || 2
})
const salvandoLembrete = ref(false)
async function salvarLembrete() {
  salvandoLembrete.value = true
  try {
    await $fetch(api(`/api/admin/batches/${id}/lembrete`), {
      method: 'POST',
      body: { lembrete: lembrete.ligado ? { dias: lembrete.dias, max: lembrete.max } : null }
    })
    toast.add({
      title: lembrete.ligado ? `Lembrete a cada ${lembrete.dias} dia(s), até ${lembrete.max}x` : 'Lembrete automático desligado',
      color: 'success'
    })
    refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar o lembrete', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvandoLembrete.value = false
  }
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
const naLixeira = computed(() => !!data.value?.lote.excluidoEm)
const jaDisparou = computed(() => !!data.value?.lote.startedAt)

/* ---------- arquivar / excluir / restaurar ---------- */
const arquivando = ref(false)
async function alternarArquivo() {
  if (!data.value) return
  const valor = !data.value.lote.arquivadoEm
  arquivando.value = true
  try {
    const r = await $fetch<{ alterados: number }>(api('/api/admin/batches/arquivar'), {
      method: 'POST',
      body: { ids: [id], arquivar: valor }
    })
    if (!r.alterados) throw { statusMessage: 'Lote enviando ou agendado não pode ser arquivado.' }
    toast.add({
      title: valor ? 'Lote arquivado' : 'Lote de volta à lista',
      description: valor ? 'Continua funcionando para os destinatários; só sai da lista principal.' : undefined,
      color: 'success'
    })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível alterar', description: e?.statusMessage, color: 'error' })
  } finally {
    arquivando.value = false
  }
}

const modalExcluir = ref(false)
const podeExcluir = computed(() => {
  const l = data.value?.lote
  if (!l || l.status === 'enviando' || naLixeira.value) return false
  if (jaDisparou.value || l.enviados || l.falhas) return eSupervisor.value
  return eSupervisor.value || l.criadoPorUserId === null || l.criadoPorUserId === sessao.value?.usuario?.id
})
async function aposExcluir(lixeira: boolean) {
  // da lixeira, o admin continua podendo ver (e restaurar); os demais saem
  if (lixeira && eAdmin.value) await refresh()
  else await navigateTo('/admin/lotes')
}

const restaurando = ref(false)
async function restaurar() {
  restaurando.value = true
  try {
    await $fetch(api(`/api/admin/batches/${id}/restaurar`), { method: 'POST' })
    toast.add({ title: 'Lote restaurado', description: 'Os links dos destinatários voltaram a funcionar.', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível restaurar', description: e?.statusMessage, color: 'error' })
  } finally {
    restaurando.value = false
  }
}

/* ---------- confirmação do disparo ---------- */
const confirmandoDisparo = ref(false)
const resumoDisparo = computed(() => {
  const l = data.value?.lote
  const c = data.value?.canal
  return {
    canal: c?.nome ?? l?.contaNome ?? null,
    remetente: c?.remetente ?? null,
    responderPara: l?.responderPara ?? c?.responderPara ?? null,
    destinatarios: data.value?.contagem.pendentes ?? 0,
    anexo: l?.arquivoNome ?? null,
    quando: 'agora' as const,
    duracao: duracao(Math.max(0, (data.value?.contagem.pendentes ?? 1) - 1) * (l?.intervaloMs ?? 0)),
    exigirConfirmacao: l?.exigirConfirmacao === 'true'
  }
})
async function dispararConfirmado() {
  await acao('start', 'Disparo iniciado')
  confirmandoDisparo.value = false
}

/* ---------- reenvio ---------- */
type ModoReenvio = 'individual' | 'selecionados' | 'naoConfirmou'
const reenvio = reactive({
  aberto: false,
  modo: 'individual' as ModoReenvio,
  destinatario: null as Destinatario | null
})
const selecionados = ref<number[]>([])
const REENVIAVEIS = ['enviado', 'erro', 'bounce']
const reenviavel = (d: Destinatario) => REENVIAVEIS.includes(d.status) && !d.reenvioPendente

const visiveisReenviaveis = computed(() => (destinatarios.value?.destinatarios ?? []).filter(reenviavel))
const todosMarcados = computed(
  () => visiveisReenviaveis.value.length > 0 && visiveisReenviaveis.value.every(d => selecionados.value.includes(d.id))
)
function marcarTodos(v: boolean) {
  selecionados.value = v ? visiveisReenviaveis.value.map(d => d.id) : []
}
function marcar(idDest: number, v: boolean) {
  selecionados.value = v ? [...selecionados.value, idDest] : selecionados.value.filter(x => x !== idDest)
}

function abrirReenvio(modo: ModoReenvio, d: Destinatario | null = null) {
  reenvio.modo = modo
  reenvio.destinatario = d
  reenvio.aberto = true
}
const quantidadeReenvio = computed(() =>
  reenvio.modo === 'naoConfirmou' ? data.value?.contagem.naoConfirmaram ?? 0 : selecionados.value.length
)
async function aposReenvio() {
  if (reenvio.modo === 'selecionados') selecionados.value = []
  await Promise.all([refresh(), refreshDest(), refreshLog()])
}

const CORES_LOG: Record<string, string> = {
  reenvio: 'text-primary',
  devolucao: 'text-error',
  resposta: 'text-info',
  recibo: 'text-success',
  auto_resposta: 'text-muted',
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
          <UBadge v-if="data.lote.arquivadoEm" color="neutral" variant="outline" icon="i-lucide-archive" label="arquivado" />
        </div>
        <p class="mt-1 text-sm text-muted">{{ data.lote.assuntoSnapshot }}</p>
        <p class="text-xs text-muted">
          Criado em {{ dataHora(data.lote.createdAt) }}
          <template v-if="data.lote.criadoPorNome"> por {{ data.lote.criadoPorNome }}</template>
          <template v-if="data.lote.arquivoNome"> · {{ data.lote.arquivoNome }}</template>
        </p>
        <!-- quem apertou o botao: e o que o relatorio precisa provar -->
        <p v-if="data.lote.disparadoPorNome" class="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <UIcon name="i-lucide-user-check" class="size-3.5" />
          Disparado por {{ data.lote.disparadoPorNome }}
        </p>
        <p v-if="data.lote.contaNome" class="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <UIcon name="i-lucide-send" class="size-3.5" />
          Sai por {{ data.lote.contaNome }}
          <template v-if="data.lote.responderPara"> · respostas para {{ data.lote.responderPara }}</template>
        </p>
        <p v-if="data.lote.agendadoPara" class="mt-1 flex items-center gap-1.5 text-xs" :class="agendado ? 'text-info' : 'text-muted'">
          <UIcon name="i-lucide-calendar-clock" class="size-3.5" />
          {{ agendado ? 'Disparo agendado para' : 'Estava agendado para' }}
          {{ dataHora(data.lote.agendadoPara) }}
        </p>
      </div>

      <div v-if="naLixeira" class="flex flex-wrap gap-2">
        <UButton
          v-if="eAdmin"
          label="Restaurar da lixeira"
          icon="i-lucide-undo-2"
          :loading="restaurando"
          @click="restaurar"
        />
      </div>
      <div v-else class="flex flex-wrap gap-2">
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
          :disabled="!data.contagem.pendentes"
          @click="confirmandoDisparo = true"
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
          v-if="jaDisparou && data.contagem.naoConfirmaram"
          :label="`Reenviar para quem não confirmou (${data.contagem.naoConfirmaram})`"
          icon="i-lucide-send-horizontal"
          color="neutral"
          variant="outline"
          @click="abrirReenvio('naoConfirmou')"
        />
        <UButton
          :to="`/admin/relatorio?batchId=${id}`"
          label="Relatório"
          icon="i-lucide-chart-no-axes-column"
          color="neutral"
          variant="outline"
        />
        <UButton
          v-if="jaDisparou"
          label="Dossiê (PDF)"
          icon="i-lucide-file-badge"
          color="neutral"
          variant="outline"
          :href="api(`/api/admin/batches/${id}/dossie`)"
          external
          target="_blank"
        />
        <UDropdownMenu
          :items="[
            ...(data.lote.status !== 'enviando' && data.lote.status !== 'agendado' || data.lote.arquivadoEm
              ? [{
                  label: data.lote.arquivadoEm ? 'Desarquivar' : 'Arquivar',
                  icon: data.lote.arquivadoEm ? 'i-lucide-archive-restore' : 'i-lucide-archive',
                  onSelect: alternarArquivo
                }]
              : []),
            ...(podeExcluir
              ? [{
                  label: jaDisparou ? 'Mandar para a lixeira' : 'Excluir',
                  icon: 'i-lucide-trash-2',
                  color: 'error' as const,
                  onSelect: () => { modalExcluir = true }
                }]
              : [])
          ]"
        >
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" aria-label="Mais ações" :loading="arquivando" />
        </UDropdownMenu>
      </div>
    </div>

    <UAlert
      v-if="naLixeira"
      color="error"
      variant="subtle"
      icon="i-lucide-archive-x"
      title="Este lote está na lixeira"
      :description="`Enviado para a lixeira em ${dataHora(data.lote.excluidoEm)} por ${data.lote.excluidoPorNome ?? '—'}. Motivo: ${data.lote.excluidoMotivo ?? '—'}. Os links dos destinatários não abrem, mas os registros estão preservados.`"
    />

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

    <!-- Chamados abertos no painel a partir deste lote -->
    <UCard v-if="data.chamados?.length">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-ticket" class="size-5 text-primary" />
          <h2 class="font-semibold">Chamados no painel</h2>
        </div>
      </template>
      <ul class="space-y-2 text-sm">
        <li v-for="(c, i) in data.chamados" :key="i" class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="c.statusEnvio === 'erro' ? 'error' : c.statusEnvio === 'pendente' ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
            :label="c.ticketCode ?? (c.statusEnvio === 'pendente' ? 'na fila' : c.statusEnvio)"
          />
          <span>{{ c.motivo === 'resposta' ? 'Resposta de cliente' : 'Sem confirmação de leitura' }}</span>
          <span v-if="c.statusEnvio === 'comentado'" class="text-xs text-muted">(comentado no chamado aberto)</span>
          <span class="text-xs text-muted">· {{ dataHora(c.criadoEm) }}</span>
          <span v-if="c.erro" class="text-xs" :class="c.statusEnvio === 'erro' ? 'text-error' : 'text-muted'">— {{ c.erro }}</span>
        </li>
      </ul>
    </UCard>

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

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div v-for="m in [
            { r: 'Pendentes', v: data.contagem.pendentes, i: 'i-lucide-clock', c: 'text-muted' },
            { r: 'Enviados', v: data.contagem.enviados, i: 'i-lucide-send', c: 'text-success' },
            { r: 'Falhas', v: data.contagem.erros, i: 'i-lucide-triangle-alert', c: 'text-error' },
            { r: 'Prov. leituras', v: data.contagem.aberturasPessoa, i: 'i-lucide-eye', c: 'text-info' },
            { r: 'Só automático', v: data.contagem.aberturasMaquina, i: 'i-lucide-bot', c: 'text-muted' },
            { r: 'Acessos', v: data.contagem.acessos, i: 'i-lucide-mouse-pointer-click', c: 'text-info' },
            { r: 'Confirmações', v: data.contagem.confirmacoes, i: 'i-lucide-badge-check', c: 'text-primary' },
            { r: 'Downloads', v: data.contagem.downloads, i: 'i-lucide-download', c: 'text-primary' },
            { r: 'Reenviados', v: data.contagem.reenviados, i: 'i-lucide-send-horizontal', c: 'text-primary' },
            { r: 'Devoluções', v: data.contagem.devolucoes, i: 'i-lucide-mail-x', c: 'text-error' },
            { r: 'Respostas', v: data.contagem.respostas, i: 'i-lucide-reply', c: 'text-info' },
            { r: 'Recibos', v: data.contagem.recibos, i: 'i-lucide-mail-check', c: 'text-success' },
            { r: 'Lembretes', v: data.contagem.lembretes ?? 0, i: 'i-lucide-bell-ring', c: 'text-warning' },
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

          <!-- lembrete automatico: so faz sentido enquanto o lote existe fora da lixeira -->
          <div v-if="!data.lote.excluidoEm" class="flex flex-wrap items-end gap-3 sm:ml-auto">
            <UFormField label="Lembrete automático" help="Para quem não confirmou; dia útil, 8h–18h.">
              <div class="flex items-center gap-2 text-sm">
                <USwitch v-model="lembrete.ligado" />
                <template v-if="lembrete.ligado">
                  <span class="text-muted">a cada</span>
                  <UInput v-model.number="lembrete.dias" type="number" min="1" max="30" class="w-16" />
                  <span class="text-muted">dia(s), até</span>
                  <UInput v-model.number="lembrete.max" type="number" min="1" max="5" class="w-14" />
                  <span class="text-muted">vez(es)</span>
                </template>
                <span v-else class="text-muted">desligado</span>
              </div>
            </UFormField>
            <UButton label="Salvar" icon="i-lucide-bell" color="neutral" variant="outline" :loading="salvandoLembrete" @click="salvarLembrete" />
          </div>
        </div>
      </div>
    </UCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Log ao vivo -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Log de envio</h2>
            <UBadge
              :color="conectado ? 'success' : 'neutral'"
              variant="subtle"
              :icon="conectado ? 'i-lucide-radio' : 'i-lucide-radio-tower'"
              :label="conectado ? 'ao vivo' : 'reconectando'"
            />
          </div>
        </template>

        <div class="h-[420px] overflow-y-auto rounded-lg bg-elevated/50 p-3 font-mono text-xs">
          <p v-if="!linhasLog.length" class="py-8 text-center text-muted">
            Nada enviado ainda. Inicie o disparo para acompanhar aqui.
          </p>
          <div v-for="(l, i) in linhasLog" :key="i" class="border-b border-default/50 py-1.5 last:border-0">
            <span class="text-muted">{{ dataHora(l.at) }}</span>
            <span class="mx-2 font-semibold" :class="CORES_LOG[l.tipo] || ''">{{ l.tipo }}</span>
            <NuxtLink v-if="l.email && l.recipientId" :to="`/admin/destinatario/${l.recipientId}`" class="hover:text-primary">{{ l.email }}</NuxtLink>
            <span v-else-if="l.email">{{ l.email }}</span>
            <span v-if="l.codigo" class="ml-2 text-muted">{{ l.codigo }}</span>
            <p v-if="l.mensagem" class="break-all pl-4 text-muted">{{ l.mensagem }}</p>
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          “Enviado” quer dizer que o servidor de e-mail <strong>aceitou</strong> a mensagem. Endereço inexistente
          costuma voltar depois, como devolução na caixa do remetente.
        </p>
      </UCard>

      <!-- Destinatários -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">Destinatários</h2>
            <div class="flex items-center gap-2">
              <UButton
                v-if="selecionados.length && !naLixeira"
                :label="`Reenviar selecionados (${selecionados.length})`"
                icon="i-lucide-send-horizontal"
                size="xs"
                @click="abrirReenvio('selecionados')"
              />
              <UButton icon="i-lucide-refresh-cw" size="xs" color="neutral" variant="ghost" aria-label="Atualizar" @click="refreshDest()" />
            </div>
          </div>
        </template>

        <div class="h-[420px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-default text-left text-xs uppercase text-muted">
              <tr>
                <th class="w-8 px-2 py-2">
                  <UCheckbox
                    v-if="jaDisparou && !naLixeira && visiveisReenviaveis.length"
                    :model-value="todosMarcados"
                    aria-label="Selecionar todos para reenvio"
                    @update:model-value="v => marcarTodos(!!v)"
                  />
                </th>
                <th class="px-2 py-2">Destinatário</th>
                <th class="px-2 py-2">Código</th>
                <th class="px-2 py-2">Status</th>
                <th class="px-2 py-2">Marcos</th>
                <th class="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in destinatarios?.destinatarios" :key="d.id" class="border-t border-default">
                <td class="px-2 py-2">
                  <UCheckbox
                    v-if="jaDisparou && !naLixeira && reenviavel(d)"
                    :model-value="selecionados.includes(d.id)"
                    :aria-label="`Selecionar ${d.email}`"
                    @update:model-value="v => marcar(d.id, !!v)"
                  />
                </td>
                <td class="max-w-[180px] px-2 py-2">
                  <NuxtLink :to="`/admin/destinatario/${d.id}`" class="block truncate hover:text-primary">
                    {{ d.nome || d.email }}
                  </NuxtLink>
                  <span v-if="d.nome" class="block truncate text-xs text-muted">{{ d.email }}</span>
                </td>
                <td class="px-2 py-2 font-mono text-xs">{{ d.codigo }}</td>
                <td class="px-2 py-2">
                  <div class="flex flex-wrap items-center gap-1">
                    <UBadge :color="(CORES_STATUS[d.status] as any) || 'neutral'" variant="subtle" size="xs" :label="d.status" />
                    <UTooltip v-if="(d.envios ?? 0) > 1" :text="`${d.envios} e-mails enviados (original + reenvios)`">
                      <UBadge color="primary" variant="outline" size="xs" :label="`×${d.envios}`" />
                    </UTooltip>
                    <UTooltip v-if="d.reenvioPendente" :text="`Reenvio na fila: ${d.reenvioPendente.motivo}`">
                      <UBadge color="info" variant="subtle" size="xs" icon="i-lucide-clock" label="reenvio" />
                    </UTooltip>
                  </div>
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
                    <UTooltip v-if="d.respondeuAt" :text="`Respondeu (${d.respostaCount}x)`">
                      <UIcon name="i-lucide-reply" class="size-4 text-info" />
                    </UTooltip>
                    <UTooltip v-if="d.bounceTipo" :text="`${d.bounceTipo === 'definitiva' ? 'Devolução definitiva' : 'Atraso na entrega'}: ${d.bounceMotivo ?? ''}`">
                      <UIcon name="i-lucide-mail-x" class="size-4" :class="d.bounceTipo === 'definitiva' ? 'text-error' : 'text-warning'" />
                    </UTooltip>
                  </div>
                </td>
                <td class="px-2 py-2 text-right">
                  <UTooltip v-if="!naLixeira && reenviavel(d)" text="Reenviar agora">
                    <UButton
                      icon="i-lucide-send-horizontal"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :aria-label="`Reenviar para ${d.email}`"
                      @click="abrirReenvio('individual', d)"
                    />
                  </UTooltip>
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

    <ModalReenvio
      v-model:open="reenvio.aberto"
      :modo="reenvio.modo"
      :lote-id="id"
      :canal-lote-id="data.lote.contaId"
      :destinatario="reenvio.destinatario"
      :ids="selecionados"
      :quantidade="quantidadeReenvio"
      @concluido="aposReenvio"
    />
    <ModalExcluirLote v-model:open="modalExcluir" :lote="data.lote" @excluido="aposExcluir" />
    <ModalConfirmarEnvio
      v-model:open="confirmandoDisparo"
      :resumo="resumoDisparo"
      :carregando="agindo"
      @confirmar="dispararConfirmado"
    />
  </div>
</template>
