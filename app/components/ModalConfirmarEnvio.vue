<script setup lang="ts">
/**
 * Confirmação antes de um envio sair (ou ser agendado): por onde sai, para
 * onde vão as respostas, para quantos, com qual anexo e quando.
 *
 * É a última chance de perceber o canal errado — depois do disparo não há
 * como "desenviar". Por isso o botão só libera depois do "Conferi".
 */
export type ResumoEnvio = {
  canal: string | null
  remetente: string | null
  responderPara: string | null
  destinatarios: number
  anexo: string | null
  /** rascunho: cria sem enviar; agendado: dispara sozinho; agora: dispara já */
  quando: 'rascunho' | 'agendado' | 'agora'
  agendadoPara?: string | null
  duracao?: string | null
  exigirConfirmacao: boolean
  /** lembrete automatico a quem nao confirmou */
  lembrete?: { dias: number; max: number } | null
  /** problemas que a pessoa precisa ver antes de confirmar */
  avisos?: string[]
}

const props = defineProps<{ resumo: ResumoEnvio; carregando?: boolean }>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ confirmar: [] }>()

const conferi = ref(false)
watch(aberto, v => { if (v) conferi.value = false })

const linhas = computed(() => {
  const r = props.resumo
  return [
    { icone: 'i-lucide-send', rotulo: 'Sai por', valor: r.canal ? `${r.canal}${r.remetente ? ` — ${r.remetente}` : ''}` : 'SMTP do .env' },
    { icone: 'i-lucide-reply', rotulo: 'Respostas para', valor: r.responderPara || r.remetente || '—' },
    { icone: 'i-lucide-users', rotulo: 'Destinatários', valor: `${r.destinatarios}` },
    { icone: 'i-lucide-paperclip', rotulo: 'Anexo', valor: r.anexo || 'nenhum (comunicado)' },
    {
      icone: 'i-lucide-clock',
      rotulo: 'Quando',
      valor:
        r.quando === 'agendado'
          ? `Agendado para ${formatarDataHora(r.agendadoPara)} (Brasília)`
          : r.quando === 'agora'
            ? `Agora${r.duracao ? ` · cerca de ${r.duracao}` : ''}`
            : 'Fica como rascunho — você dispara na próxima tela'
    },
    {
      icone: 'i-lucide-badge-check',
      rotulo: 'Confirmação de leitura',
      valor: r.exigirConfirmacao ? 'exigida antes do download' : 'não exigida'
    },
    ...(r.lembrete !== undefined
      ? [{
          icone: 'i-lucide-bell-ring',
          rotulo: 'Lembrete',
          valor: r.lembrete
            ? `a cada ${r.lembrete.dias} dia(s) para quem não confirmou, até ${r.lembrete.max}x (dia útil, 8h–18h)`
            : 'não'
        }]
      : [])
  ]
})

const rotuloBotao = computed(() =>
  props.resumo.quando === 'agendado'
    ? 'Agendar envio'
    : props.resumo.quando === 'agora'
      ? `Disparar ${props.resumo.destinatarios} e-mail(s)`
      : 'Criar lote'
)
</script>

<template>
  <UModal v-model:open="aberto" :title="resumo.quando === 'rascunho' ? 'Confirmar criação do lote' : 'Confirmar envio'">
    <template #body>
      <div class="space-y-4">
        <dl class="divide-y divide-default rounded-lg border border-default">
          <div v-for="l in linhas" :key="l.rotulo" class="flex items-start gap-3 px-3 py-2.5">
            <UIcon :name="l.icone" class="mt-0.5 size-4 shrink-0 text-primary" />
            <dt class="w-32 shrink-0 text-sm text-muted">{{ l.rotulo }}</dt>
            <dd class="min-w-0 flex-1 break-words text-sm font-medium">{{ l.valor }}</dd>
          </div>
        </dl>
        <UAlert
          v-if="resumo.responderPara && resumo.remetente && !resumo.remetente.includes(resumo.responderPara.replace(/.*</, '').replace(/>.*/, ''))"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          description="O e-mail sai por um endereço e as respostas vão para outro. Confira se alguém acompanha a caixa de respostas."
        />
        <UAlert
          v-for="a in resumo.avisos ?? []"
          :key="a"
          color="error"
          variant="subtle"
          icon="i-lucide-mail-x"
          :description="a"
        />
        <UCheckbox v-model="conferi" label="Conferi o canal, as respostas e os destinatários" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Voltar" color="neutral" variant="ghost" @click="aberto = false" />
        <UButton
          :label="rotuloBotao"
          :icon="resumo.quando === 'agendado' ? 'i-lucide-calendar-clock' : 'i-lucide-rocket'"
          :loading="carregando"
          :disabled="!conferi"
          @click="emit('confirmar')"
        />
      </div>
    </template>
  </UModal>
</template>
