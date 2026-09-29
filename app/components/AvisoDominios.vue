<script setup lang="ts">
/**
 * Avisa, ANTES do envio, quando o domínio de algum destinatário não recebe
 * e-mail ou parece digitado errado ("contabilgualke" em vez de
 * "contabilgaulke"). O servidor SMTP aceitaria a mensagem de qualquer jeito, e
 * o erro só apareceria horas depois como devolução.
 *
 * Oferece corrigir (troca o domínio em todos os e-mails afetados) ou remover.
 */
const props = withDefaults(defineProps<{ emails: string[]; compacto?: boolean; semAcoes?: boolean }>(), {
  compacto: false,
  semAcoes: false
})
const emit = defineEmits<{
  corrigir: [de: string, para: string]
  remover: [emails: string[]]
  problemas: [n: number]
}>()

const problemas = ref<ProblemaDominio[]>([])
/** endereços que já devolveram definitivamente (lista de supressão) */
const suprimidos = ref<{ email: string; motivo: string | null }[]>([])
const verificando = ref(false)
let espera: ReturnType<typeof setTimeout> | undefined
let ultima = ''

async function verificar() {
  const unicos = [...new Set(props.emails.map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))]
  const chave = unicos.join(',')
  if (chave === ultima) return
  ultima = chave
  if (!unicos.length) { problemas.value = []; suprimidos.value = []; emit('problemas', 0); return }
  verificando.value = true
  try {
    const r = await $fetch<{ problemas: ProblemaDominio[]; suprimidos: { email: string; motivo: string | null }[] }>(
      api('/api/admin/destinatarios/verificar-dominios'),
      { method: 'POST', body: { emails: unicos } }
    )
    problemas.value = r.problemas
    suprimidos.value = r.suprimidos ?? []
    emit('problemas', r.problemas.filter(p => p.recebe === false).length + suprimidos.value.length)
  } catch {
    // verificação é ajuda, não trava: sem ela, o envio segue como antes
    problemas.value = []
  } finally {
    verificando.value = false
  }
}

watch(
  () => props.emails,
  () => { clearTimeout(espera); espera = setTimeout(verificar, 500) },
  { immediate: true, deep: true }
)

function amostra(p: ProblemaDominio) {
  const lista = p.emails.slice(0, 3).join(', ')
  return p.emails.length > 3 ? `${lista} e mais ${p.emails.length - 3}` : lista
}
</script>

<template>
  <div v-if="problemas.length || suprimidos.length" class="space-y-2">
    <UAlert
      v-if="suprimidos.length"
      color="error"
      variant="subtle"
      icon="i-lucide-ban"
      :title="suprimidos.length === 1
        ? `${suprimidos[0]!.email} já devolveu antes`
        : `${suprimidos.length} endereços já devolveram antes`"
      :description="`Eles estão na lista de supressão (endereço ou domínio inexistente) e não recebem o envio.${suprimidos.length === 1 && suprimidos[0]!.motivo ? ` Motivo: ${suprimidos[0]!.motivo}.` : ''}${suprimidos.length > 1 && !compacto ? ` ${suprimidos.slice(0, 3).map(s => s.email).join(', ')}${suprimidos.length > 3 ? '…' : ''}` : ''}`"
      :actions="semAcoes || compacto ? [] : [{ label: 'Remover da lista', color: 'neutral', variant: 'ghost', onClick: () => emit('remover', suprimidos.map(s => s.email)) }]"
    />
    <UAlert
      v-for="p in problemas"
      :key="p.dominio"
      :color="p.recebe === false ? 'error' : 'warning'"
      variant="subtle"
      :icon="p.recebe === false ? 'i-lucide-mail-x' : 'i-lucide-spell-check'"
      :title="p.recebe === false
        ? `O domínio ${p.dominio} não recebe e-mail`
        : `${p.dominio} parece digitado errado`"
      :description="`${p.sugestao ? `Você quis dizer ${p.sugestao}? ` : ''}${compacto ? '' : `Afeta: ${amostra(p)}.`}`"
      :actions="semAcoes ? [] : [
        ...(p.sugestao ? [{ label: `Corrigir para ${p.sugestao}`, icon: 'i-lucide-wand-sparkles', onClick: () => emit('corrigir', p.dominio, p.sugestao!) }] : []),
        ...(!compacto ? [{ label: `Remover ${p.emails.length > 1 ? `os ${p.emails.length}` : ''} da lista`, color: 'neutral' as const, variant: 'ghost' as const, onClick: () => emit('remover', p.emails) }] : [])
      ]"
    />
  </div>
  <p v-else-if="verificando && !compacto" class="text-xs text-muted">Verificando os domínios dos destinatários…</p>
</template>
