<script setup lang="ts">
import { TIPOS_ANEXO, acceptDe, familiasDe, iconeDoArquivo } from '~~/shared/types/tipos-arquivo'
import { documentoValidoDV, formatarDocumento, mascaraDocumento, soDigitosDoc } from '~~/shared/utils/documento'
import { tamanho } from '~/utils/formato'
import { SITUACOES, destinatariosDasLinhas, situacaoLinha, type ContatoLinha, type LinhaArquivo, type SituacaoLinha } from '~/utils/lote-arquivos'

/**
 * Passo 1 do lote "arquivos por cliente".
 *
 * A pessoa sobe um ZIP (ou vários arquivos). Para cada arquivo o servidor
 * acha o CPF/CNPJ — no nome ou dentro dele (ex.: "CNPJ: ..." na linha 2 do
 * Excel) — e o cadastro de contatos devolve a empresa e os e-mails. Aqui ela
 * confere, escolhe quem recebe, completa o que faltar (CNPJ ou e-mail à mão,
 * ou importando uma planilha de e-mails) e segue.
 *
 * O upload vai em pacotes de até ~24 MB, como no anexo individual: o proxy
 * recusa requisições acima de 30 MB.
 */
const linhas = defineModel<LinhaArquivo[]>({ required: true })
/** texto do motivo quando o upload ainda não pode ser feito (ex.: falta escolher o template) */
const props = defineProps<{ bloqueado?: string | null }>()
const emit = defineEmits<{ primeiroArquivo: [nome: string] }>()

const toast = useToast()
const confirmar = useConfirmar()
const ACCEPT = `${acceptDe(TIPOS_ANEXO)},.zip`
const FORMATOS = familiasDe(TIPOS_ANEXO)
const PACOTE_MAX = 24 * 1024 * 1024
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Aceito = {
  nome: string
  original: string
  tamanho: number
  tipo: string
  documentos?: string[]
  docOrigem?: 'nome' | 'conteudo' | null
}

/**
 * Resultado de cada envio, para a pessoa conferir que nada se perdeu:
 * "42 no ZIP = 40 lidos + 2 com erro", e quantos tiveram o CNPJ achado.
 */
type Leitura = {
  quando: Date
  zips: { nome: string; arquivos: number }[]
  soltos: number
  lidos: number
  comCnpj: number
  semCnpj: number
  recusados: { original: string; motivo: string }[]
  arquivos: { original: string; ok: boolean; detalhe: string }[]
}
const leituras = ref<Leitura[]>([])

const enviando = ref(false)
const progresso = ref('')
const recusados = ref<{ original: string; motivo: string }[]>([])
const consultando = ref(false)
const importando = ref(false)

