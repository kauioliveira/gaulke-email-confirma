<script setup lang="ts">
/**
 * Campo de texto com sugestões dos clientes da Gaulke (company, client e o
 * histórico de envios). O texto continua livre: escolher uma sugestão só
 * preenche o resto. Com `mostrarEmails`, cada sugestão mostra quantos e-mails
 * já receberam por aquele documento.
 */
const props = withDefaults(defineProps<{ placeholder?: string; mostrarEmails?: boolean; icon?: string }>(), {
  placeholder: 'Razão social, fantasia ou CNPJ',
  icon: 'i-lucide-building-2'
})
const texto = defineModel<string>({ default: '' })
const emit = defineEmits<{ escolher: [EmpresaEncontrada] }>()

const sugestoes = ref<EmpresaEncontrada[]>([])
const aberto = ref(false)
const buscando = ref(false)
const destaque = ref(-1)
let atraso: ReturnType<typeof setTimeout> | undefined
let escolhendo = false

watch(texto, v => {
  if (escolhendo) {
    escolhendo = false
    return
  }
  clearTimeout(atraso)
  destaque.value = -1
  if (v.trim().length < 2) {
    sugestoes.value = []
    return
  }
  atraso = setTimeout(async () => {
    buscando.value = true
    try {
      sugestoes.value = await $fetch<EmpresaEncontrada[]>(api('/api/admin/empresas'), { query: { busca: v.trim() } })
      aberto.value = true
    } catch {
      sugestoes.value = []
    } finally {
      buscando.value = false
    }
  }, 300)
})

function escolher(e: EmpresaEncontrada) {
  escolhendo = true
  texto.value = e.nome
  aberto.value = false
  emit('escolher', e)
}
function fechar() {
  // o clique numa sugestão acontece antes do blur terminar
  setTimeout(() => (aberto.value = false), 150)
}
function teclado(ev: KeyboardEvent) {
  if (!aberto.value || !sugestoes.value.length) return
  if (ev.key === 'ArrowDown') destaque.value = (destaque.value + 1) % sugestoes.value.length
  else if (ev.key === 'ArrowUp') destaque.value = (destaque.value - 1 + sugestoes.value.length) % sugestoes.value.length
  else if (ev.key === 'Enter' && destaque.value >= 0) escolher(sugestoes.value[destaque.value]!)
  else if (ev.key === 'Escape') aberto.value = false
  else return
  ev.preventDefault()
}

function detalhe(e: EmpresaEncontrada) {
  const partes = [e.fantasia, e.documento && formatarDocumento(e.documento), !e.ativo && 'inativo']
  if (props.mostrarEmails) {
    const n = e.emails.filter(x => !x.suprimido).length
    partes.push(n ? `${n} e-mail${n > 1 ? 's' : ''} conhecido${n > 1 ? 's' : ''}` : 'sem e-mail conhecido')
  }
  if (e.origem === 'historico') partes.push('de envios anteriores')
  return partes.filter(Boolean).join(' · ') || (e.tipo === 'empresa' ? 'empresa' : 'pessoa física')
}
</script>

<template>
  <div class="relative">
    <UInput
      v-model="texto"
      :icon="icon"
      :loading="buscando"
      :placeholder="placeholder"
      autocomplete="off"
      class="w-full"
      @focus="aberto = sugestoes.length > 0"
      @blur="fechar"
      @keydown="teclado"
    />
    <ul
      v-if="aberto && sugestoes.length"
      class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-default bg-default py-1 shadow-lg"
    >
      <li v-for="(e, i) in sugestoes" :key="i">
        <button
          type="button"
          class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-elevated"
          :class="{ 'bg-elevated': i === destaque }"
          @mousedown.prevent="escolher(e)"
        >
          <UIcon
            :name="e.origem === 'historico' ? 'i-lucide-history' : e.tipo === 'empresa' ? 'i-lucide-building-2' : 'i-lucide-user-round'"
            class="mt-0.5 size-4 shrink-0 text-muted"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm" :class="!e.ativo && 'text-muted line-through'">{{ e.nome }}</span>
            <span class="block truncate text-xs text-muted">{{ detalhe(e) }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
