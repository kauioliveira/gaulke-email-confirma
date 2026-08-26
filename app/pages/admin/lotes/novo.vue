<script setup lang="ts">
import { tamanho, duracao } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Novo envio — Gaulke Envios' })

const toast = useToast()
const passo = ref(1)
const PASSOS = [
  { n: 1, titulo: 'Lista', icone: 'i-lucide-users' },
  { n: 2, titulo: 'Arquivo', icone: 'i-lucide-file-text' },
  { n: 3, titulo: 'E-mail', icone: 'i-lucide-mail' },
  { n: 4, titulo: 'Revisão', icone: 'i-lucide-rocket' }
]

/* ---------- Passo 1: lista ---------- */
/**
 * O USelect (Reka UI) reserva a string vazia para "sem selecao", entao a
 * opcao "nenhuma coluna" precisa de um valor proprio.
 */
const SEM_COLUNA = '__sem_coluna__'

const importando = ref(false)
const importado = ref<any>(null)
const mapa = reactive({ email: SEM_COLUNA, nome: SEM_COLUNA, empresa: SEM_COLUNA })
const colunasExtras = ref<string[]>([])

async function importar(e: Event) {
  const input = e.target as HTMLInputElement
  const arquivo = input.files?.[0]
  if (!arquivo) return
  importando.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', arquivo)
    const r = await $fetch<RespostaImportacao>(api('/api/admin/importar'), { method: 'POST', body: fd })
    importado.value = r
    mapa.email = r.sugestao.email || SEM_COLUNA
    mapa.nome = r.sugestao.nome || SEM_COLUNA
    mapa.empresa = r.sugestao.empresa || SEM_COLUNA
    colunasExtras.value = []
    toast.add({ title: `${r.total} linha(s) lidas de ${r.arquivo}`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Falha ao ler o arquivo', description: err?.statusMessage, color: 'error' })
  } finally {
    importando.value = false
    input.value = ''
  }
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Mesma validacao do servidor, para o operador ver o resultado antes de criar. */
const listaProcessada = computed(() => {
  if (!importado.value || mapa.email === SEM_COLUNA) return { validos: [], rejeitados: [] as any[] }
  const validos: any[] = []
  const rejeitados: any[] = []
  const vistos = new Set<string>()

  importado.value.linhas.forEach((l: any, i: number) => {
    const email = String(l[mapa.email] || '').trim().toLowerCase()
    if (!email) return rejeitados.push({ linha: i + 2, email: '', motivo: 'E-mail em branco' })
    if (!RE_EMAIL.test(email)) return rejeitados.push({ linha: i + 2, email, motivo: 'E-mail inválido' })
    if (vistos.has(email)) return rejeitados.push({ linha: i + 2, email, motivo: 'Duplicado na lista' })
    vistos.add(email)

    const extras: Record<string, string> = {}
    for (const c of colunasExtras.value) if (l[c]) extras[c] = String(l[c])

    validos.push({
      email,
      nome: mapa.nome === SEM_COLUNA ? '' : String(l[mapa.nome] || ''),
      empresa: mapa.empresa === SEM_COLUNA ? '' : String(l[mapa.empresa] || ''),
      extras
    })
  })
  return { validos, rejeitados }
})

const opcoesColunas = computed(() =>
  [
    { label: '— nenhuma —', value: SEM_COLUNA },
    ...(importado.value?.colunas || []).map((c: string) => ({ label: c, value: c }))
  ]
)

/* ---------- Passo 2: arquivo ---------- */
const { data: arquivos, refresh: recarregarArquivos } = await useFetch<RespostaArquivos>(api('/api/admin/arquivos'))
const arquivoNome = ref('')
const arquivoOriginal = ref('')
const enviandoArquivo = ref(false)

async function subirPdf(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  enviandoArquivo.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    const r = await $fetch<any>(api('/api/admin/upload'), { method: 'POST', body: fd })
    arquivoNome.value = r.nome
    arquivoOriginal.value = r.nomeOriginal
    await recarregarArquivos()
    toast.add({ title: 'PDF enviado', description: r.nomeOriginal, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Falha no upload', description: err?.statusMessage, color: 'error' })
  } finally {
    enviandoArquivo.value = false
    input.value = ''
  }
}

function escolherExistente(a: any) {
  arquivoNome.value = a.nome
  arquivoOriginal.value = a.nome
}

/* ---------- Passo 3: e-mail ---------- */
const { data: templatesData } = await useFetch<RespostaTemplates>(api('/api/admin/templates'))
const templateId = ref<number | null>(null)
const assunto = ref('')
const html = ref('')

function aplicarTemplate(id: number | null) {
  const t = templatesData.value?.templates.find(x => x.id === id)
  if (!t) return
  templateId.value = t.id
  assunto.value = t.assunto
  html.value = t.html
}
if (templatesData.value?.templates.length) aplicarTemplate(templatesData.value.templates[0]!.id)

const opcoesTemplates = computed(() =>
  (templatesData.value?.templates || []).map(t => ({ label: t.nome, value: t.id }))
)

/* ---------- Passo 4: revisão ---------- */
const nomeLote = ref(`Envio ${new Date().toLocaleDateString('pt-BR')}`)
const intervaloSegundos = ref(10)
const exigirConfirmacao = ref(true)
const pedirRecibo = ref(false)
const criando = ref(false)

const OPCOES_INTERVALO = [
  { label: '5 segundos', value: 5 },
  { label: '10 segundos (recomendado)', value: 10 },
  { label: '15 segundos', value: 15 },
  { label: '30 segundos', value: 30 },
  { label: '60 segundos', value: 60 }
]

const tempoEstimado = computed(() =>
  duracao(Math.max(0, listaProcessada.value.validos.length - 1) * intervaloSegundos.value * 1000)
)

const podeAvancar = computed(() => {
  if (passo.value === 1) return listaProcessada.value.validos.length > 0
  if (passo.value === 3) return !!assunto.value && !!html.value
  return true
})

async function criarLote() {
  criando.value = true
  try {
    const r = await $fetch<any>(api('/api/admin/batches'), {
      method: 'POST',
      body: {
        nome: nomeLote.value,
        templateId: templateId.value,
        assunto: assunto.value,
        html: html.value,
        arquivoNome: arquivoNome.value || null,
        arquivoOriginal: arquivoOriginal.value || null,
        intervaloMs: intervaloSegundos.value * 1000,
        exigirConfirmacao: exigirConfirmacao.value,
        pedirRecibo: pedirRecibo.value,
        destinatarios: listaProcessada.value.validos
      }
    })
    toast.add({ title: `Lote criado com ${r.destinatarios} destinatários`, color: 'success' })
    await navigateTo(`/admin/lotes/${r.lote.id}`)
  } catch (e: any) {
    toast.add({ title: 'Erro ao criar o lote', description: e?.statusMessage, color: 'error' })
  } finally {
    criando.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Novo envio</h1>
      <p class="text-sm text-muted">Importe a lista, escolha o documento e revise o e-mail antes de disparar.</p>
    </div>

    <!-- Trilha de passos -->
    <div class="flex flex-wrap items-center gap-2">
      <template v-for="(p, i) in PASSOS" :key="p.n">
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
          :class="passo === p.n ? 'bg-primary text-inverted' : passo > p.n ? 'text-primary' : 'text-muted'"
          @click="passo > p.n && (passo = p.n)"
        >
          <UIcon :name="passo > p.n ? 'i-lucide-check-circle-2' : p.icone" class="size-4" />
          {{ p.titulo }}
        </button>
        <UIcon v-if="i < PASSOS.length - 1" name="i-lucide-chevron-right" class="size-4 text-muted" />
      </template>
    </div>

    <!-- PASSO 1 -->
    <UCard v-show="passo === 1">
      <template #header><h2 class="font-semibold">1. Lista de destinatários</h2></template>

      <div class="space-y-5">
        <div class="rounded-lg border border-dashed border-default p-6 text-center">
          <UIcon name="i-lucide-file-spreadsheet" class="mx-auto size-10 text-muted" />
          <p class="mt-2 text-sm font-medium">Importe um arquivo CSV ou XLSX</p>
          <p class="text-xs text-muted">A primeira linha deve conter os nomes das colunas.</p>
          <label class="mt-3 inline-block">
            <input type="file" accept=".csv,.txt,.xlsx,.xls" class="hidden" @change="importar" >
            <span
              class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted"
            >
              <UIcon :name="importando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="importando && 'animate-spin'" />
              {{ importando ? 'Lendo...' : 'Escolher arquivo' }}
            </span>
          </label>
        </div>

        <template v-if="importado">
          <USeparator label="Mapeamento de colunas" />
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField label="Coluna de e-mail" required>
              <USelect v-model="mapa.email" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de nome">
              <USelect v-model="mapa.nome" :items="opcoesColunas" class="w-full" />
            </UFormField>
            <UFormField label="Coluna de empresa">
              <USelect v-model="mapa.empresa" :items="opcoesColunas" class="w-full" />
            </UFormField>
          </div>

          <UFormField
            label="Colunas extras"
            help="Ficam salvas junto ao destinatário e podem ser usadas como variáveis no HTML."
          >
            <USelectMenu
              v-model="colunasExtras"
              :items="importado.colunas"
              multiple
              placeholder="Nenhuma"
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-3 sm:grid-cols-2">
            <UAlert
              color="success"
              variant="subtle"
              icon="i-lucide-user-check"
              :title="`${listaProcessada.validos.length} destinatário(s) válidos`"
              description="Duplicados foram removidos automaticamente."
            />
            <UAlert
              v-if="listaProcessada.rejeitados.length"
              color="warning"
              variant="subtle"
              icon="i-lucide-user-x"
              :title="`${listaProcessada.rejeitados.length} linha(s) ignoradas`"
              :description="listaProcessada.rejeitados.slice(0, 3).map(r => `linha ${r.linha}: ${r.motivo}`).join(' · ')"
            />
          </div>

          <div v-if="listaProcessada.validos.length" class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-sm">
              <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
                <tr>
                  <th class="px-3 py-2">Nome</th>
                  <th class="px-3 py-2">E-mail</th>
                  <th class="px-3 py-2">Empresa</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(d, i) in listaProcessada.validos.slice(0, 8)" :key="i" class="border-t border-default">
                  <td class="px-3 py-2">{{ d.nome || '—' }}</td>
                  <td class="px-3 py-2 font-mono text-xs">{{ d.email }}</td>
                  <td class="px-3 py-2">{{ d.empresa || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="listaProcessada.validos.length > 8" class="border-t border-default px-3 py-2 text-xs text-muted">
              e mais {{ listaProcessada.validos.length - 8 }} destinatário(s)…
            </p>
          </div>
        </template>
      </div>
    </UCard>

    <!-- PASSO 2 -->
    <UCard v-show="passo === 2">
      <template #header><h2 class="font-semibold">2. Documento PDF</h2></template>

      <div class="space-y-5">
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="O PDF não vai anexado no e-mail"
          description="Ele fica em área privada e só é entregue pela página com token — é assim que conseguimos registrar quem baixou."
        />

        <div class="rounded-lg border border-dashed border-default p-6 text-center">
          <UIcon name="i-lucide-file-up" class="mx-auto size-10 text-muted" />
          <p class="mt-2 text-sm font-medium">Envie o PDF deste lote</p>
          <p class="text-xs text-muted">Até 25 MB.</p>
          <label class="mt-3 inline-block">
            <input type="file" accept="application/pdf,.pdf" class="hidden" @change="subirPdf" >
            <span class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-inverted">
              <UIcon :name="enviandoArquivo ? 'i-lucide-loader-circle' : 'i-lucide-upload'" :class="enviandoArquivo && 'animate-spin'" />
              {{ enviandoArquivo ? 'Enviando...' : 'Escolher PDF' }}
            </span>
          </label>
        </div>

        <template v-if="arquivos?.arquivos.length">
          <USeparator label="ou reutilize um arquivo já enviado" />
          <div class="grid gap-2">
            <button
              v-for="a in arquivos.arquivos"
              :key="a.nome"
              class="flex items-center gap-3 rounded-lg border p-3 text-left transition"
              :class="arquivoNome === a.nome ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-primary/40'"
              @click="escolherExistente(a)"
            >
              <UIcon name="i-lucide-file-text" class="size-6 shrink-0 text-error" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ a.nome }}</p>
                <p class="text-xs text-muted">{{ tamanho(a.tamanho) }}</p>
              </div>
              <UIcon v-if="arquivoNome === a.nome" name="i-lucide-check-circle-2" class="size-5 text-primary" />
            </button>
          </div>
        </template>

        <UAlert
          v-if="!arquivoNome"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Nenhum arquivo selecionado"
          description="Você pode seguir sem PDF — a página mostrará apenas a confirmação de leitura."
        />
      </div>
    </UCard>

    <!-- PASSO 3 -->
    <UCard v-show="passo === 3">
      <template #header><h2 class="font-semibold">3. Conteúdo do e-mail</h2></template>

      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Partir de um template">
            <USelect
              :model-value="templateId ?? undefined"
              :items="opcoesTemplates"
              class="w-full"
              @update:model-value="aplicarTemplate($event as number)"
            />
          </UFormField>
          <UFormField label="Assunto" help="O texto editado aqui vale só para este lote.">
            <UInput v-model="assunto" class="w-full" />
          </UFormField>
        </div>

        <EditorHtml v-model="html" :assunto="assunto" />
      </div>
    </UCard>

    <!-- PASSO 4 -->
    <UCard v-show="passo === 4">
      <template #header><h2 class="font-semibold">4. Revisão e disparo</h2></template>

      <div class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Nome do lote" help="Para você identificar no relatório.">
            <UInput v-model="nomeLote" class="w-full" />
          </UFormField>
          <UFormField label="Intervalo entre os envios" help="Intervalos maiores reduzem o risco de cair em spam.">
            <USelect v-model="intervaloSegundos" :items="OPCOES_INTERVALO" class="w-full" />
          </UFormField>
        </div>

        <div class="space-y-3">
          <UCheckbox
            v-model="exigirConfirmacao"
            label="Exigir confirmação de leitura antes de liberar o download"
            help="Recomendado: garante a prova de ciência antes da entrega do arquivo."
          />
          <UCheckbox
            v-model="pedirRecibo"
            label="Pedir confirmação de leitura ao cliente de e-mail do destinatário"
            help="A maioria dos clientes ignora o pedido, e os que respeitam mostram um aviso que a pessoa pode recusar. Use só quando o atrito valer a pena."
          />
        </div>

        <div class="grid gap-3 sm:grid-cols-4">
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Destinatários</p>
            <p class="text-xl font-semibold">{{ listaProcessada.validos.length }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Intervalo</p>
            <p class="text-xl font-semibold">{{ intervaloSegundos }}s</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Duração estimada</p>
            <p class="text-xl font-semibold">{{ tempoEstimado }}</p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">Documento</p>
            <p class="truncate text-sm font-medium">{{ arquivoOriginal || 'nenhum' }}</p>
          </div>
        </div>

        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="O lote será criado como rascunho"
          description="Nada é enviado agora. Na tela seguinte você inicia o disparo e acompanha em tempo real."
        />
      </div>
    </UCard>

    <!-- Navegação -->
    <div class="flex items-center justify-between gap-3">
      <UButton
        label="Voltar"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        :disabled="passo === 1"
        @click="passo--"
      />
      <UButton
        v-if="passo < 4"
        label="Continuar"
        trailing-icon="i-lucide-arrow-right"
        :disabled="!podeAvancar"
        @click="passo++"
      />
      <UButton
        v-else
        label="Criar lote"
        icon="i-lucide-rocket"
        :loading="criando"
        :disabled="!listaProcessada.validos.length"
        @click="criarLote"
      />
    </div>
  </div>
</template>
