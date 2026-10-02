<script setup lang="ts">
/**
 * Origem "Empresa": busca o cliente (company, client e o histórico de
 * envios), preenche nome e CPF/CNPJ e sugere os e-mails que já receberam por
 * aquele documento — a tabela company não tem e-mail, então quem ensina é o
 * próprio uso (sys_mail_empresa_contatos). Dá para marcar vários e-mails da
 * mesma empresa e digitar um novo.
 */
const emit = defineEmits<{ adicionar: [linhas: { email: string; nome: string; empresa: string; documento: string }[]] }>()
const toast = useToast()

const busca = ref('')
const empresa = ref<EmpresaEncontrada | null>(null)
const marcados = ref<Set<string>>(new Set())
const novoEmail = ref('')
const novoNome = ref('')
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function escolher(e: EmpresaEncontrada) {
  empresa.value = e
  // o mais recente que ainda recebe ja vem marcado
  const primeiro = e.emails.find(x => !x.suprimido)
  marcados.value = new Set(primeiro ? [primeiro.email] : [])
  novoEmail.value = ''
  novoNome.value = ''
  if (!primeiro) nextTick(() => document.getElementById('origem-empresa-email')?.focus())
}
function alternar(email: string, v: boolean | 'indeterminate') {
  const s = new Set(marcados.value)
  if (v === true) s.add(email)
  else s.delete(email)
  marcados.value = s
}

const novoValido = computed(() => RE_EMAIL.test(novoEmail.value.trim()))
const total = computed(() => marcados.value.size + (novoValido.value ? 1 : 0))

function acrescentar() {
  const e = empresa.value
  if (!e) return
  const linhas = e.emails
    .filter(x => marcados.value.has(x.email))
    .map(x => ({ email: x.email, nome: x.nome ?? '', empresa: e.nome, documento: e.documento ?? '' }))
  if (novoValido.value) linhas.push({ email: novoEmail.value.trim().toLowerCase(), nome: novoNome.value.trim(), empresa: e.nome, documento: e.documento ?? '' })
  emit('adicionar', linhas)
  empresa.value = null
  busca.value = ''
  nextTick(() => document.querySelector<HTMLInputElement>('#origem-empresa-busca input')?.focus())
}

const esquecendo = ref<number | null>(null)
async function esquecer(c: ContatoEmpresa) {
  if (!empresa.value) return
  esquecendo.value = c.id
  try {
    await $fetch(api(`/api/admin/empresa-contatos/${c.id}`), { method: 'DELETE' })
    empresa.value = { ...empresa.value, emails: empresa.value.emails.filter(x => x.id !== c.id) }
    alternar(c.email, false)
    toast.add({ title: `${c.email} não será mais sugerido para esta empresa`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Não foi possível tirar a sugestão', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    esquecendo.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <UFormField
      label="Empresa ou pessoa"
      help="Busque pela razão social, fantasia, CNPJ/CPF ou por um e-mail já usado. O e-mail vem dos envios anteriores para o mesmo documento."
    >
      <BuscaEmpresa id="origem-empresa-busca" v-model="busca" mostrar-emails @escolher="escolher" />
    </UFormField>

    <div v-if="empresa" class="rounded-lg border border-default p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="font-medium">{{ empresa.nome }}</p>
          <p class="text-xs text-muted">
            {{ [empresa.fantasia, empresa.documento ? formatarDocumento(empresa.documento) : 'sem CPF/CNPJ', !empresa.ativo && 'inativo'].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Trocar empresa" @click="empresa = null" />
      </div>

      <div class="mt-3 space-y-2">
        <p class="text-xs font-semibold uppercase text-muted">E-mails conhecidos</p>
        <p v-if="!empresa.emails.length" class="text-sm text-muted">
          Nenhum envio anterior para este documento. Digite o e-mail abaixo — da próxima vez ele aparece aqui.
        </p>
        <div v-for="c in empresa.emails" :key="c.id" class="flex items-center gap-2 rounded-md border border-default px-3 py-2">
          <UCheckbox :model-value="marcados.has(c.email)" :disabled="c.suprimido" @update:model-value="v => alternar(c.email, v)" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm" :class="c.suprimido && 'text-muted line-through'">
              {{ c.email }}<span v-if="c.nome" class="text-muted"> · {{ c.nome }}</span>
            </p>
            <p class="text-xs text-muted">
              {{ c.usos }} envio(s) · último em {{ formatarData(c.ultimoUso) }}
              <UBadge v-if="c.suprimido" color="error" variant="subtle" size="xs" class="ml-1">devolveu — bloqueado</UBadge>
            </p>
          </div>
          <UTooltip text="Não sugerir mais para esta empresa">
            <UButton icon="i-lucide-eraser" size="xs" color="neutral" variant="ghost" :loading="esquecendo === c.id" aria-label="Esquecer este e-mail" @click="esquecer(c)" />
          </UTooltip>
        </div>
      </div>

      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <UInput id="origem-empresa-email" v-model="novoEmail" type="email" icon="i-lucide-at-sign" placeholder="Outro e-mail" class="w-full" @keydown.enter.prevent="total && acrescentar()" />
        <UInput v-model="novoNome" icon="i-lucide-user-round" placeholder="Nome do contato (opcional)" class="w-full" @keydown.enter.prevent="total && acrescentar()" />
      </div>
      <p v-if="novoEmail.trim() && !novoValido" class="mt-1 text-xs text-error">E-mail incompleto.</p>

      <UButton class="mt-3" icon="i-lucide-plus" :label="total > 1 ? `Acrescentar ${total} e-mails` : 'Acrescentar'" :disabled="!total" @click="acrescentar" />
    </div>
  </div>
</template>
