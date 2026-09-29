<script setup lang="ts">
/**
 * Servidor SMTP padrão (só admin).
 *
 * O servidor costuma ser o mesmo para todas as caixas; só usuário e senha
 * mudam. Definido aqui uma vez, todo canal novo já nasce com ele e pede só
 * usuário, senha e remetente. Canais existentes não mudam.
 */
const emit = defineEmits<{ salvo: [] }>()
const toast = useToast()
const { data, refresh } = await useFetch<{ itens: ItemConfig[] }>(api('/api/admin/config'))

type Servidor = { host: string; port: number; secure: boolean; requireTls: boolean; rejectUnauthorized: boolean }
const atual = computed(() => data.value?.itens.find(i => i.chave === 'smtp_servidor_padrao'))
const form = reactive<Servidor>({ host: '', port: 587, secure: false, requireTls: true, rejectUnauthorized: true })
const editando = ref(false)
const salvando = ref(false)

watchEffect(() => {
  const v = atual.value?.valor as Servidor | null | undefined
  if (v && !editando.value) Object.assign(form, v)
})

async function salvar() {
  salvando.value = true
  try {
    await $fetch(api('/api/admin/config'), {
      method: 'PUT',
      body: { chave: 'smtp_servidor_padrao', valor: { ...form, port: Number(form.port) } }
    })
    toast.add({ title: 'Servidor padrão salvo', description: 'Vale para os canais cadastrados daqui em diante.', color: 'success' })
    editando.value = false
    await refresh()
    emit('salvo')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-server" class="size-5 text-primary" />
          <h2 class="font-semibold">Servidor SMTP padrão</h2>
        </div>
        <UButton
          v-if="!editando"
          :label="atual?.valor ? 'Alterar' : 'Definir'"
          icon="i-lucide-pencil"
          size="xs"
          color="neutral"
          variant="outline"
          @click="editando = true"
        />
      </div>
    </template>

    <div v-if="!editando" class="text-sm">
      <p v-if="atual?.valor">
        <span class="font-mono">{{ form.host }}:{{ form.port }}</span>
        <span class="text-muted">
          · {{ form.secure ? 'SSL direto' : form.requireTls ? 'STARTTLS' : 'sem TLS' }}
          · {{ form.rejectUnauthorized ? 'certificado validado' : 'certificado não validado' }}
        </span>
      </p>
      <p v-else class="text-muted">Não definido: canais novos partem do SMTP do <code>.env</code>.</p>
      <p class="mt-1 text-xs text-muted">
        Todo canal novo já nasce com este servidor e só pede usuário, senha e remetente.
        <template v-if="atual?.atualizadoPorNome">
          Última alteração por {{ atual.atualizadoPorNome }} em {{ formatarDataHora(atual.atualizadoEm) }}.
        </template>
      </p>
    </div>

    <div v-else class="space-y-3">
      <div class="grid gap-4 sm:grid-cols-3">
        <UFormField label="Servidor SMTP" required class="sm:col-span-2">
          <UInput v-model="form.host" class="w-full" placeholder="mail.contabilgaulke.com.br" />
        </UFormField>
        <UFormField label="Porta" required>
          <UInput v-model.number="form.port" type="number" class="w-full" />
        </UFormField>
      </div>
      <UCheckbox v-model="form.secure" label="Conexão SSL direta (porta 465)" />
      <UCheckbox v-model="form.requireTls" label="Exigir STARTTLS (porta 587)" />
      <UCheckbox v-model="form.rejectUnauthorized" label="Validar o certificado do servidor" />
      <div class="flex justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="editando = false; refresh()" />
        <UButton label="Salvar" icon="i-lucide-save" :loading="salvando" :disabled="!form.host || !form.port" @click="salvar" />
      </div>
    </div>
  </UCard>
</template>