/* ---------- upload ---------- */
async function subir(e: Event) {
  const input = e.target as HTMLInputElement
  const lista = [...(input.files ?? [])]
  input.value = ''
  if (!lista.length) return
  if (!linhas.value.length) emit('primeiroArquivo', lista[0]!.name)

  const grandes = lista.filter(f => f.size > PACOTE_MAX)
  if (grandes.length) {
    toast.add({
      title: `${grandes.length} arquivo(s) maior(es) que 24 MB`,
      description: `${grandes.map(f => f.name).slice(0, 3).join(', ')} — envie os arquivos soltos ou em ZIPs menores.`,
      color: 'warning'
    })
  }
  const pacotes: File[][] = []
  let atual: File[] = []
  let soma = 0
  for (const f of lista.filter(f => f.size <= PACOTE_MAX)) {
    if (atual.length && soma + f.size > PACOTE_MAX) { pacotes.push(atual); atual = []; soma = 0 }
    atual.push(f)
    soma += f.size
  }
  if (atual.length) pacotes.push(atual)

  enviando.value = true
  recusados.value = []
  const novos: LinhaArquivo[] = []
  const zips: Leitura['zips'] = []
  const soltos = lista.filter(f => !/\.zip$/i.test(f.name)).length
  try {
    for (const [i, pacote] of pacotes.entries()) {
      progresso.value = pacotes.length > 1 ? `Enviando e lendo pacote ${i + 1} de ${pacotes.length}…` : 'Enviando e lendo os arquivos…'
      const fd = new FormData()
      for (const f of pacote) fd.append('arquivos', f)
      const r = await $fetch<{ aceitos: Aceito[]; recusados: { original: string; motivo: string }[]; zips: Leitura['zips'] }>(
        api('/api/admin/upload-individual?lerDocumento=1'),
        { method: 'POST', body: fd }
      )
      recusados.value.push(...r.recusados)
      zips.push(...(r.zips ?? []))
      for (const a of r.aceitos) {
        const docs = a.documentos ?? []
        novos.push({
          nome: a.nome,
          original: a.original,
          tamanho: a.tamanho,
          tipo: a.tipo,
          documentos: docs,
          docOrigem: a.docOrigem ?? null,
          documento: docs.length === 1 ? docs[0]! : null,
          empresa: null,
          cadastrado: null,
          emails: []
        })
      }
    }
    linhas.value = [...linhas.value, ...novos]
    await consultar(novos.map(n => n.documento).filter((d): d is string => !!d))
    const comCnpj = novos.filter(n => n.documentos.length).length
    leituras.value = [
      {
        quando: new Date(),
        zips,
        soltos,
        lidos: novos.length,
        comCnpj,
        semCnpj: novos.length - comCnpj,
        recusados: [...recusados.value],
        arquivos: [
          ...novos.map(n => ({
            original: n.original,
            ok: true,
            detalhe: n.documentos.length === 1
              ? `CNPJ ${formatarDocumento(n.documentos[0])} (${ORIGEM_DOC[n.docOrigem ?? ''] ?? ''})`
              : n.documentos.length > 1 ? `${n.documentos.length} CNPJs no arquivo — escolha o certo` : 'lido, mas sem CNPJ — informe na linha'
          })),
          ...recusados.value.map(r => ({ original: r.original, ok: false, detalhe: r.motivo }))
        ]
      },
      ...leituras.value
    ]
    toast.add({
      title: recusados.value.length
        ? `${novos.length} arquivo(s) lido(s), ${recusados.value.length} com erro`
        : `Todos os ${novos.length} arquivo(s) lidos`,
      color: recusados.value.length ? 'warning' : 'success'
    })
  } catch (err: any) {
    if (novos.length) linhas.value = [...linhas.value, ...novos]
    toast.add({ title: 'Falha no envio dos arquivos', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
    progresso.value = ''
  }
}

/* ---------- CNPJ -> empresa + e-mails ---------- */
/**
 * Consulta os documentos e completa as linhas. Os e-mails novos entram
 * marcados (menos os suprimidos); os que já estavam mantêm a escolha da
 * pessoa — é o que deixa importar uma planilha no meio sem perder nada.
 */
async function consultar(documentos: string[]) {
  const docs = [...new Set(documentos)]
  if (!docs.length) return
  consultando.value = true
  try {
    const r = await $fetch<DocumentoResolvido[]>(api('/api/admin/lote-arquivos/resolver'), { method: 'POST', body: { documentos: docs } })
    const porDoc = new Map(r.map(x => [x.documento, x]))
    linhas.value = linhas.value.map(l => {
      const x = l.documento ? porDoc.get(l.documento) : undefined
      if (!x) return l
      const emails = [...l.emails]
      for (const c of x.emails) {
        if (emails.some(e => e.email === c.email)) continue
        emails.push({ id: c.id, email: c.email, nome: c.nome, marcado: !c.suprimido, suprimido: c.suprimido, manual: false })
      }
      return { ...l, empresa: x.fantasia ? `${x.nome} (${x.fantasia})` : (x.nome ?? l.empresa), cadastrado: !!x.nome, emails }
    })
  } catch (err: any) {
    toast.add({ title: 'Não foi possível consultar os CNPJs', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    consultando.value = false
  }
}

function atualizar(i: number, parcial: Partial<LinhaArquivo>) {
  linhas.value = linhas.value.map((l, n) => (n === i ? { ...l, ...parcial } : l))
}

/* CNPJ digitado à mão (ou escolhido entre vários achados no arquivo) */
const docDigitado = reactive<Record<string, string>>({})
async function definirDocumento(i: number, valor: string, origem: LinhaArquivo['docOrigem']) {
  const d = soDigitosDoc(valor)
  if (!documentoValidoDV(d)) {
    toast.add({ title: 'CPF/CNPJ inválido', description: 'Confira os dígitos.', color: 'warning' })
    return
  }
  // trocou o documento: os e-mails da empresa anterior não valem mais
  atualizar(i, { documento: d, docOrigem: origem, empresa: null, cadastrado: null, emails: linhas.value[i]!.emails.filter(e => e.manual) })
  await consultar([d])
}
function trocarDocumento(i: number) {
  atualizar(i, { documento: null, empresa: null, cadastrado: null, emails: [] })
}

/* e-mail à mão */
const emailDigitado = reactive<Record<string, string>>({})
function adicionarEmail(i: number) {
  const l = linhas.value[i]!
  const email = (emailDigitado[l.nome] ?? '').trim().toLowerCase()
  if (!RE_EMAIL.test(email)) {
    toast.add({ title: 'E-mail inválido', color: 'warning' })
    return
  }
  if (l.emails.some(e => e.email === email)) {
    atualizar(i, { emails: l.emails.map(e => (e.email === email ? { ...e, marcado: true } : e)) })
  } else {
    atualizar(i, { emails: [...l.emails, { email, nome: null, marcado: true, suprimido: false, manual: true }] })
  }
  emailDigitado[l.nome] = ''
}
function marcarEmail(i: number, email: string, marcado: boolean) {
  atualizar(i, { emails: linhas.value[i]!.emails.map(e => (e.email === email ? { ...e, marcado } : e)) })
}

/**
 * Excluir um e-mail (o de um teste, um endereço errado): sai desta linha e,
 * se já estava salvo, do cadastro do CNPJ — de todas as linhas do mesmo CNPJ.
 * Uma confirmação só.
 */
const excluindo = ref<string | null>(null)
async function excluirEmail(i: number, e: ContatoLinha) {
  const l = linhas.value[i]!
  const ok = await confirmar({
    titulo: `Excluir ${e.email}?`,
    descricao: e.id
      ? `Sai deste envio e do cadastro de ${formatarDocumento(l.documento)} — não aparece mais nos próximos envios.`
      : 'Sai deste envio.',
    sim: 'Excluir',
    cor: 'error',
    icone: 'i-lucide-trash-2'
  })
  if (!ok) return
  excluindo.value = `${l.nome}|${e.email}`
  try {
    if (e.id) await $fetch(api(`/api/admin/empresa-contatos/${e.id}`), { method: 'DELETE' })
    linhas.value = linhas.value.map((x, n) =>
      n === i || (e.id && x.documento === l.documento) ? { ...x, emails: x.emails.filter(y => y.email !== e.email) } : x
    )
    toast.add({ title: `${e.email} excluído`, color: 'success', icon: 'i-lucide-trash-2' })
  } catch (err: any) {
    toast.add({ title: 'Não foi possível excluir', description: err?.data?.statusMessage, color: 'error' })
  } finally {
    excluindo.value = null
  }
}

function remover(i: number) {
  linhas.value = linhas.value.filter((_, n) => n !== i)
}
async function limparTudo() {
  const ok = await confirmar({
    titulo: 'Tirar todos os arquivos deste envio?',
    descricao: `Os ${linhas.value.length} arquivo(s) e as escolhas de e-mail saem da lista. Os e-mails salvos no cadastro continuam.`,
    sim: 'Tirar todos',
    cor: 'error',
    icone: 'i-lucide-trash'
  })
  if (!ok) return
  linhas.value = []
  recusados.value = []
  leituras.value = []
}

async function aposImportar(r: { documentos: string[] }) {
  importando.value = false
  // reconsulta tudo o que tem documento: a planilha pode ter trazido e-mail para qualquer um
  await consultar([...r.documentos, ...linhas.value.map(l => l.documento).filter((d): d is string => !!d)])
}

/* ---------- resumo e filtro ---------- */
const situacoes = computed(() => linhas.value.map(situacaoLinha))
const contagem = computed(() => {
  const c: Record<SituacaoLinha, number> = { pronto: 0, sem_email: 0, sem_documento: 0, varios_documentos: 0 }
  for (const s of situacoes.value) c[s]++
  return c
})
const totalDestinatarios = computed(() => destinatariosDasLinhas(linhas.value).length)
const filtro = ref<'todos' | 'pendentes'>('todos')
const visiveis = computed(() =>
  linhas.value
    .map((l, i) => ({ l, i, s: situacoes.value[i]! }))
    .filter(x => filtro.value === 'todos' || x.s !== 'pronto')
)
const ORIGEM_DOC: Record<string, string> = { nome: 'pelo nome do arquivo', conteudo: 'lido dentro do arquivo', manual: 'informado à mão' }
</script>

<template>
  <div class="space-y-5">
    <!-- upload -->
    <div class="rounded-lg border border-dashed border-default p-6 text-center">
      <UIcon name="i-lucide-folder-archive" class="mx-auto size-10 text-muted" />
      <p class="mt-2 text-sm font-medium">Envie o ZIP com um arquivo para cada cliente</p>
      <p class="mx-auto max-w-xl text-xs text-muted">
        O sistema acha o CNPJ de cada arquivo — no nome do arquivo ou dentro dele (ex.: “CNPJ: 12.345.678/0001-90” nas
        primeiras linhas da planilha) — e busca a empresa e os e-mails cadastrados. Aceita ZIP ou os arquivos soltos:
        {{ FORMATOS }}, até 25 MB cada.
      </p>
      <p v-if="props.bloqueado" class="mt-3 text-sm font-medium text-warning">
        <UIcon name="i-lucide-lock" class="mr-1 align-[-2px]" />{{ props.bloqueado }}
      </p>
      <label v-else class="mt-3 inline-block">
        <input type="file" :accept="ACCEPT" multiple class="hidden" :disabled="enviando" @change="subir">
        <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
          <UIcon :name="enviando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="enviando && 'animate-spin'" />
          {{ enviando ? progresso : linhas.length ? 'Adicionar mais arquivos' : 'Escolher ZIP ou arquivos' }}
        </span>
      </label>
    </div>

    <!-- resultado da leitura: quantos havia, quantos deram certo, quais deram erro -->
    <div
      v-for="(r, n) in leituras"
      :key="r.quando.getTime()"
      class="rounded-lg border p-4"
      :class="r.recusados.length ? 'border-warning/60 bg-warning/5' : 'border-success/50 bg-success/5'"
    >
      <div class="flex flex-wrap items-start gap-3">
        <UIcon
          :name="r.recusados.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check-big'"
          class="mt-0.5 size-6 shrink-0"
          :class="r.recusados.length ? 'text-warning' : 'text-success'"
        />
        <div class="min-w-0 flex-1 space-y-1">
          <p class="font-semibold">
            {{ r.recusados.length ? `Leitura com ${r.recusados.length} erro(s)` : 'Todos os arquivos foram lidos' }}
            <span v-if="leituras.length > 1" class="text-xs font-normal text-muted">· envio {{ leituras.length - n }}</span>
          </p>
          <p v-for="z in r.zips" :key="z.nome" class="text-sm">
            <UIcon name="i-lucide-folder-archive" class="mr-1 align-[-2px] text-muted" /><b>{{ z.nome }}</b>: {{ z.arquivos }} arquivo(s) no ZIP
          </p>
          <p v-if="r.soltos" class="text-sm">{{ r.soltos }} arquivo(s) enviado(s) fora de ZIP</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <UBadge :label="`${r.lidos} lido(s)`" color="success" variant="subtle" icon="i-lucide-check" />
            <UBadge :label="`${r.comCnpj} com CNPJ identificado`" color="success" variant="outline" />
            <UBadge v-if="r.semCnpj" :label="`${r.semCnpj} sem CNPJ`" color="warning" variant="outline" />
            <UBadge v-if="r.recusados.length" :label="`${r.recusados.length} com erro`" color="error" variant="subtle" icon="i-lucide-x" />
          </div>
          <ul v-if="r.recusados.length" class="pt-2 text-sm">
            <li v-for="(x, i) in r.recusados" :key="i" class="text-error">
              <UIcon name="i-lucide-file-x" class="mr-1 align-[-2px]" /><b>{{ x.original }}</b> — {{ x.motivo }}
            </li>
          </ul>
          <details class="pt-1 text-xs">
            <summary class="cursor-pointer text-muted">Ver todos os arquivos ({{ r.arquivos.length }})</summary>
            <ul class="mt-2 max-h-56 space-y-0.5 overflow-auto">
              <li v-for="(x, i) in r.arquivos" :key="i" :class="x.ok ? '' : 'text-error'">
                <UIcon :name="x.ok ? 'i-lucide-check' : 'i-lucide-x'" class="mr-1 align-[-2px]" :class="x.ok ? 'text-success' : ''" />
                {{ x.original }} — <span class="text-muted">{{ x.detalhe }}</span>
              </li>
            </ul>
          </details>
        </div>
      </div>
    </div>

    <template v-if="linhas.length">
      <!-- resumo -->
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="font-medium">{{ linhas.length }} arquivo(s)</span>
        <UBadge :label="`${contagem.pronto} pronto(s)`" color="success" variant="subtle" icon="i-lucide-check-circle-2" />
        <UBadge v-if="contagem.sem_email" :label="`${contagem.sem_email} sem e-mail`" color="warning" variant="subtle" icon="i-lucide-mail-question" />
        <UBadge v-if="contagem.sem_documento" :label="`${contagem.sem_documento} sem CNPJ`" color="warning" variant="subtle" icon="i-lucide-file-search" />
        <UBadge v-if="contagem.varios_documentos" :label="`${contagem.varios_documentos} com vários CNPJs`" color="warning" variant="subtle" icon="i-lucide-files" />
        <span class="text-muted">→ {{ totalDestinatarios }} e-mail(s) a enviar</span>
        <UIcon v-if="consultando" name="i-lucide-loader-circle" class="animate-spin text-muted" />
        <div class="ml-auto flex flex-wrap gap-2">
          <UButton
            label="Importar planilha de e-mails"
            icon="i-lucide-file-spreadsheet"
            color="neutral"
            variant="outline"
            size="sm"
            @click="importando = true"
          />
          <UButton label="Limpar tudo" icon="i-lucide-trash" color="error" variant="ghost" size="sm" @click="limparTudo" />
        </div>
      </div>

      <UAlert
        v-if="contagem.pronto < linhas.length"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        description="Os arquivos que não estiverem “Prontos” ficam de fora deste envio. Informe o CNPJ ou o e-mail na linha, ou importe uma planilha com os e-mails por CNPJ — os e-mails informados ficam salvos para os próximos envios."
      />

      <div class="flex gap-1">
        <UButton :variant="filtro === 'todos' ? 'soft' : 'ghost'" color="neutral" size="xs" label="Todos" @click="filtro = 'todos'" />
        <UButton
          :variant="filtro === 'pendentes' ? 'soft' : 'ghost'"
          color="neutral"
          size="xs"
          :label="`Pendentes (${linhas.length - contagem.pronto})`"
          @click="filtro = 'pendentes'"
        />
      </div>

      <!-- um cartão por arquivo -->
      <div class="space-y-2">
        <div
          v-for="{ l, i, s } in visiveis"
          :key="l.nome"
          class="rounded-lg border p-3"
          :class="s === 'pronto' ? 'border-default' : 'border-warning/50'"
        >
          <div class="flex flex-wrap items-start gap-3">
            <UIcon :name="iconeDoArquivo(l.original)" class="mt-0.5 size-6 shrink-0 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium" :title="l.original">{{ l.original }}</p>
              <p class="text-xs text-muted">{{ l.tipo }} · {{ tamanho(l.tamanho) }}</p>
            </div>
            <UBadge :label="SITUACOES[s].rotulo" :color="SITUACOES[s].cor" :icon="SITUACOES[s].icone" variant="subtle" />
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Tirar arquivo" @click="remover(i)" />
          </div>

          <div class="mt-3 grid gap-3 pl-9 md:grid-cols-2">
            <!-- CNPJ / empresa -->
            <div class="text-sm">
              <p class="mb-1 text-xs font-semibold uppercase text-muted">Cliente</p>
              <template v-if="l.documento">
                <p>
                  <span class="font-mono">{{ formatarDocumento(l.documento) }}</span>
                  <span class="text-xs text-muted"> · {{ ORIGEM_DOC[l.docOrigem ?? ''] ?? '' }}</span>
                  <UButton label="trocar" variant="link" size="xs" class="px-1" @click="trocarDocumento(i)" />
                </p>
                <p v-if="l.empresa" class="font-medium">{{ l.empresa }}</p>
                <p v-else-if="l.cadastrado === false" class="text-xs text-warning">CNPJ não encontrado no cadastro de clientes</p>
              </template>
              <template v-else>
                <div v-if="l.documentos.length > 1" class="mb-2 flex flex-wrap gap-1">
                  <span class="w-full text-xs text-muted">O arquivo tem mais de um documento. Qual é o do cliente?</span>
                  <UButton
                    v-for="d in l.documentos"
                    :key="d"
                    :label="formatarDocumento(d)"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    @click="definirDocumento(i, d, 'conteudo')"
                  />
                </div>
                <p v-else class="mb-1 text-xs text-muted">Não achamos o CNPJ no nome nem no conteúdo. Informe:</p>
                <div class="flex gap-2">
                  <UInput
                    :model-value="docDigitado[l.nome] ?? ''"
                    placeholder="CNPJ ou CPF"
                    size="sm"
                    class="w-48"
                    @update:model-value="v => (docDigitado[l.nome] = mascaraDocumento(String(v)))"
                    @keydown.enter="definirDocumento(i, docDigitado[l.nome] ?? '', 'manual')"
                  />
                  <UButton label="OK" size="sm" color="neutral" variant="outline" @click="definirDocumento(i, docDigitado[l.nome] ?? '', 'manual')" />
                </div>
              </template>
            </div>

            <!-- e-mails -->
            <div v-if="l.documento" class="text-sm">
              <p class="mb-1 text-xs font-semibold uppercase text-muted">Quem recebe</p>
              <div v-if="l.emails.length" class="space-y-1">
                <div v-for="e in l.emails" :key="e.email" class="group flex items-start gap-1">
                <UCheckbox
                  class="min-w-0 flex-1"
                  :model-value="e.marcado && !e.suprimido"
                  :disabled="e.suprimido"
                  :label="e.email"
                  :description="e.suprimido ? 'Devolve e-mail (lista de supressão)' : e.manual ? 'Informado agora — fica salvo para os próximos envios' : (e.nome ?? undefined)"
                  @update:model-value="v => marcarEmail(i, e.email, v === true)"
                />
                <UTooltip :text="e.id ? 'Excluir do cadastro deste CNPJ' : 'Tirar este e-mail'">
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    class="opacity-50 transition group-hover:opacity-100"
                    :loading="excluindo === `${l.nome}|${e.email}`"
                    :aria-label="`Excluir ${e.email}`"
                    @click="excluirEmail(i, e)"
                  />
                </UTooltip>
                </div>
              </div>
              <p v-else class="text-xs text-warning">Nenhum e-mail cadastrado para este CNPJ.</p>
              <div class="mt-2 flex gap-2">
                <UInput
                  v-model="emailDigitado[l.nome]"
                  type="email"
                  placeholder="adicionar e-mail"
                  size="sm"
                  class="min-w-0 flex-1"
                  @keydown.enter="adicionarEmail(i)"
                />
                <UButton icon="i-lucide-plus" size="sm" color="neutral" variant="outline" aria-label="Adicionar e-mail" @click="adicionarEmail(i)" />
              </div>
            </div>
          </div>
        </div>
        <p v-if="!visiveis.length" class="py-4 text-center text-sm text-muted">Nada pendente.</p>
      </div>
    </template>

    <UModal v-model:open="importando" title="Importar e-mails por CPF/CNPJ" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <ImportarContatos @importado="aposImportar" />
      </template>
    </UModal>
  </div>
</template>
