<script setup lang="ts">
import { TIPOS_ANEXO, acceptDe, familiasDe } from '~~/shared/types/tipos-arquivo'
import type { ResultadoCasamento } from '~~/shared/utils/casamento'

/**
 * Anexo INDIVIDUAL: cada destinatário recebe o SEU arquivo (guia DAS,
 * holerite, informe).
 *
 * A pessoa sobe vários arquivos (ou um ZIP) e o sistema casa cada um com o
 * destinatário pelo nome do arquivo — CPF/CNPJ, depois e-mail, depois nome ou
 * empresa idêntico (shared/utils/casamento.ts). O que não casar ela liga à mão.
 *
 * O upload vai em PACOTES de até ~24 MB: o proxy do servidor recusa
 * requisições acima de 30 MB, e um upload único de centenas de arquivos
 * esbarraria nisso.
 */
type Aceito = { nome: string; original: string; tamanho: number; tipo: string }
type Dest = { email: string; nome?: string; empresa?: string; documento?: string }

const props = defineProps<{ destinatarios: Dest[]; casamento: ResultadoCasamento }>()
const arquivos = defineModel<Aceito[]>('arquivos', { required: true })
const manuais = defineModel<Record<string, string>>('manuais', { required: true })
const enviarSemArquivo = defineModel<boolean>('enviarSemArquivo', { required: true })

const toast = useToast()
const ACCEPT = `${acceptDe(TIPOS_ANEXO)},.zip`
const FORMATOS = familiasDe(TIPOS_ANEXO)
const PACOTE_MAX = 24 * 1024 * 1024

const enviando = ref(false)
const progresso = ref('')
const recusados = ref<{ original: string; motivo: string }[]>([])

