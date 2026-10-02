<script setup lang="ts">
import { LIMITES_ITEM, OPCOES_SIM_NAO } from '~~/shared/utils/itens-solic'

/**
 * Alternativas de um item de escolha: uma por linha, reordenáveis. "Colar
 * lista" aceita uma alternativa por linha (copiada do Excel ou do Word).
 */
const opcoes = defineModel<string[]>({ required: true })

const max = LIMITES_ITEM.opcoes.max
const colando = ref(false)
const texto = ref('')

function alterar(i: number, v: string) {
  opcoes.value = opcoes.value.map((o, n) => (n === i ? v : o))
}
function adicionar() {
  if (opcoes.value.length >= max) return
  opcoes.value = [...opcoes.value, '']
  const n = opcoes.value.length - 1
  nextTick(() => document.getElementById(`opcao-${uid}-${n}`)?.focus())
}
function remover(i: number) {
  opcoes.value = opcoes.value.filter((_, n) => n !== i)
}
function mover(i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= opcoes.value.length) return
  const c = [...opcoes.value]
  ;[c[i], c[j]] = [c[j]!, c[i]!]
  opcoes.value = c
}
function aplicarColado() {
  const novas = texto.value
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  const atuais = opcoes.value.filter(o => o.trim())
  opcoes.value = [...new Set([...atuais, ...novas])].slice(0, max)
  texto.value = ''
  colando.value = false
}

const uid = useId()
// Enter na ultima alternativa cria a proxima
function enter(i: number) {
  if (i === opcoes.value.length - 1) adicionar()
  else document.getElementById(`opcao-${uid}-${i + 1}`)?.focus()
}
</script>

<template>
  <div class="space-y-1.5">
    <div v-for="(o, i) in opcoes" :key="i" class="flex items-center gap-1.5">
      <span class="w-5 shrink-0 text-center text-xs tabular-nums text-muted">{{ String.fromCharCode(97 + (i % 26)) }})</span>
      <UInput
        :id="`opcao-${uid}-${i}`"
        :model-value="o"
        :maxlength="LIMITES_ITEM.opcoes.tamanho"
        placeholder="Alternativa"
        size="sm"
        class="min-w-0 flex-1"
        @update:model-value="v => alterar(i, String(v))"
        @keydown.enter.prevent="enter(i)"
      />
      <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" :disabled="i === 0" aria-label="Subir" @click="mover(i, -1)" />
      <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" :disabled="i === opcoes.length - 1" aria-label="Descer" @click="mover(i, 1)" />
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Remover alternativa" @click="remover(i)" />
    </div>

    <div v-if="colando" class="space-y-1.5">
      <UTextarea v-model="texto" :rows="4" autoresize placeholder="Uma alternativa por linha" class="w-full" />
      <div class="flex gap-2">
        <UButton label="Incluir" size="xs" :disabled="!texto.trim()" @click="aplicarColado" />
        <UButton label="Cancelar" size="xs" color="neutral" variant="ghost" @click="colando = false" />
      </div>
    </div>

    <div v-else class="flex flex-wrap gap-2 pt-0.5">
      <UButton label="Alternativa" icon="i-lucide-plus" size="xs" color="neutral" variant="outline" :disabled="opcoes.length >= max" @click="adicionar" />
      <UButton label="Colar lista" icon="i-lucide-clipboard-paste" size="xs" color="neutral" variant="ghost" @click="colando = true" />
      <UButton label="Sim / Não" size="xs" color="neutral" variant="ghost" @click="opcoes = [...OPCOES_SIM_NAO]" />
    </div>
  </div>
</template>
