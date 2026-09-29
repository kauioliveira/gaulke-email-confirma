<script setup lang="ts">
/**
 * Reenvio depois do disparo — "o cliente diz que não recebeu".
 *
 *  - individual: sai NA HORA, com o mesmo link e código. Dá para corrigir o
 *    e-mail e trocar o canal; o resultado (enviado ou falhou) aparece aqui.
 *  - selecionados / naoConfirmou: vão pela FILA do lote, respeitando o
 *    intervalo entre envios.
 * Cada envio ganha um número no histórico da pessoa (nº 1 = original).
 */
type Modo = 'individual' | 'selecionados' | 'naoConfirmou'

const props = defineProps<{
  modo: Modo
  loteId: number
  /** canal usado pelo lote, pré-selecionado */
  canalLoteId?: number | null
  destinatario?: { id: number; nome: string | null; email: string; status: string } | null
  ids?: number[]
  /** quantos serão reenviados (selecionados ou não confirmados) */
  quantidade?: number
}>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ concluido: [] }>()

const toast = useToast()

const MOTIVOS = [
  { label: 'Cliente disse que não recebeu', value: 'Cliente disse que não recebeu' },
  { label: 'E-mail corrigido', value: 'E-mail corrigido' },
  { label: 'Lembrete: ainda não confirmou a leitura', value: 'Lembrete: ainda não confirmou a leitura' },
  { label: 'Outro motivo…', value: 'outro' }
]

const form = reactive({ para: '', motivo: MOTIVOS[0]!.value, outro: '', contaId: 0 })
const enviando = ref(false)
const resultado = ref<ResultadoReenvio | null>(null)

// canais: só para o individual (em massa, vale o canal do lote)
const { data: contasData, execute: carregarContas } = useFetch<RespostaContas>(api('/api/admin/contas'), {
  immediate: false,
  server: false
})
const itensCanal = computed(() =>
  (contasData.value?.contas ?? [])
    .filter(c => c.ativa)
    .map(c => ({ label: `${c.nome} — ${c.remetente}`, value: c.id }))
)

watch(aberto, v => {
  if (!v) return
  resultado.value = null
  form.para = props.destinatario?.email ?? ''
  form.motivo = props.modo === 'naoConfirmou' ? MOTIVOS[2]!.value : MOTIVOS[0]!.value
  form.outro = ''
  form.contaId = props.canalLoteId ?? 0
  if (props.modo === 'individual' && !contasData.value) carregarContas()
})

/** aplica a sugestão do aviso de domínio ("contabilgualke" → "contabilgaulke") */
function corrigirDominio(de: string, para: string) {
  const [local, dominio] = form.para.trim().split('@')
  if (local && dominio?.toLowerCase() === de) form.para = `${local}@${para}`
}

// escolheu "e-mail corrigido" sem mudar o endereço: provavelmente esqueceu
const emailMudou = computed(
  () => !!props.destinatario && form.para.trim().toLowerCase() !== props.destinatario.email
)
const motivoFinal = computed(() => (form.motivo === 'outro' ? form.outro.trim() : form.motivo))
const podeEnviar = computed(
  () => motivoFinal.value.length >= 3 && (props.modo !== 'individual' || /\S+@\S+\.\S+/.test(form.para))
)

const titulo = computed(() =>
  props.modo === 'individual'
    ? 'Reenviar e-mail'
    : props.modo === 'naoConfirmou'
      ? 'Reenviar para quem não confirmou'
      : 'Reenviar para os selecionados'
)

