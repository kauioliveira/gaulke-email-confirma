<script setup lang="ts">
import type { Bloco, FormatoTemplate } from '~~/shared/types/blocos'
import { SETORES } from '~/utils/galeria'
import { variaveisDesconhecidas } from '~/utils/variaveis'

/**
 * Templates de e-mail.
 *
 * Template NOVO nasce pelo assistente (tipo → ponto de partida → nome →
 * conteúdo → teste). Template existente abre direto no editor.
 *
 * Template OFICIAL só é editado por supervisor/admin; os demais usam
 * "Duplicar". O servidor confere tudo — a tela só evita o clique inútil.
 *
 * Cada template é de um setor (ou de todos); fora o admin, aparecem só os do
 * próprio setor e os de todos.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Templates — Gaulke Comunica' })

const route = useRoute()
const toast = useToast()
const { sessao, eSupervisor } = usePapel()
const setores = useDepartamentos()

/* ---------- lista ---------- */
const filtro = reactive({ busca: '', categoria: 'todas', arquivados: false })
const { data, refresh } = await useFetch<RespostaTemplates>(api('/api/admin/templates'), {
  query: computed(() => ({ arquivados: filtro.arquivados ? '1' : undefined }))
})

const opcoesCategoria = computed(() => [
  { label: 'Todas as categorias', value: 'todas' },
  ...[...new Set([...(data.value?.categorias ?? [])])].map(c => ({ label: c, value: c })),
  { label: 'Sem categoria', value: 'sem' }
])

const lista = computed(() => {
  const b = filtro.busca.trim().toLowerCase()
  return (data.value?.templates ?? []).filter(t => {
    if (filtro.categoria === 'sem' && t.categoria) return false
    if (filtro.categoria !== 'todas' && filtro.categoria !== 'sem' && t.categoria !== filtro.categoria) return false
    return !b || t.nome.toLowerCase().includes(b) || t.assunto.toLowerCase().includes(b)
  })
})

/* ---------- imagens do bloco de imagem ---------- */
const { data: brand, refresh: recarregarImagens } = await useFetch<{
  arquivos: { nome: string; caminho: string; origem: 'sistema' | 'enviada' }[]
}>(api('/api/admin/imagens'), { lazy: true, server: false })
const arquivosBrand = computed(() => brand.value?.arquivos || [])

/* ---------- modo: assistente (novo) ou editor (existente) ---------- */
const modo = ref<'assistente' | 'editor' | 'vazio'>('vazio')
const selecionadoId = ref<number | null>(null)
const selecionado = computed(() => data.value?.templates.find(t => t.id === selecionadoId.value) ?? null)

const form = reactive({
  nome: '',
  assunto: '',
  html: '',
  formato: 'blocos' as FormatoTemplate,
  blocos: [] as Bloco[],
  tipo: 'documento' as TipoTemplate,
  categoria: '',
  oficial: false,
  setor: 'todos'
})
/** foto do formulário ao abrir, para saber se há alteração não salva */
const original = ref('')
const foto = () => JSON.stringify(form)
const sujo = computed(() => modo.value === 'editor' && foto() !== original.value)

function confirmarSaida() {
  return !sujo.value || confirm('Há alterações não salvas neste template. Descartar?')
}

function carregar(t: Template) {
  if (t.id !== selecionadoId.value && !confirmarSaida()) return
  selecionadoId.value = t.id
  Object.assign(form, {
    nome: t.nome,
    assunto: t.assunto,
    html: t.html,
    // templates antigos (escritos à mão) continuam em HTML
    formato: t.formato === 'blocos' ? 'blocos' : 'html',
    blocos: Array.isArray(t.blocos) && t.blocos.length ? (JSON.parse(JSON.stringify(t.blocos)) as Bloco[]) : blocosPadraoCliente(),
    tipo: t.tipo ?? 'documento',
    categoria: t.categoria ?? '',
    oficial: t.oficial,
    setor: setores.paraValor(t.departamentoId)
  })
  original.value = foto()
  modo.value = 'editor'
}

function novo() {
  if (!confirmarSaida()) return
  selecionadoId.value = null
  modo.value = 'assistente'
}

async function aoCriar(id: number) {
  await refresh()
  const t = data.value?.templates.find(x => x.id === id)
  if (t) { original.value = ''; selecionadoId.value = null; carregar(t) }
}

// ?novo=1 abre o assistente direto; senão, o primeiro da lista
if (route.query.novo) modo.value = 'assistente'
else if (data.value?.templates.length) carregar(data.value.templates[0]!)
else modo.value = 'assistente'

