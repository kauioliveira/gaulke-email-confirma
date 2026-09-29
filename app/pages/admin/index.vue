<script setup lang="ts">
/**
 * Painel inicial: como os envios estão indo, o que precisa de atenção agora e
 * o que depende de quem está olhando.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Início — Gaulke Comunica' })

type Dashboard = {
  periodo: { de: string; ate: string }
  kpis: {
    lotes: number
    enviados: number
    confirmados: number
    taxaConfirmacao: number | null
    aberturasPessoa: number
    respostas: number
    devolucoes: number
    reenviados: number
    medianaHorasConfirmacao: number | null
  }
  serie: { dia: string; enviados: number; confirmados: number }[]
  alertas: {
    canaisFalhando: string[]
    caixasFalhando: string[]
    chamadosErro: number
    pausadosSistema: number
    agendados24h: number
    certificadosVencendo: { nome: string; dias: number }[]
  }
  minhasPendencias: { id: number; nome: string; status: string; motivo: string; n: number; to: string }[]
}

const { sessao } = usePapel()
const periodo = reactive({ de: dataSP(new Date(Date.now() - 29 * 86_400_000)), ate: dataSP() })
const { data, status } = await useFetch<Dashboard>(api('/api/admin/dashboard'), {
  query: computed(() => ({ de: periodo.de, ate: periodo.ate }))
})

/** "3,5 h", "2 dias" — tempo até a confirmação dito como gente fala */
function tempo(horas: number | null) {
  if (horas === null) return '—'
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`
  if (horas < 48) return `${horas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${Math.round(horas / 24)} dias`
}
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

const tiles = computed(() => {
  const k = data.value?.kpis
  if (!k) return []
  return [
    { rotulo: 'E-mails enviados', valor: k.enviados.toLocaleString('pt-BR'), sub: `${k.lotes} lote(s)`, icone: 'i-lucide-send' },
    { rotulo: 'Confirmaram a leitura', valor: pct(k.taxaConfirmacao), sub: `${k.confirmados.toLocaleString('pt-BR')} pessoa(s)`, icone: 'i-lucide-badge-check' },
    { rotulo: 'Tempo até confirmar', valor: tempo(k.medianaHorasConfirmacao), sub: 'mediana', icone: 'i-lucide-timer' },
    { rotulo: 'Prováveis leituras', valor: k.aberturasPessoa.toLocaleString('pt-BR'), sub: 'abriram o e-mail', icone: 'i-lucide-eye' },
    { rotulo: 'Respostas', valor: k.respostas.toLocaleString('pt-BR'), sub: 'de clientes', icone: 'i-lucide-reply' },
    { rotulo: 'Devoluções', valor: k.devolucoes.toLocaleString('pt-BR'), sub: 'endereço inexistente', icone: 'i-lucide-mail-x', ruim: k.devolucoes > 0 }
  ]
})

const alertas = computed(() => {
  const a = data.value?.alertas
  if (!a) return []
  return [
    ...a.canaisFalhando.map(c => ({ icone: 'i-lucide-unplug', cor: 'error', texto: `O canal "${c}" falhou no último teste de conexão.`, link: '/admin/configuracoes' })),
    ...a.caixasFalhando.map(c => ({ icone: 'i-lucide-inbox', cor: 'error', texto: `A leitura da caixa do canal "${c}" está falhando: devoluções e respostas não estão sendo vistas.`, link: '/admin/configuracoes' })),
    ...a.certificadosVencendo.map(c => ({
      icone: 'i-lucide-shield-alert',
      cor: c.dias < 0 ? 'error' : 'warning',
      texto: c.dias < 0
        ? `O certificado digital "${c.nome}" venceu: o selo "Assinar como Gaulke" não funciona até cadastrar o novo.`
        : `O certificado digital "${c.nome}" vence em ${c.dias} dia(s). Renove e cadastre o novo em Configurações.`,
      link: '/admin/configuracoes'
    })),
    ...(a.chamadosErro ? [{ icone: 'i-lucide-ticket', cor: 'warning', texto: `${a.chamadosErro} chamado(s) não chegaram ao painel.`, link: '/admin/configuracoes' }] : []),
    ...(a.pausadosSistema ? [{ icone: 'i-lucide-pause', cor: 'warning', texto: `${a.pausadosSistema} lote(s) pausados pelo sistema (agendamento vencido) esperando alguém.`, link: '/admin/lotes' }] : []),
    ...(a.agendados24h ? [{ icone: 'i-lucide-calendar-clock', cor: 'info', texto: `${a.agendados24h} lote(s) agendados para as próximas 24 horas.`, link: '/admin/lotes' }] : [])
  ]
})

const MOTIVOS: Record<string, (n: number) => string> = {
  falhas: n => `${n} falha(s) de envio`,
  rascunho: n => `rascunho com ${n} destinatário(s), ainda não disparado`,
  devolucoes: n => `${n} devolução(ões): e-mail inexistente`,
  sem_confirmacao: n => `${n} ainda sem confirmar a leitura`,
  solic_analisar: n => `${n} documento(s) para analisar`,
  solic_avisar: n => `${n} recusa(s) ainda não avisada(s) ao cliente`,
  solic_atrasada: () => 'solicitação com o prazo vencido',
  solic_erro: () => 'o e-mail da solicitação não saiu',
  assin_recusado: () => 'assinatura recusada',
  assin_final_erro: () => 'todos assinaram, mas o PDF final falhou',
  assin_email_erro: n => `${n} convite(s) de assinatura não saíram`
}
const ICONES_MOTIVO: Record<string, string> = {
  falhas: 'i-lucide-triangle-alert',
  rascunho: 'i-lucide-file-pen',
  devolucoes: 'i-lucide-mail-x',
  sem_confirmacao: 'i-lucide-clock',
  solic_analisar: 'i-lucide-folder-search',
  solic_avisar: 'i-lucide-mail-warning',
  solic_atrasada: 'i-lucide-alarm-clock',
  solic_erro: 'i-lucide-mail-x',
  assin_recusado: 'i-lucide-circle-x',
  assin_final_erro: 'i-lucide-triangle-alert',
  assin_email_erro: 'i-lucide-mail-x'
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Olá{{ sessao?.usuario?.id ? `, ${sessao.usuario.nome.split(' ')[0]}` : '' }}!</h1>
        <p class="text-sm text-muted">Como os envios estão indo. Horários de Brasília.</p>
      </div>
      <SeletorPeriodo v-model:de="periodo.de" v-model:ate="periodo.ate" />
    </div>

    <!-- alertas: o que precisa de alguém agora -->
    <div v-if="alertas.length" class="space-y-2">
      <UAlert
        v-for="(a, i) in alertas"
        :key="i"
        :color="a.cor as any"
        variant="subtle"
        :icon="a.icone"
        :description="a.texto"
        :actions="[{ label: 'Ver', to: a.link, color: 'neutral', variant: 'ghost' }]"
      />
    </div>

    <!-- números do período -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <UCard v-for="t in tiles" :key="t.rotulo" :ui="{ body: 'p-4 sm:p-4' }">
        <div class="flex items-center gap-1.5 text-xs text-muted">
          <UIcon :name="t.icone" class="size-3.5" />{{ t.rotulo }}
        </div>
        <p class="mt-1 text-2xl font-semibold tabular-nums" :class="t.ruim && 'text-error'">{{ t.valor }}</p>
        <p class="text-xs text-muted">{{ t.sub }}</p>
      </UCard>
    </div>

    <div class="grid gap-6 xl:grid-cols-[1fr_400px]">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Envios e confirmações por dia</h2>
        </template>
        <GraficoEnvios v-if="data" :serie="data.serie" />
        <p v-else-if="status === 'pending'" class="py-16 text-center text-sm text-muted">Carregando…</p>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Minhas pendências</h2>
            <UButton to="/admin/lotes/novo" icon="i-lucide-plus" label="Novo envio" size="xs" />
          </div>
        </template>
        <ul v-if="data?.minhasPendencias.length" class="divide-y divide-default">
          <li v-for="(p, i) in data.minhasPendencias" :key="i">
            <NuxtLink :to="p.to" class="flex items-start gap-3 py-2 hover:text-primary">
              <UIcon :name="ICONES_MOTIVO[p.motivo] ?? 'i-lucide-circle'" class="mt-0.5 size-4 shrink-0 text-muted" />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{{ p.nome }}</span>
                <span class="block text-xs text-muted">{{ MOTIVOS[p.motivo]?.(p.n) ?? p.motivo }}</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="py-8 text-center text-sm text-muted">
          {{ sessao?.usuario?.id ? 'Nada pendente nos envios e solicitações que você criou.' : 'Entre pelo painel para ver as suas pendências.' }}
        </p>
      </UCard>
    </div>
  </div>
</template>