async function enviar() {
  enviando.value = true
  try {
    if (props.modo === 'individual' && props.destinatario) {
      resultado.value = await $fetch<ResultadoReenvio>(
        api(`/api/admin/destinatarios/${props.destinatario.id}/reenviar`),
        {
          method: 'POST',
          body: {
            para: emailMudou.value ? form.para.trim() : null,
            motivo: motivoFinal.value,
            contaId: form.contaId && form.contaId !== props.canalLoteId ? form.contaId : null
          }
        }
      )
      emit('concluido')
    } else {
      const r = await $fetch<{ enfileirados: number }>(api(`/api/admin/batches/${props.loteId}/reenviar`), {
        method: 'POST',
        body: {
          motivo: motivoFinal.value,
          ...(props.modo === 'naoConfirmou' ? { naoConfirmou: true } : { ids: props.ids })
        }
      })
      toast.add({
        title: r.enfileirados ? `${r.enfileirados} reenvio(s) na fila` : 'Ninguém para reenviar',
        description: r.enfileirados
          ? 'O lote voltou a disparar, respeitando o intervalo entre envios. Acompanhe no log.'
          : 'Quem já estava na fila ou ainda não recebeu o envio original ficou de fora.',
        color: r.enfileirados ? 'success' : 'warning',
        icon: 'i-lucide-send-horizontal'
      })
      aberto.value = false
      emit('concluido')
    }
  } catch (e: any) {
    toast.add({ title: 'Não foi possível reenviar', description: e?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="aberto" :title="titulo">
    <template #body>
      <!-- resultado do individual: fica na tela até fechar -->
      <div v-if="resultado" class="space-y-3">
        <UAlert
          v-if="resultado.ok"
          color="success"
          variant="subtle"
          icon="i-lucide-send"
          :title="`Envio nº ${resultado.numero} saiu para ${resultado.para}`"
          :description="`Canal: ${resultado.canal}. O mesmo link e o mesmo código do envio original continuam valendo.`"
        />
        <UAlert
          v-else
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`O envio nº ${resultado.numero} falhou`"
          :description="resultado.erro"
        />
        <p v-if="resultado.emailAnterior" class="text-xs text-muted">
          O e-mail foi corrigido de {{ resultado.emailAnterior }} para {{ resultado.para }} (vale também para os próximos envios).
        </p>
      </div>

      <div v-else class="space-y-4">
        <template v-if="modo === 'individual' && destinatario">
          <p class="text-sm">
            <strong>{{ destinatario.nome || destinatario.email }}</strong> recebe o mesmo e-mail do lote, com o
            mesmo link e código. Sai agora, fora da fila.
          </p>
          <UFormField label="Para" help="Corrija aqui se o cliente informou outro endereço.">
            <UInput v-model="form.para" type="email" class="w-full" />
          </UFormField>
          <!-- endereço com domínio que não recebe e-mail ou digitado errado -->
          <AvisoDominios
            :emails="[form.para]"
            compacto
            @corrigir="corrigirDominio"
          />
          <UFormField v-if="itensCanal.length > 1" label="Sai por">
            <USelect v-model="form.contaId" :items="itensCanal" class="w-full" />
          </UFormField>
        </template>
        <p v-else class="text-sm">
          <strong>{{ quantidade }}</strong> pessoa(s) voltam para a fila do lote e recebem o mesmo e-mail de novo,
          respeitando o intervalo entre envios. Os links e códigos continuam os mesmos.
        </p>

        <UFormField label="Motivo" required help="Fica no histórico de envios e na auditoria.">
          <USelect v-model="form.motivo" :items="MOTIVOS" class="w-full" />
        </UFormField>
        <UFormField v-if="form.motivo === 'outro'" label="Descreva o motivo">
          <UInput v-model="form.outro" class="w-full" autofocus />
        </UFormField>
        <UAlert
          v-if="modo === 'individual' && form.motivo === 'E-mail corrigido' && !emailMudou"
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          description="O endereço acima continua o mesmo. Se o cliente passou outro e-mail, corrija no campo Para."
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="resultado">
          <UButton label="Fechar" @click="aberto = false" />
        </template>
        <template v-else>
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="aberto = false" />
          <UButton
            :label="modo === 'individual' ? 'Reenviar agora' : `Reenviar para ${quantidade}`"
            icon="i-lucide-send-horizontal"
            :loading="enviando"
            :disabled="!podeEnviar"
            @click="enviar"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
