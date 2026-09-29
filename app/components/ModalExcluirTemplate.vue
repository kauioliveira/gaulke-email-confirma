<script setup lang="ts">
/**
 * Exclusão de template com confirmação dupla (item 7 do briefing).
 *
 *  1º passo: explica o que acontece (lotes já enviados não mudam).
 *  2º passo: a pessoa digita o nome do template — impede o clique distraído.
 *
 * Template já usado em envio só é excluído por supervisor/admin (o servidor
 * confere); para os demais o modal oferece ARQUIVAR, que some da lista sem
 * apagar nada.
 */
const props = defineProps<{ template: Template | null }>()
const aberto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ excluido: []; arquivado: [] }>()

const toast = useToast()
const { eSupervisor } = usePapel()
const etapa = ref<1 | 2>(1)
const digitado = ref('')
const trabalhando = ref(false)

watch(aberto, v => { if (v) { etapa.value = 1; digitado.value = '' } })

const usado = computed(() => (props.template?.usos ?? 0) > 0)
/** usado em envio e sem papel para excluir: a saída é arquivar */
const soArquivar = computed(() => usado.value && !eSupervisor.value)
const confere = computed(() => digitado.value.trim() === props.template?.nome.trim())

async function excluir() {
  if (!props.template) return
  trabalhando.value = true
  try {
    await $fetch(api(`/api/admin/templates/${props.template.id}`), { method: 'DELETE' })
    toast.add({ title: 'Template excluído', color: 'success' })
    aberto.value = false
    emit('excluido')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.statusMessage, color: 'error' })
  } finally {
    trabalhando.value = false
  }
}

async function arquivar() {
  if (!props.template) return
  trabalhando.value = true
  try {
    await $fetch(api(`/api/admin/templates/${props.template.id}/arquivar`), { method: 'POST', body: { arquivar: true } })
    toast.add({ title: 'Template arquivado', description: 'Ele sai da lista e do novo envio, mas não é apagado.', color: 'success' })
    aberto.value = false
    emit('arquivado')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível arquivar', description: e?.statusMessage, color: 'error' })
  } finally {
    trabalhando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="aberto" :title="soArquivar ? 'Arquivar template' : 'Excluir template'">
    <template #body>
      <div v-if="template" class="space-y-4">
        <p class="text-sm"><strong>{{ template.nome }}</strong></p>

        <template v-if="soArquivar">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            :description="`Este template já foi usado em ${template.usos} envio(s). Só supervisores e administradores podem excluí-lo. Você pode arquivá-lo: ele sai da lista e do novo envio, mas continua guardado.`"
          />
        </template>

        <template v-else-if="etapa === 1">
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            :description="usado
              ? `Ele foi usado em ${template.usos} envio(s). Os lotes já enviados NÃO mudam — eles guardam uma cópia do e-mail. O template e o histórico de versões dele serão apagados.`
              : 'Ele nunca foi usado em um envio. O template e o histórico de versões dele serão apagados.'"
          />
          <p class="text-sm text-muted">Se quiser só tirá-lo da lista, arquivar é mais seguro: dá para desfazer.</p>
        </template>

        <template v-else>
          <p class="text-sm">Para confirmar, digite o nome do template:</p>
          <UInput v-model="digitado" :placeholder="template.nome" class="w-full" autofocus />
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="aberto = false" />
        <UButton
          v-if="etapa === 1"
          label="Arquivar"
          icon="i-lucide-archive"
          color="neutral"
          variant="outline"
          :loading="trabalhando && soArquivar"
          @click="arquivar"
        />
        <UButton
          v-if="!soArquivar && etapa === 1"
          label="Continuar para excluir"
          icon="i-lucide-arrow-right"
          color="error"
          variant="soft"
          @click="etapa = 2"
        />
        <UButton
          v-if="!soArquivar && etapa === 2"
          label="Excluir definitivamente"
          icon="i-lucide-trash-2"
          color="error"
          :loading="trabalhando"
          :disabled="!confere"
          @click="excluir"
        />
      </div>
    </template>
  </UModal>
</template>