/* ---------- regras da tela ---------- */
const somenteLeitura = computed(() => !!selecionado.value?.oficial && !eSupervisor.value)
const desconhecidas = computed(() =>
  variaveisDesconhecidas(form.assunto, form.formato === 'blocos' ? form.blocos : null, form.formato === 'html' ? form.html : undefined)
)
const faltaBotao = computed(
  () => form.tipo === 'documento' && form.formato === 'blocos' && !form.blocos.some(b => b.tipo === 'botao')
)
const categoriasSugeridas = computed(() => [...new Set([...SETORES, ...(data.value?.categorias ?? [])])])

/* ---------- salvar ---------- */
const salvando = ref(false)
async function salvar() {
  const temConteudo = form.formato === 'blocos' ? form.blocos.length > 0 : !!form.html
  if (!form.nome || !form.assunto || !temConteudo) {
    return toast.add({ title: 'Preencha nome, assunto e o conteúdo do e-mail', color: 'warning' })
  }
  if (faltaBotao.value) {
    return toast.add({
      title: 'Falta o botão de acesso',
      description: 'Template de documento precisa do botão que leva ao arquivo. Se for só um aviso, mude o tipo para Comunicado.',
      color: 'warning'
    })
  }
  if (!selecionadoId.value) return
  salvando.value = true
  try {
    const r = await $fetch<{ versao: number }>(api(`/api/admin/templates/${selecionadoId.value}`), {
      method: 'PUT',
      body: {
        ...form,
        setor: undefined,
        departamentoId: setores.paraId(form.setor),
        categoria: form.categoria || null,
        oficial: eSupervisor.value ? form.oficial : undefined
      }
    })
    original.value = foto()
    await refresh()
    toast.add({ title: `Template salvo (versão ${r.versao})`, icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Erro ao salvar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

/* ---------- teste ---------- */
const emailTeste = ref('')
watchEffect(() => { if (!emailTeste.value && sessao.value?.usuario?.email) emailTeste.value = sessao.value.usuario.email })
const enviandoTeste = ref(false)
async function enviarTeste() {
  if (!emailTeste.value) return
  enviandoTeste.value = true
  try {
    await $fetch(api('/api/admin/teste'), {
      method: 'POST',
      body: {
        para: emailTeste.value,
        assunto: form.assunto,
        // em modo visual o servidor gera o HTML pelos blocos, igual ao envio real
        ...(form.formato === 'blocos' ? { blocos: form.blocos } : { html: form.html })
      }
    })
    toast.add({ title: 'E-mail de teste enviado', description: `Confira a caixa de ${emailTeste.value} (e o spam).`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Falha no envio de teste', description: e?.statusMessage, color: 'error' })
  } finally {
    enviandoTeste.value = false
  }
}

/* ---------- duplicar, arquivar, versões, excluir ---------- */
async function duplicar() {
  if (!selecionado.value) return
  try {
    const r = await $fetch<{ template: { id: number } }>(api(`/api/admin/templates/${selecionado.value.id}/duplicar`), { method: 'POST' })
    toast.add({ title: 'Cópia criada', description: 'Você já está editando a cópia.', color: 'success' })
    original.value = foto() // a cópia é outra; o que estava aberto não se perde por isso
    await aoCriar(r.template.id)
  } catch (e: any) {
    toast.add({ title: 'Não foi possível duplicar', description: e?.statusMessage, color: 'error' })
  }
}

async function alternarArquivo() {
  const t = selecionado.value
  if (!t) return
  try {
    await $fetch(api(`/api/admin/templates/${t.id}/arquivar`), { method: 'POST', body: { arquivar: !t.arquivadoEm } })
    toast.add({ title: t.arquivadoEm ? 'Template de volta à lista' : 'Template arquivado', color: 'success' })
    if (!t.arquivadoEm && !filtro.arquivados) { modo.value = 'vazio'; selecionadoId.value = null }
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível alterar', description: e?.statusMessage, color: 'error' })
  }
}

const modalVersoes = ref(false)
const modalExcluir = ref(false)
async function aposRestaurar() {
  await refresh()
  const t = selecionado.value
  if (t) { original.value = ''; const id = t.id; selecionadoId.value = null; carregar(data.value!.templates.find(x => x.id === id)!) }
}
async function aposRemover() {
  selecionadoId.value = null
  modo.value = 'vazio'
  await refresh()
}

const acoesMenu = computed(() => {
  const t = selecionado.value
  if (!t) return []
  const podeMexer = !t.oficial || eSupervisor.value
  return [
    [
      { label: 'Duplicar', icon: 'i-lucide-copy', onSelect: duplicar },
      { label: 'Histórico de versões', icon: 'i-lucide-history', onSelect: () => { modalVersoes.value = true } }
    ],
    podeMexer
      ? [
          {
            label: t.arquivadoEm ? 'Desarquivar' : 'Arquivar',
            icon: t.arquivadoEm ? 'i-lucide-archive-restore' : 'i-lucide-archive',
            onSelect: alternarArquivo
          },
          { label: 'Excluir…', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { modalExcluir.value = true } }
        ]
      : []
  ]
})

onBeforeRouteLeave(() => confirmarSaida())
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Templates de e-mail</h1>
        <p class="text-sm text-muted">Modelos prontos para os envios. Monte com blocos e veja exatamente como o cliente vai receber.</p>
      </div>
      <UButton icon="i-lucide-file-plus" label="Novo template" @click="novo" />
    </div>

    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <!-- Lista lateral -->
      <div class="space-y-3">
        <UInput v-model="filtro.busca" icon="i-lucide-search" placeholder="Buscar template" class="w-full" />
        <USelect v-model="filtro.categoria" :items="opcoesCategoria" class="w-full" />
        <USwitch v-model="filtro.arquivados" label="Mostrar arquivados" size="sm" />

        <UCard
          v-for="t in lista"
          :key="t.id"
          class="cursor-pointer transition"
          :class="[selecionadoId === t.id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40', t.arquivadoEm && 'opacity-60']"
          :ui="{ body: 'p-3 sm:p-3' }"
          @click="carregar(t)"
        >
          <div class="space-y-1">
            <div class="flex items-start gap-1.5">
              <UIcon
                :name="t.tipo === 'comunicado' ? 'i-lucide-megaphone' : 'i-lucide-file-text'"
                class="mt-0.5 size-4 shrink-0 text-primary"
              />
              <p class="min-w-0 flex-1 truncate text-sm font-medium">{{ t.nome }}</p>
              <UTooltip v-if="t.oficial" text="Template oficial: só supervisores e administradores editam">
                <UIcon name="i-lucide-lock" class="size-3.5 text-warning" />
              </UTooltip>
            </div>
            <p class="truncate text-xs text-muted">{{ t.assunto }}</p>
            <div class="flex flex-wrap items-center gap-1">
              <UBadge v-if="t.categoria" :label="t.categoria" color="neutral" variant="subtle" size="xs" />
              <UBadge v-if="t.departamentoNome" :label="t.departamentoNome" color="primary" variant="subtle" size="xs" icon="i-lucide-building-2" />
              <UBadge v-if="t.arquivadoEm" label="arquivado" color="neutral" variant="outline" size="xs" icon="i-lucide-archive" />
              <span class="text-xs text-muted">
                {{ t.usos ? `usado em ${t.usos} envio(s)` : 'nunca usado' }}
              </span>
            </div>
          </div>
        </UCard>
        <p v-if="!lista.length" class="py-6 text-center text-sm text-muted">Nenhum template encontrado.</p>
      </div>

      <!-- Assistente -->
      <AssistenteTemplate
        v-if="modo === 'assistente'"
        :arquivos="arquivosBrand"
        :categorias="data?.categorias"
        @criado="aoCriar"
        @cancelar="data?.templates.length ? carregar(data.templates[0]!) : (modo = 'vazio')"
        @imagem-enviada="recarregarImagens"
      />

      <!-- Editor -->
      <UCard v-else-if="modo === 'editor' && selecionado">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :icon="form.tipo === 'comunicado' ? 'i-lucide-megaphone' : 'i-lucide-file-text'"
                :label="form.tipo === 'comunicado' ? 'Comunicado' : 'Documento para ciência'"
                color="primary"
                variant="subtle"
              />
              <UBadge v-if="selecionado.oficial" icon="i-lucide-lock" label="oficial" color="warning" variant="subtle" />
              <UBadge v-if="sujo" label="alterações não salvas" color="warning" variant="outline" />
            </div>
            <div class="flex items-center gap-1 text-xs text-muted">
              <span v-if="selecionado.atualizadoPorNome">
                Editado por {{ selecionado.atualizadoPorNome }} em {{ formatarDataHora(selecionado.updatedAt) }}
              </span>
              <UDropdownMenu :items="acoesMenu">
                <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="sm" aria-label="Mais ações" />
              </UDropdownMenu>
            </div>
          </div>

          <UAlert
            v-if="somenteLeitura"
            color="warning"
            variant="subtle"
            icon="i-lucide-lock"
            title="Template oficial"
            description="Só supervisores e administradores editam este template. Para usar como base, duplique-o: a cópia é sua."
            :actions="[{ label: 'Duplicar', icon: 'i-lucide-copy', onClick: duplicar }]"
          />
          <UAlert
            v-if="selecionado.arquivadoEm"
            color="neutral"
            variant="subtle"
            icon="i-lucide-archive"
            title="Template arquivado"
            description="Ele não aparece na lista padrão nem no novo envio."
            :actions="!somenteLeitura ? [{ label: 'Desarquivar', onClick: alternarArquivo }] : []"
          />

          <fieldset :disabled="somenteLeitura" class="space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Nome do template">
                <UInput v-model="form.nome" class="w-full" />
              </UFormField>
              <UFormField label="Assunto do e-mail" help="É o que o cliente vê na caixa de entrada.">
                <UInput v-model="form.assunto" class="w-full" />
              </UFormField>
            </div>
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <UFormField label="Tipo">
                <USelect
                  v-model="form.tipo"
                  :items="[
                    { label: 'Documento para ciência', value: 'documento' },
                    { label: 'Comunicado (sem arquivo)', value: 'comunicado' }
                  ]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Categoria">
                <UInput v-model="form.categoria" class="w-full" placeholder="Ex.: Fiscal" list="gk-categorias" />
                <datalist id="gk-categorias">
                  <option v-for="c in categoriasSugeridas" :key="c" :value="c" />
                </datalist>
              </UFormField>
              <UFormField label="Setor" help="Quem vê este template. O administrador vê todos.">
                <USelect v-model="form.setor" :items="setores.opcoes.value" class="w-full" />
              </UFormField>
              <UFormField v-if="eSupervisor" label="Oficial" help="Só supervisores e administradores editam.">
                <USwitch v-model="form.oficial" :label="form.oficial ? 'Sim' : 'Não'" />
              </UFormField>
            </div>

            <EditorEmail
              v-model:formato="form.formato"
              v-model:blocos="form.blocos"
              v-model:html="form.html"
              :assunto="form.assunto"
              :arquivos="arquivosBrand"
              :exige-botao="form.tipo === 'documento'"
              @imagem-enviada="recarregarImagens"
            />
          </fieldset>

          <UAlert
            v-if="faltaBotao"
            color="error"
            variant="subtle"
            icon="i-lucide-mouse-pointer-click"
            title="Falta o botão de acesso"
            description="Template de documento precisa do botão que leva o cliente ao arquivo. Adicione o bloco “Botão de acesso”, ou mude o tipo para Comunicado."
          />
          <UAlert
            v-if="desconhecidas.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-braces"
            title="Dados personalizados que o sistema não conhece"
            :description="`${desconhecidas.map(v => `{{${v}}}`).join(', ')} só será(ão) preenchido(s) se a planilha do envio tiver uma coluna com esse nome. Sem ela, aparece(m) assim, com as chaves, no e-mail do cliente.`"
          />

          <USeparator />

          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Enviar teste para" class="min-w-[240px] flex-1" help="Antes de disparar para muitos, confira como chega.">
              <UInput v-model="emailTeste" type="email" placeholder="voce@contabilgaulke.com.br" class="w-full" />
            </UFormField>
            <UButton
              label="Enviar teste"
              icon="i-lucide-send-horizontal"
              color="neutral"
              variant="outline"
              :loading="enviandoTeste"
              :disabled="!emailTeste"
              @click="enviarTeste"
            />
            <UButton
              label="Salvar template"
              icon="i-lucide-save"
              :loading="salvando"
              :disabled="somenteLeitura || !sujo"
              @click="salvar"
            />
          </div>
        </div>
      </UCard>

      <UCard v-else>
        <div class="space-y-3 py-12 text-center">
          <UIcon name="i-lucide-layout-template" class="mx-auto size-10 text-muted" />
          <p class="font-medium">Escolha um template na lista ou crie um novo</p>
          <UButton icon="i-lucide-file-plus" label="Novo template" @click="novo" />
        </div>
      </UCard>
    </div>

    <ModalVersoesTemplate
      v-model:open="modalVersoes"
      :template="selecionado"
      :pode-restaurar="!somenteLeitura"
      @restaurado="aposRestaurar"
    />
    <ModalExcluirTemplate
      v-model:open="modalExcluir"
      :template="selecionado"
      @excluido="aposRemover"
      @arquivado="aposRemover"
    />
  </div>
</template>
