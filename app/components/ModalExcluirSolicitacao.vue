<script setup lang="ts">
/**
 * Exclusão DEFINITIVA de uma solicitação, com confirmação dupla (como a do
 * template):
 *  1º passo: explica o que some e oferece cancelar, que é reversível;
 *  2º passo: a pessoa digita o código da solicitação.
 * Com entrega do cliente, só supervisor/admin — o servidor confere.
 */
const props = defineProps<{ solicitacao: ResumoSolicitacao | DetalheSolicitacao | null }>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ excluida: []; cancelar: [] }>()

const toast = useToast()
const { pode } = usePapel()
const etapa = ref<1 | 2>(1)
const digitado = ref('')
const excluindo = ref(false)

// vindo da lista (resumo, sem itens): busca o detalhe para contar o que o cliente entregou
const detalhe = ref<DetalheSolicitacao | null>(null)
const carregando = ref(false)
watch(aberto, async v => {
  if (!v) return
  etapa.value = 1
  digitado.value = ''
  const s = props.solicitacao
  if (!s) return
  if ('itens' in s) {
    detalhe.value = s
    return
  }
  detalhe.value = null
  carregando.value = true
  try {
    detalhe.value = await $fetch<DetalheSolicitacao>(api(`/api/admin/solicitacoes/${s.id}`))
  } catch {
    detalhe.value = null
  } finally {
    carregando.value = false
  }
})

const arquivos = computed(() => detalhe.value?.itens.reduce((n, i) => n + i.arquivos.filter(a => !a.removidoEm).length, 0) ?? 0)
const respostas = computed(() => detalhe.value?.itens.filter(i => i.resposta).length ?? 0)
const clienteEntregou = computed(() => arquivos.value > 0 || respostas.value > 0)
/** com entrega do cliente, so supervisor/admin */
const bloqueado = computed(() => clienteEntregou.value && !pode('supervisor'))
const confere = computed(() => digitado.value.trim().toUpperCase() === props.solicitacao?.codigo.toUpperCase())

async function excluir() {
  if (!props.solicitacao) return
  excluindo.value = true
  try {
    const r = await $fetch<{ avisos: number }>(api(`/api/admin/solicitacoes/${props.solicitacao.id}`), {
      method: 'DELETE',
      body: { confirmacao: digitado.value }
    })
    toast.add({
      title: 'Solicitação excluída',
      description: r.avisos ? 'Alguns arquivos não puderam ser apagados do disco; o detalhe ficou no log do servidor.' : undefined,
      color: r.avisos ? 'warning' : 'success'
    })
    aberto.value = false
    emit('excluida')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    excluindo.value = false
  }
}
</script>

<template>
  <UModal v-model:open="aberto" title="Excluir solicitação definitivamente">
    <template #body>
      <div v-if="solicitacao" class="space-y-4">
        <p class="text-sm">
          <strong class="font-mono">{{ solicitacao.codigo }}</strong> · {{ solicitacao.titulo }}<br />
          <span class="text-muted">{{ solicitacao.destinatarioNome || solicitacao.destinatarioEmail }}{{ solicitacao.empresa ? ` · ${solicitacao.empresa}` : '' }}</span>
        </p>

        <p v-if="carregando" class="text-sm text-muted">Conferindo o que o cliente já entregou…</p>

        <UAlert
          v-else-if="bloqueado"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :description="`O cliente já enviou ${arquivos} arquivo(s) e ${respostas} resposta(s). Só supervisores e administradores podem excluir. Você pode cancelar a solicitação: o link para de funcionar e nada é apagado.`"
        />

        <template v-else-if="etapa === 1">
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-trash-2"
            :description="
              clienteEntregou
                ? `Serão apagados de vez: a solicitação, o histórico, ${respostas} resposta(s) e ${arquivos} arquivo(s) enviados pelo cliente, inclusive da pasta no servidor. Não há lixeira nem como desfazer.`
                : 'Serão apagados de vez: a solicitação, os itens e o histórico. O cliente ainda não entregou nada. Não há lixeira nem como desfazer.'
            "
          />
          <p v-if="solicitacao.status !== 'cancelada'" class="text-sm text-muted">
            Se a ideia é só encerrar, <strong>cancelar</strong> é mais seguro: o link do cliente para de funcionar e tudo fica guardado.
          </p>
        </template>

        <template v-else>
          <p class="text-sm">Para confirmar, digite o código <strong class="font-mono">{{ solicitacao.codigo }}</strong>:</p>
          <UInput v-model="digitado" :placeholder="solicitacao.codigo" class="w-full font-mono" autofocus @keydown.enter.prevent="confere && excluir()" />
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton label="Voltar" color="neutral" variant="ghost" @click="aberto = false" />
        <UButton
          v-if="etapa === 1 && solicitacao?.status !== 'cancelada'"
          label="Cancelar a solicitação"
          icon="i-lucide-ban"
          color="neutral"
          variant="outline"
          @click="aberto = false; emit('cancelar')"
        />
        <UButton v-if="!bloqueado && !carregando && etapa === 1" label="Continuar para excluir" icon="i-lucide-arrow-right" color="error" variant="soft" @click="etapa = 2" />
        <UButton
          v-if="!bloqueado && etapa === 2"
          label="Excluir definitivamente"
          icon="i-lucide-trash-2"
          color="error"
          :loading="excluindo"
          :disabled="!confere"
          @click="excluir"
        />
      </div>
    </template>
  </UModal>
</template>