async function subir(e: Event) {
  const input = e.target as HTMLInputElement
  const lista = [...(input.files ?? [])]
  input.value = ''
  if (!lista.length) return

  // ZIP maior que o pacote não passa pelo proxy: melhor avisar que tentar
  const grandes = lista.filter(f => f.size > PACOTE_MAX)
  if (grandes.length) {
    toast.add({
      title: `${grandes.length} arquivo(s) maior(es) que 24 MB`,
      description: `${grandes.map(f => f.name).slice(0, 3).join(', ')} — envie os arquivos soltos ou em ZIPs menores.`,
      color: 'warning'
    })
  }
  const aptos = lista.filter(f => f.size <= PACOTE_MAX)

  // agrupa em pacotes de até ~24 MB
  const pacotes: File[][] = []
  let atual: File[] = []
  let soma = 0
  for (const f of aptos) {
    if (atual.length && soma + f.size > PACOTE_MAX) { pacotes.push(atual); atual = []; soma = 0 }
    atual.push(f)
    soma += f.size
  }
  if (atual.length) pacotes.push(atual)

  enviando.value = true
  recusados.value = []
  let novos = 0
  try {
    for (const [i, pacote] of pacotes.entries()) {
      progresso.value = pacotes.length > 1 ? `Enviando pacote ${i + 1} de ${pacotes.length}…` : 'Enviando…'
      const fd = new FormData()
      for (const f of pacote) fd.append('arquivos', f)
      const r = await $fetch<{ aceitos: Aceito[]; recusados: { original: string; motivo: string }[] }>(
        api('/api/admin/upload-individual'),
        { method: 'POST', body: fd }
      )
      arquivos.value = [...arquivos.value, ...r.aceitos]
      recusados.value.push(...r.recusados)
      novos += r.aceitos.length
    }
    toast.add({
      title: `${novos} arquivo(s) recebido(s)`,
      description: recusados.value.length ? `${recusados.value.length} recusado(s) — veja o motivo abaixo.` : undefined,
      color: recusados.value.length ? 'warning' : 'success'
    })
  } catch (err: any) {
    toast.add({ title: 'Falha no envio dos arquivos', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
    progresso.value = ''
  }
}

/** liga (ou desliga, com email vazio) um arquivo a um destinatário */
function ligar(nomeArquivo: string, email: string | null) {
  const novo = { ...manuais.value }
  if (email) {
    // a pessoa só pode ter um arquivo: tira a ligação manual anterior dela
    for (const [k, v] of Object.entries(novo)) if (v === email) delete novo[k]
    novo[nomeArquivo] = email
  } else {
    delete novo[nomeArquivo]
  }
  manuais.value = novo
}

function remover(nomeArquivo: string) {
  arquivos.value = arquivos.value.filter(a => a.nome !== nomeArquivo)
  ligar(nomeArquivo, null)
}

function limparTudo() {
  if (!confirm('Tirar todos os arquivos individuais deste envio?')) return
  arquivos.value = []
  manuais.value = {}
}

const destPorEmail = computed(() => new Map(props.destinatarios.map(d => [d.email, d])))
const semDocumento = computed(() => props.destinatarios.filter(d => !soDigitos(d.documento)).length)

/** quem ainda pode receber um arquivo solto (sem arquivo hoje) */
const opcoesDestino = computed(() => [
  { label: '— escolher destinatário —', value: '' },
  ...props.casamento.semArquivo.map(e => {
    const d = destPorEmail.value.get(e)
    return { label: `${d?.nome || d?.empresa || e} · ${e}`, value: e }
  })
])

const COMO: Record<string, string> = { documento: 'CPF/CNPJ', email: 'e-mail', nome: 'nome', manual: 'manual' }
const soltos = computed(() => [...props.casamento.semDono, ...props.casamento.repetidos.map(r => r.arquivo)])
const verCasados = ref(false)
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-lightbulb"
      title="Como o sistema descobre de quem é cada arquivo"
      description="Pelo NOME do arquivo: o CPF/CNPJ do cliente (ex.: DAS_12.345.678-0001-90.pdf), o e-mail dele, ou o nome/empresa exatamente igual. O que não casar você liga à mão logo abaixo."
    />
    <UAlert
      v-if="semDocumento"
      color="warning"
      variant="subtle"
      icon="i-lucide-id-card"
      :description="`${semDocumento} destinatário(s) estão sem CPF/CNPJ na lista: eles só casam por e-mail ou nome no arquivo. Para casar pelo documento, volte ao passo 1 e aponte a coluna de CPF/CNPJ.`"
    />

    <div class="rounded-lg border border-dashed border-default p-6 text-center">
      <UIcon name="i-lucide-files" class="mx-auto size-10 text-muted" />
      <p class="mt-2 text-sm font-medium">Envie os arquivos dos destinatários</p>
      <p class="text-xs text-muted">Vários de uma vez, ou um ZIP com todos. {{ FORMATOS }} — até 25 MB cada.</p>
      <label class="mt-3 inline-block">
        <input type="file" multiple :accept="ACCEPT" class="hidden" :disabled="enviando" @change="subir">
        <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
          <UIcon :name="enviando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="enviando && 'animate-spin'" />
          {{ enviando ? progresso : arquivos.length ? 'Enviar mais arquivos' : 'Escolher arquivos' }}
        </span>
      </label>
    </div>

    <UAlert
      v-if="recusados.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-file-x"
      :title="`${recusados.length} arquivo(s) recusado(s)`"
    >
      <template #description>
        <ul class="mt-1 space-y-0.5 text-xs">
          <li v-for="r in recusados.slice(0, 10)" :key="r.original"><strong>{{ r.original }}</strong>: {{ r.motivo }}</li>
          <li v-if="recusados.length > 10">… e mais {{ recusados.length - 10 }}</li>
        </ul>
      </template>
    </UAlert>

    <template v-if="arquivos.length">
      <!-- resumo -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">Com arquivo</p>
          <p class="text-xl font-semibold text-success">{{ Object.keys(casamento.casados).length }}</p>
        </div>
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">Sem arquivo</p>
          <p class="text-xl font-semibold" :class="casamento.semArquivo.length ? 'text-warning' : ''">{{ casamento.semArquivo.length }}</p>
        </div>
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">Arquivos sem dono</p>
          <p class="text-xl font-semibold" :class="casamento.semDono.length ? 'text-warning' : ''">{{ casamento.semDono.length }}</p>
        </div>
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">Repetidos</p>
          <p class="text-xl font-semibold" :class="casamento.repetidos.length ? 'text-warning' : ''">{{ casamento.repetidos.length }}</p>
        </div>
      </div>

      <!-- arquivos que sobraram: ligar à mão -->
      <div v-if="soltos.length" class="space-y-2">
        <p class="text-sm font-medium">Arquivos que não casaram com ninguém</p>
        <p v-if="casamento.repetidos.length" class="text-xs text-muted">
          "Repetido" é um segundo arquivo para uma pessoa que já tem um: ligue a outra pessoa ou remova.
        </p>
        <div v-for="a in soltos" :key="a.nome" class="flex flex-wrap items-center gap-2 rounded-lg border border-default p-2">
          <UIcon name="i-lucide-file-question" class="size-5 shrink-0 text-warning" />
          <span class="min-w-0 flex-1 truncate text-sm" :title="a.original">{{ a.original }}</span>
          <UBadge v-if="casamento.repetidos.some(r => r.arquivo.nome === a.nome)" label="repetido" color="warning" variant="subtle" size="xs" />
          <USelect
            :model-value="manuais[a.nome] ?? ''"
            :items="opcoesDestino"
            class="w-72"
            size="sm"
            @update:model-value="v => ligar(a.nome, String(v) || null)"
          />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Remover arquivo" @click="remover(a.nome)" />
        </div>
      </div>

      <!-- quem ficou sem arquivo -->
      <div v-if="casamento.semArquivo.length" class="space-y-2">
        <p class="text-sm font-medium">{{ casamento.semArquivo.length }} destinatário(s) sem arquivo</p>
        <p class="text-xs text-muted">
          {{ casamento.semArquivo.slice(0, 8).map(e => destPorEmail.get(e)?.nome || e).join(', ') }}{{ casamento.semArquivo.length > 8 ? '…' : '' }}
        </p>
        <UCheckbox
          v-model="enviarSemArquivo"
          label="Enviar sem anexo para quem ficou sem arquivo"
          help="Sem esta opção, o envio só pode seguir quando todos tiverem arquivo (ou você tirar essas pessoas da lista no passo 1)."
        />
      </div>

      <!-- casados -->
      <div class="space-y-2">
        <UButton
          :label="`${verCasados ? 'Ocultar' : 'Ver'} os ${Object.keys(casamento.casados).length} casados`"
          :icon="verCasados ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="verCasados = !verCasados"
        />
        <div v-if="verCasados" class="max-h-80 overflow-y-auto rounded-lg border border-default">
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="(c, email) in casamento.casados" :key="email" class="border-t border-default first:border-0">
                <td class="max-w-[220px] px-3 py-2">
                  <p class="truncate font-medium">{{ destPorEmail.get(String(email))?.nome || email }}</p>
                  <p class="truncate text-xs text-muted">{{ email }}</p>
                </td>
                <td class="px-3 py-2 text-xs"><UBadge :label="`por ${COMO[c.como]}`" color="neutral" variant="subtle" size="xs" /></td>
                <td class="max-w-[260px] truncate px-3 py-2 text-xs" :title="c.arquivo.original">{{ c.arquivo.original }}</td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    v-if="c.como === 'manual'"
                    icon="i-lucide-unlink"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    aria-label="Desfazer ligação"
                    @click="ligar(c.arquivo.nome, null)"
                  />
                  <UButton v-else icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Remover arquivo" @click="remover(c.arquivo.nome)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <UButton label="Tirar todos os arquivos" icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" @click="limparTudo" />
    </template>
  </div>
</template>
