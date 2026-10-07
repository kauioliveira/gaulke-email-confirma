<script setup lang="ts">
import { documentoValidoDV, formatarDocumento, soDigitosDoc } from '~~/shared/utils/documento'

/**
 * Importa e-mails por CPF/CNPJ de uma planilha (CSV, TXT ou Excel) para o
 * cadastro de contatos das empresas. Usado na tela "Contatos das empresas" e
 * no lote "arquivos por cliente", quando falta e-mail para algum CNPJ.
 *
 * A leitura reaproveita /api/admin/importar (a mesma das listas): ela detecta
 * as colunas de documento, e-mail, nome e empresa. Uma célula pode trazer
 * vários e-mails separados por ; , ou espaço. Só entra a linha com CPF/CNPJ
 * válido (dígito verificador) e e-mail válido — o resto aparece com o motivo.
 */
const emit = defineEmits<{ importado: [r: { documentos: string[]; gravados: number }] }>()
const toast = useToast()

const SEM_COLUNA = '__nenhuma__'
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const lendo = ref(false)
const gravando = ref(false)
const lido = ref<RespostaImportacao | null>(null)
const mapa = reactive({ documento: SEM_COLUNA, email: SEM_COLUNA, nome: SEM_COLUNA, empresa: SEM_COLUNA })

const opcoesColuna = computed(() => [
  { label: '— nenhuma —', value: SEM_COLUNA },
  ...(lido.value?.colunas ?? []).map(c => ({ label: c, value: c }))
])

