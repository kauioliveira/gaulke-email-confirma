<script setup lang="ts">
import { dataHora } from '~/utils/formato'
import { formatarDocumento } from '~~/shared/utils/documento'

/**
 * Contatos das empresas: qual e-mail recebe por CPF/CNPJ. O cadastro aprende
 * sozinho com cada envio e aceita importação de planilha — é dele que o lote
 * "arquivos por cliente" tira o e-mail de cada CNPJ.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Contatos das empresas — Gaulke Comunica' })

const toast = useToast()
const confirmar = useConfirmar()

type Contato = {
  id: number
  documento: string
  email: string
  nome: string | null
  empresa: string | null
  origem: string
  usos: number
  ultimoUso: string
  suprimido: boolean
}

const termo = ref('')
const busca = ref('')
let atraso: ReturnType<typeof setTimeout> | undefined
watch(termo, v => {
  clearTimeout(atraso)
  atraso = setTimeout(() => {
    busca.value = v.trim()
    pagina.value = 1
  }, 300)
})
const pagina = ref(1)

const { data, status, refresh } = await useFetch<{ total: number; pagina: number; porPagina: number; contatos: Contato[] }>(
  api('/api/admin/empresa-contatos'),
  { query: computed(() => ({ busca: busca.value, pagina: pagina.value })), server: false }
)

const importando = ref(false)

const ORIGEM: Record<string, string> = {
  historico: 'Histórico',
  lote: 'Envio',
  solicitacao: 'Solicitação',
  importacao: 'Importação'
}

async function esquecer(c: Contato) {
  const ok = await confirmar({
    titulo: `Excluir ${c.email}?`,
    descricao: `Sai dos contatos de ${formatarDocumento(c.documento)} e não aparece mais nos próximos envios.`,
    sim: 'Excluir',
    cor: 'error',
    icone: 'i-lucide-trash-2'
  })
  if (!ok) return
  try {
    await $fetch(api(`/api/admin/empresa-contatos/${c.id}`), { method: 'DELETE' })
    toast.add({ title: 'Contato removido', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível remover', description: e?.data?.statusMessage, color: 'error' })
  }
}

async function aposImportar() {
  importando.value = false
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Contatos das empresas</h1>
        <p class="text-sm text-muted">
          O e-mail que recebe por cada CPF/CNPJ. Aprende com os envios e aceita planilha — é daqui que o envio de
          arquivos por cliente tira os destinatários.
        </p>
      </div>
      <UButton label="Importar planilha" icon="i-lucide-file-spreadsheet" @click="importando = true" />
    </div>

    <UCard>
      <div class="space-y-4">
        <UInput
          v-model="termo"
          icon="i-lucide-search"
          placeholder="Buscar por CNPJ, e-mail, nome ou empresa"
          class="w-full"
          :loading="status === 'pending'"
        />

        <p v-if="data" class="text-xs text-muted">{{ data.total }} contato(s)</p>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase text-muted">
              <tr class="border-b border-default">
                <th class="py-2 pr-3">CPF/CNPJ</th>
                <th class="py-2 pr-3">Empresa / contato</th>
                <th class="py-2 pr-3">E-mail</th>
                <th class="py-2 pr-3">Origem</th>
                <th class="py-2 pr-3">Último uso</th>
                <th class="py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in data?.contatos ?? []" :key="c.id" class="border-b border-default/60">
                <td class="py-2 pr-3 font-mono text-xs">{{ formatarDocumento(c.documento) }}</td>
                <td class="py-2 pr-3">
                  <p class="font-medium">{{ c.empresa || '—' }}</p>
                  <p v-if="c.nome" class="text-xs text-muted">{{ c.nome }}</p>
                </td>
                <td class="py-2 pr-3">
                  {{ c.email }}
                  <UBadge v-if="c.suprimido" label="devolve" color="error" variant="subtle" size="sm" class="ml-1" />
                </td>
                <td class="py-2 pr-3 text-xs text-muted">{{ ORIGEM[c.origem] ?? c.origem }} · {{ c.usos }}x</td>
                <td class="py-2 pr-3 text-xs text-muted">{{ dataHora(c.ultimoUso) }}</td>
                <td class="py-2 text-right">
                  <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" aria-label="Remover contato" @click="esquecer(c)" />
                </td>
              </tr>
              <tr v-if="data && !data.contatos.length">
                <td colspan="6" class="py-8 text-center text-muted">Nenhum contato encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="data && data.total > data.porPagina" class="flex justify-end">
          <UPagination v-model:page="pagina" :total="data.total" :items-per-page="data.porPagina" />
        </div>
      </div>
    </UCard>

    <UModal v-model:open="importando" title="Importar e-mails por CPF/CNPJ" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <ImportarContatos @importado="aposImportar" />
      </template>
    </UModal>
  </div>
</template>
