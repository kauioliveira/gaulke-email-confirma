<script setup lang="ts">
/**
 * Integração com o painel (só admin): URL e token de API usados para abrir
 * chamados quando um cliente responde ou não confirma a leitura.
 *
 * O token é gerado no painel, em Configurações → Tokens de API, por um
 * usuário administrador (ou com o scope integracao:comunica). Ele é guardado
 * CIFRADO e nunca volta para a tela.
 */
const toast = useToast()
const { data, refresh } = await useFetch<{ itens: ItemConfig[] }>(api('/api/admin/config'))
const { data: status } = await useFetch<RespostaStatus>(api('/api/admin/status'), { lazy: true, server: false })

type Valor = { url: string; temToken: boolean } | null
const atual = computed(() => data.value?.itens.find(i => i.chave === 'painel_integracao'))
const valor = computed(() => atual.value?.valor as Valor)

const editando = ref(false)
const form = reactive({ url: '', token: '' })
const salvando = ref(false)
const testando = ref(false)
const teste = ref<{ ok: boolean; mensagem: string } | null>(null)

function editar() {
  form.url = valor.value?.url || useRuntimeConfig().public.painelUrl || ''
  form.token = ''
  teste.value = null
  editando.value = true
}

async function testar() {
  testando.value = true
  try {
    teste.value = await $fetch(api('/api/admin/config/painel-testar'), {
      method: 'POST',
      body: editando.value ? { url: form.url || undefined, token: form.token || undefined } : {}
    })
  } catch (e: any) {
    teste.value = { ok: false, mensagem: e?.statusMessage || 'Falha ao testar' }
  } finally {
    testando.value = false
  }
}

async function salvar() {
  salvando.value = true
  try {
    await $fetch(api('/api/admin/config'), {
      method: 'PUT',
      body: { chave: 'painel_integracao', valor: { url: form.url, token: form.token || undefined } }
    })
    toast.add({ title: 'Integração com o painel salva', color: 'success' })
    editando.value = false
    await refresh()
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
          <UIcon name="i-lucide-ticket" class="size-5 text-primary" />
          <h2 class="font-semibold">Integração com o painel (chamados)</h2>
        </div>
        <div v-if="!editando" class="flex gap-2">
          <UButton v-if="valor" label="Testar" icon="i-lucide-plug-zap" size="xs" color="neutral" variant="outline" :loading="testando" @click="testar" />
          <UButton :label="valor ? 'Alterar' : 'Configurar'" icon="i-lucide-pencil" size="xs" color="neutral" variant="outline" @click="editar" />
        </div>
      </div>
    </template>

    <div v-if="!editando" class="space-y-2 text-sm">
      <p v-if="valor">
        <span class="font-mono">{{ valor.url }}</span>
        <span class="text-muted"> · token {{ valor.temToken ? 'cadastrado' : 'ausente' }}</span>
      </p>
      <p v-else class="text-muted">
        Não configurada. Sem ela, os chamados ficam na fila do Gaulke Comunica esperando.
      </p>
      <p v-if="status?.chamados && (status.chamados.pendentes || status.chamados.erros)" class="text-xs">
        <span v-if="status.chamados.pendentes" class="text-warning">{{ status.chamados.pendentes }} chamado(s) na fila</span>
        <span v-if="status.chamados.pendentes && status.chamados.erros"> · </span>
        <span v-if="status.chamados.erros" class="text-error">{{ status.chamados.erros }} com erro</span>
      </p>
      <p v-if="teste" class="text-xs" :class="teste.ok ? 'text-success' : 'text-error'">{{ teste.mensagem }}</p>
      <p v-if="atual?.atualizadoPorNome" class="text-xs text-muted">
        Última alteração por {{ atual.atualizadoPorNome }} em {{ formatarDataHora(atual.atualizadoEm) }}.
      </p>
    </div>

    <div v-else class="space-y-3">
      <UFormField label="Endereço do painel" required>
        <UInput v-model="form.url" placeholder="https://painel.contabilgaulke.com.br" class="w-full" />
      </UFormField>
      <UFormField
        label="Token de API"
        :required="!valor?.temToken"
        :help="valor?.temToken ? 'Deixe em branco para manter o token atual.' : 'Gerado no painel em Configurações → Tokens de API (gk_…).'"
      >
        <UInput v-model="form.token" type="password" autocomplete="off" placeholder="gk_…" class="w-full" />
      </UFormField>
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        description="O dono do token precisa ser administrador do painel ou ter o scope integracao:comunica, e a regra “Tokens de API” precisa estar ligada em Configurações do Sistema → Regras."
      />
      <p v-if="teste" class="text-xs" :class="teste.ok ? 'text-success' : 'text-error'">{{ teste.mensagem }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="editando = false" />
        <UButton label="Testar" icon="i-lucide-plug-zap" color="neutral" variant="outline" :loading="testando" :disabled="!form.url" @click="testar" />
        <UButton label="Salvar" icon="i-lucide-save" :loading="salvando" :disabled="!form.url || (!form.token && !valor?.temToken)" @click="salvar" />
      </div>
    </div>
  </UCard>
</template>