async function ler(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  lendo.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    const r = await $fetch<RespostaImportacao>(api('/api/admin/importar'), { method: 'POST', body: fd })
    lido.value = r
    mapa.documento = r.sugestao.documento || SEM_COLUNA
    mapa.email = r.sugestao.email || SEM_COLUNA
    mapa.nome = r.sugestao.nome || SEM_COLUNA
    mapa.empresa = r.sugestao.empresa || SEM_COLUNA
  } catch (err: any) {
    lido.value = null
    toast.add({ title: 'Não foi possível ler o arquivo', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    lendo.value = false
  }
}

type Linha = { linha: number; documento: string; email: string; nome: string; empresa: string }
type Recusada = { linha: number; valor: string; motivo: string }

const analise = computed(() => {
  const validas: Linha[] = []
  const recusadas: Recusada[] = []
  if (!lido.value || mapa.documento === SEM_COLUNA || mapa.email === SEM_COLUNA) return { validas, recusadas, documentos: 0 }
  const vistos = new Set<string>()
  const col = (l: Record<string, string>, c: string) => (c === SEM_COLUNA ? '' : (l[c] ?? '').trim())

  lido.value.linhas.forEach((l, i) => {
    const n = i + 2 // a linha 1 é o cabeçalho
    const docBruto = col(l, mapa.documento)
    const documento = soDigitosDoc(docBruto)
    const emails = col(l, mapa.email).toLowerCase().split(/[;,\s]+/).filter(Boolean)
    if (!docBruto && !emails.length) return // linha em branco
    if (!documento) return recusadas.push({ linha: n, valor: emails.join(', '), motivo: 'sem CPF/CNPJ' })
    if (!documentoValidoDV(documento)) return recusadas.push({ linha: n, valor: docBruto, motivo: 'CPF/CNPJ inválido' })
    if (!emails.length) return recusadas.push({ linha: n, valor: formatarDocumento(documento), motivo: 'sem e-mail' })
    for (const email of emails) {
      if (!RE_EMAIL.test(email)) {
        recusadas.push({ linha: n, valor: email, motivo: 'e-mail inválido' })
        continue
      }
      const chave = `${documento}|${email}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      validas.push({ linha: n, documento, email, nome: col(l, mapa.nome), empresa: col(l, mapa.empresa) })
    }
  })
  return { validas, recusadas, documentos: new Set(validas.map(v => v.documento)).size }
})

async function gravar() {
  if (!analise.value.validas.length) return
  gravando.value = true
  try {
    const r = await $fetch<{ gravados: number; documentos: number }>(api('/api/admin/empresa-contatos/importar'), {
      method: 'POST',
      body: {
        arquivo: lido.value?.arquivo,
        contatos: analise.value.validas.map(v => ({ documento: v.documento, email: v.email, nome: v.nome || null, empresa: v.empresa || null }))
      }
    })
    toast.add({ title: `${r.gravados} e-mail(s) salvos para ${r.documentos} CPF/CNPJ`, color: 'success', icon: 'i-lucide-check' })
    emit('importado', { documentos: [...new Set(analise.value.validas.map(v => v.documento))], gravados: r.gravados })
    lido.value = null
  } catch (err: any) {
    toast.add({ title: 'Falha ao importar', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    gravando.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg border border-dashed border-default p-5 text-center">
      <UIcon name="i-lucide-sheet" class="mx-auto size-9 text-muted" />
      <p class="mt-2 text-sm font-medium">Planilha com CPF/CNPJ e e-mail</p>
      <p class="text-xs text-muted">
        CSV, TXT ou Excel, com cabeçalho na primeira linha. Colunas: <b>CNPJ</b> e <b>E-mail</b> (obrigatórias),
        Nome e Empresa (opcionais). Vários e-mails na mesma célula: separe por ponto e vírgula.
      </p>
      <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
        <label>
          <input type="file" accept=".csv,.txt,.xlsx,.xls" class="hidden" @change="ler">
          <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
            <UIcon :name="lendo ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="lendo && 'animate-spin'" />
            {{ lendo ? 'Lendo…' : 'Escolher planilha' }}
          </span>
        </label>
        <UButton
          :to="api('/api/admin/empresa-contatos/modelo')"
          external
          label="Baixar modelo"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
        />
      </div>
    </div>

    <template v-if="lido">
      <p class="text-sm">
        <b>{{ lido.arquivo }}</b> — {{ lido.total }} linha(s). Confira qual coluna é cada informação:
      </p>
      <div class="grid gap-3 sm:grid-cols-4">
        <UFormField label="CPF/CNPJ" required>
          <USelect v-model="mapa.documento" :items="opcoesColuna" class="w-full" />
        </UFormField>
        <UFormField label="E-mail" required>
          <USelect v-model="mapa.email" :items="opcoesColuna" class="w-full" />
        </UFormField>
        <UFormField label="Nome do contato">
          <USelect v-model="mapa.nome" :items="opcoesColuna" class="w-full" />
        </UFormField>
        <UFormField label="Empresa">
          <USelect v-model="mapa.empresa" :items="opcoesColuna" class="w-full" />
        </UFormField>
      </div>

      <UAlert
        v-if="mapa.documento === SEM_COLUNA || mapa.email === SEM_COLUNA"
        color="warning"
        variant="subtle"
        icon="i-lucide-columns-3"
        title="Escolha a coluna do CPF/CNPJ e a do e-mail"
      />
      <template v-else>
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">E-mails válidos</p>
            <p class="text-xl font-semibold text-success">{{ analise.validas.length }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">CPF/CNPJ diferentes</p>
            <p class="text-xl font-semibold">{{ analise.documentos }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Recusados</p>
            <p class="text-xl font-semibold" :class="analise.recusadas.length ? 'text-warning' : ''">{{ analise.recusadas.length }}</p>
          </div>
        </div>

        <details v-if="analise.recusadas.length" class="rounded-lg border border-default p-3 text-sm">
          <summary class="cursor-pointer font-medium">Ver o que ficou de fora</summary>
          <ul class="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
            <li v-for="(r, i) in analise.recusadas.slice(0, 300)" :key="i">
              Linha {{ r.linha }}: <span class="font-mono">{{ r.valor || '—' }}</span> — {{ r.motivo }}
            </li>
          </ul>
        </details>

        <UButton
          :label="`Salvar ${analise.validas.length} e-mail(s)`"
          icon="i-lucide-save"
          :loading="gravando"
          :disabled="!analise.validas.length"
          block
          @click="gravar"
        />
      </template>
    </template>
  </div>
</template>
