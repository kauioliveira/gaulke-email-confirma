<script setup lang="ts">
/**
 * Exclusão de lote, com as duas regras (decisão D2):
 *  - nunca disparado: sai de vez (nada a perder);
 *  - já disparado: vai para a LIXEIRA, com motivo obrigatório — os eventos são
 *    a prova de entrega e ficam guardados; o admin pode restaurar.
 * A permissão é conferida no servidor; aqui só adaptamos o texto.
 */
type LoteExcluivel = Pick<Lote, 'id' | 'nome' | 'total' | 'enviados' | 'falhas' | 'startedAt'>

const props = defineProps<{ lote: LoteExcluivel | null }>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ excluido: [lixeira: boolean] }>()

const toast = useToast()
const motivo = ref('')
const excluindo = ref(false)

const jaEnviou = computed(
  () => !!props.lote && (props.lote.enviados > 0 || props.lote.falhas > 0 || !!props.lote.startedAt)
)

watch(aberto, v => { if (v) motivo.value = '' })

async function confirmar() {
  if (!props.lote) return
  excluindo.value = true
  try {
    const r = await $fetch<{ lixeira: boolean }>(api(`/api/admin/batches/${props.lote.id}`), {
      method: 'DELETE',
      body: jaEnviou.value ? { motivo: motivo.value } : undefined
    })
    toast.add({
      title: r.lixeira ? 'Lote enviado para a lixeira' : 'Lote excluído',
      description: r.lixeira ? 'Os registros de entrega foram preservados. Um administrador pode restaurá-lo.' : undefined,
      color: 'success'
    })
    aberto.value = false
    emit('excluido', r.lixeira)
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.statusMessage, color: 'error' })
  } finally {
    excluindo.value = false
  }
}
</script>

<template>
  <UModal v-model:open="aberto" :title="jaEnviou ? 'Mandar lote para a lixeira' : 'Excluir lote'">
    <template #body>
      <div v-if="lote" class="space-y-4">
        <p class="text-sm">
          <strong>{{ lote.nome }}</strong> · {{ lote.total }} destinatário(s)
          <template v-if="jaEnviou"> · {{ lote.enviados }} já enviado(s)</template>
        </p>

        <template v-if="jaEnviou">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-archive-x"
            description="O lote some das telas e dos relatórios, e os links dos destinatários deixam de abrir. Os registros de entrega, leitura e download continuam guardados — um administrador pode restaurá-lo pela Lixeira."
          />
          <UFormField label="Motivo" required help="Fica registrado na auditoria e na lixeira.">
            <UTextarea v-model="motivo" :rows="2" autofocus class="w-full" placeholder="Ex.: lote criado em duplicidade" />
          </UFormField>
        </template>
        <UAlert
          v-else
          color="neutral"
          variant="subtle"
          icon="i-lucide-trash-2"
          description="Este lote nunca foi disparado: ele e a lista de destinatários serão apagados de vez."
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="aberto = false" />
        <UButton
          :label="jaEnviou ? 'Mandar para a lixeira' : 'Excluir'"
          icon="i-lucide-trash-2"
          color="error"
          :loading="excluindo"
          :disabled="jaEnviou && motivo.trim().length < 3"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
