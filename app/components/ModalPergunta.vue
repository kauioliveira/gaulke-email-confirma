<script setup lang="ts">
/**
 * Pergunta de sim/não no lugar do confirm() do navegador. Aberto por código
 * pelo useConfirmar() (useOverlay do Nuxt UI): fecha com true no "Sim" e
 * false no "Não", no Esc ou clicando fora.
 */
withDefaults(
  defineProps<{
    titulo: string
    descricao?: string
    sim?: string
    nao?: string
    /** error = ação destrutiva (botão vermelho) */
    cor?: 'primary' | 'error' | 'warning'
    icone?: string
  }>(),
  { sim: 'Sim', nao: 'Não', cor: 'primary', icone: 'i-lucide-circle-help' }
)
const emit = defineEmits<{ close: [ok: boolean] }>()
</script>

<template>
  <UModal :close="false" :ui="{ content: 'sm:max-w-md' }" @update:open="aberto => !aberto && emit('close', false)">
    <template #content>
      <div class="flex gap-4 p-5">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-full"
          :class="cor === 'error' ? 'bg-error/10 text-error' : cor === 'warning' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'"
        >
          <UIcon :name="icone" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ titulo }}</p>
          <p v-if="descricao" class="mt-1 text-sm text-muted">{{ descricao }}</p>
          <div class="mt-5 flex justify-end gap-2">
            <UButton :label="nao" color="neutral" variant="outline" @click="emit('close', false)" />
            <UButton :label="sim" :color="cor" autofocus @click="emit('close', true)" />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
