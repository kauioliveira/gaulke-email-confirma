<script setup lang="ts">
/**
 * Configurações de acesso (só admin).
 *
 * Hoje só a senha local de emergência. Desligá-la derruba também quem já está
 * dentro por ela — o servidor confere a configuração a cada requisição.
 */
const toast = useToast()
const { sessao } = usePapel()
const { data, refresh } = await useFetch<{ itens: ItemConfig[] }>(api('/api/admin/config'))

const senhaLocal = computed(() => data.value?.itens.find(i => i.chave === 'senha_local_habilitada'))
const salvando = ref(false)

// quem entrou pela senha não pode desligá-la (o servidor também recusa)
const entrouPelaSenha = computed(() => sessao.value?.origem === 'senha')

async function alternarSenhaLocal(valor: boolean) {
  salvando.value = true
  try {
    await $fetch(api('/api/admin/config'), {
      method: 'PUT',
      body: { chave: 'senha_local_habilitada', valor }
    })
    await refresh()
    toast.add({
      title: valor ? 'Acesso de emergência ligado' : 'Acesso de emergência desligado',
      description: valor
        ? 'A senha local volta a funcionar na tela de login.'
        : 'Só é possível entrar pelo painel. Quem estava dentro pela senha foi desconectado.',
      color: 'success'
    })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível alterar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-shield" class="size-5 text-primary" />
        <h2 class="font-semibold">Acesso</h2>
      </div>
    </template>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1 space-y-1">
        <p class="font-medium">Acesso de emergência por senha local</p>
        <p class="text-sm text-muted">
          Permite entrar com a senha do <code>.env</code> quando o painel estiver fora do ar.
          Esse acesso não identifica a pessoa, opera como administrador e fica registrado na
          auditoria como “Acesso por senha local”.
        </p>
        <p v-if="senhaLocal?.atualizadoPorNome" class="text-xs text-muted">
          Última alteração por {{ senhaLocal.atualizadoPorNome }} em {{ formatarDataHora(senhaLocal.atualizadoEm) }}
        </p>
        <p v-if="entrouPelaSenha" class="text-xs text-warning">
          Você entrou pela senha local: para desligá-la, entre pelo painel.
        </p>
      </div>
      <USwitch
        :model-value="senhaLocal?.valor === true"
        :loading="salvando"
        :disabled="salvando || !senhaLocal || (entrouPelaSenha && senhaLocal?.valor === true)"
        :label="senhaLocal?.valor === true ? 'Ligado' : 'Desligado'"
        @update:model-value="v => alternarSenhaLocal(Boolean(v))"
      />
    </div>
  </UCard>
</template>
