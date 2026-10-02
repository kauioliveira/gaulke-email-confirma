<script setup lang="ts">
/**
 * Configurações de acesso (só admin).
 *
 * O acesso de emergência pela senha local é decidido POR AMBIENTE, no .env
 * (ACESSO_EMERGENCIA): ligado no desenvolvimento, desligado em produção. A
 * tela só mostra o estado — mudar é trocar o .env e reiniciar.
 */
const { sessao } = usePapel()
const ligado = computed(() => sessao.value?.senhaLocal === true)
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
        <p class="text-sm text-muted">
          Definido por ambiente na variável <code>ACESSO_EMERGENCIA</code> do <code>.env</code>
          (<code>true</code> no desenvolvimento, <code>false</code> em produção). Para mudar, altere o arquivo e reinicie o sistema.
        </p>
      </div>
      <UBadge
        :color="ligado ? 'warning' : 'success'"
        variant="subtle"
        size="lg"
        :icon="ligado ? 'i-lucide-key-round' : 'i-lucide-lock'"
        :label="ligado ? 'Ligado neste ambiente' : 'Desligado neste ambiente'"
      />
    </div>
  </UCard>
</template>
