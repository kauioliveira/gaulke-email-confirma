<script setup lang="ts">
import type { Bloco } from '~~/shared/types/blocos'
import { GALERIA, SETORES, ASSUNTOS_SUGERIDOS, blocosEmBranco, type ModeloGaleria } from '~/utils/galeria'
import { variaveisDesconhecidas } from '~/utils/variaveis'

/**
 * Assistente de criação de template, por fases (item 8 do briefing).
 *
 * A primeira pergunta é a que mais confundia: "vai com documento ou é só um
 * comunicado?". Respondida ela, o resto se adapta — pontos de partida,
 * assuntos sugeridos, e se o botão de acesso é obrigatório.
 *
 * O progresso fica salvo no navegador (rascunho): fechar a aba no meio não
 * perde o trabalho.
 */
const props = defineProps<{
  arquivos?: { nome: string; caminho: string; origem?: 'sistema' | 'enviada' }[]
  categorias?: string[]
}>()
const emit = defineEmits<{ criado: [id: number]; cancelar: []; imagemEnviada: [] }>()

const toast = useToast()
const { sessao } = usePapel()

const PASSOS = [
  { n: 1, titulo: 'Tipo', icone: 'i-lucide-shapes' },
  { n: 2, titulo: 'Ponto de partida', icone: 'i-lucide-layout-template' },
  { n: 3, titulo: 'Identificação', icone: 'i-lucide-tag' },
  { n: 4, titulo: 'Conteúdo', icone: 'i-lucide-pencil-line' },
  { n: 5, titulo: 'Revisar e salvar', icone: 'i-lucide-check-check' }
]

const passo = ref(1)
const estado = reactive({
  tipo: null as TipoTemplate | null,
  modeloId: null as string | null,
  nome: '',
  categoria: '',
  assunto: '',
  blocos: [] as Bloco[]
})
const html = ref('')
const formato = ref<'blocos' | 'html'>('blocos')

/* ---------- rascunho no navegador ---------- */
const CHAVE_RASCUNHO = 'gk:rascunho-template'
type Rascunho = { passo: number; estado: typeof estado; salvoEm: string }
const rascunhoAnterior = ref<Rascunho | null>(null)

onMounted(() => {
  try {
    const bruto = localStorage.getItem(CHAVE_RASCUNHO)
    if (!bruto) return
    const r = JSON.parse(bruto) as Rascunho
    // rascunho velho demais vira lixo: some sozinho depois de 7 dias
    if (Date.now() - new Date(r.salvoEm).getTime() > 7 * 86400000) localStorage.removeItem(CHAVE_RASCUNHO)
    else if (r.estado?.tipo) rascunhoAnterior.value = r
  } catch { /* sem storage (janela privada): segue sem rascunho */ }
})

let esperaRascunho: ReturnType<typeof setTimeout> | undefined
watch(
  () => [passo.value, JSON.stringify(estado)],
  () => {
    if (!estado.tipo || rascunhoAnterior.value) return
    clearTimeout(esperaRascunho)
    esperaRascunho = setTimeout(() => {
      try {
        localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ passo: passo.value, estado, salvoEm: new Date().toISOString() }))
      } catch { /* sem storage: ok */ }
    }, 600)
  }
)

function continuarRascunho() {
  const r = rascunhoAnterior.value
  if (!r) return
  Object.assign(estado, r.estado)
  passo.value = r.passo
  rascunhoAnterior.value = null
}
function descartarRascunho() {
  rascunhoAnterior.value = null
  try { localStorage.removeItem(CHAVE_RASCUNHO) } catch { /* ok */ }
}

/* ---------- passo 1: tipo ---------- */
function escolherTipo(t: TipoTemplate) {
  if (estado.tipo !== t) {
    estado.modeloId = null
    estado.blocos = []
  }
  estado.tipo = t
  passo.value = 2
}

/* ---------- passo 2: ponto de partida ---------- */
const setorFiltro = ref<string>('Todos')
const modelosDoTipo = computed(() =>
  GALERIA.filter(m => m.tipo === estado.tipo && (setorFiltro.value === 'Todos' || m.setor === setorFiltro.value))
)
const setoresComModelo = computed(() => ['Todos', ...SETORES.filter(s => GALERIA.some(m => m.tipo === estado.tipo && m.setor === s))])

function escolherModelo(m: ModeloGaleria | null) {
  estado.modeloId = m?.id ?? 'branco'
  estado.blocos = m ? m.blocos() : blocosEmBranco(estado.tipo!)
  // os campos só são preenchidos se ainda estiverem vazios: voltar e trocar de
  // modelo não apaga o que a pessoa já digitou
  if (!estado.nome) estado.nome = m?.titulo ?? ''
  if (!estado.categoria) estado.categoria = m?.setor ?? ''
  if (!estado.assunto) estado.assunto = m?.assunto ?? ASSUNTOS_SUGERIDOS[estado.tipo!][0]!
  passo.value = 3
}

/* ---------- passo 3: identificação ---------- */
const categoriasSugeridas = computed(() => [...new Set([...SETORES, ...(props.categorias ?? [])])])

/* ---------- passo 5: revisão ---------- */
const temBotao = computed(() => estado.blocos.some(b => b.tipo === 'botao'))
const desconhecidas = computed(() => variaveisDesconhecidas(estado.assunto, estado.blocos))
const verificacoes = computed(() => [
  { ok: !!estado.nome.trim(), rotulo: 'Nome do template preenchido', obrigatorio: true },
  { ok: !!estado.assunto.trim(), rotulo: 'Assunto do e-mail preenchido', obrigatorio: true },
  {
    ok: temBotao.value,
    rotulo:
      estado.tipo === 'documento'
        ? 'Botão de acesso ao documento'
        : 'Botão "Confirmar recebimento" (recomendado: é a prova de que o cliente recebeu)',
    obrigatorio: estado.tipo === 'documento'
  },
  {
    ok: estado.blocos.some(b => 'texto' in b && typeof b.texto === 'string' && b.texto.includes('{{nome}}')),
    rotulo: 'Saudação com o nome do cliente',
    obrigatorio: false
  },
  {
    ok: !desconhecidas.value.length,
    rotulo: desconhecidas.value.length
      ? `Dados que o sistema não conhece: ${desconhecidas.value.map(v => `{{${v}}}`).join(', ')} — só funcionam se a planilha tiver coluna com esse nome`
      : 'Todos os dados personalizados são conhecidos',
    obrigatorio: false
  }
])
const podeSalvar = computed(() => verificacoes.value.every(v => v.ok || !v.obrigatorio))

const podeAvancar = computed(() => {
  if (passo.value === 1) return !!estado.tipo
  if (passo.value === 2) return estado.blocos.length > 0
  if (passo.value === 3) return !!estado.nome.trim() && !!estado.assunto.trim()
  if (passo.value === 4) return estado.blocos.length > 0
  return true
})

function irPara(n: number) {
  // só volta, ou avança para passos já liberados
  if (n < passo.value || (n === passo.value + 1 && podeAvancar.value)) passo.value = n
}

/* ---------- teste e salvar ---------- */
const emailTeste = ref('')
watchEffect(() => { if (!emailTeste.value && sessao.value?.usuario?.email) emailTeste.value = sessao.value.usuario.email })
const enviandoTeste = ref(false)
const salvando = ref(false)

async function enviarTeste() {
  if (!emailTeste.value) return
  enviandoTeste.value = true
  try {
    await $fetch(api('/api/admin/teste'), {
      method: 'POST',
      body: { para: emailTeste.value, assunto: estado.assunto, blocos: estado.blocos }
    })
    toast.add({ title: 'E-mail de teste enviado', description: `Confira a caixa de ${emailTeste.value} (e o spam).`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Falha no envio de teste', description: e?.statusMessage, color: 'error' })
  } finally {
    enviandoTeste.value = false
  }
}

async function salvar() {
  salvando.value = true
  try {
    const r = await $fetch<{ template: { id: number } }>(api('/api/admin/templates'), {
      method: 'POST',
      body: {
        nome: estado.nome,
        assunto: estado.assunto,
        formato: 'blocos',
        blocos: estado.blocos,
        tipo: estado.tipo,
        categoria: estado.categoria || null
      }
    })
    descartarRascunho()
    toast.add({ title: 'Template criado', icon: 'i-lucide-check', color: 'success' })
    emit('criado', r.template.id)
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

function cancelar() {
  if (estado.tipo && !confirm('Sair do assistente? O rascunho fica guardado neste navegador por 7 dias.')) return
  emit('cancelar')
}
</script>

<template>
  <UCard>
    <div class="space-y-5">
      <!-- rascunho de uma sessão anterior -->
      <UAlert
        v-if="rascunhoAnterior"
        color="info"
        variant="subtle"
        icon="i-lucide-history"
        :title="`Você tem um template começado em ${formatarDataHora(rascunhoAnterior.salvoEm)}`"
        :description="rascunhoAnterior.estado.nome || 'Sem nome ainda'"
        :actions="[
          { label: 'Continuar de onde parei', onClick: continuarRascunho },
          { label: 'Começar do zero', color: 'neutral', variant: 'ghost', onClick: descartarRascunho }
        ]"
      />

      <!-- trilha -->
      <div class="flex flex-wrap items-center gap-2">
        <template v-for="(p, i) in PASSOS" :key="p.n">
          <button
            type="button"
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
            :class="passo === p.n ? 'bg-primary text-inverted' : passo > p.n ? 'text-primary hover:bg-primary/10' : 'text-muted'"
            @click="irPara(p.n)"
          >
            <UIcon :name="passo > p.n ? 'i-lucide-check-circle-2' : p.icone" class="size-4" />
            <span class="hidden sm:inline">{{ p.titulo }}</span>
          </button>
          <UIcon v-if="i < PASSOS.length - 1" name="i-lucide-chevron-right" class="size-4 text-muted" />
        </template>
      </div>

      <!-- 1. Tipo -->
      <div v-if="passo === 1" class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold">O que você vai enviar?</h2>
          <p class="text-sm text-muted">Essa escolha ajusta o resto: modelos, assunto e o que o e-mail precisa ter.</p>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <button
            v-for="op in [
              { tipo: 'documento', icone: 'i-lucide-file-text', titulo: 'Documento para ciência', texto: 'O cliente recebe um link, confirma a leitura e baixa um arquivo (guia, contrato, holerite, balancete…).', exemplo: 'Ex.: guia de impostos do mês' },
              { tipo: 'comunicado', icone: 'i-lucide-megaphone', titulo: 'Comunicado', texto: 'Só um aviso, sem arquivo. Dá para saber quem recebeu e quem confirmou o recebimento.', exemplo: 'Ex.: feriado, prazo, lembrete' }
            ] as const"
            :key="op.tipo"
            type="button"
            class="flex items-start gap-4 rounded-xl border p-5 text-left transition hover:border-primary hover:bg-primary/5"
            :class="estado.tipo === op.tipo ? 'border-primary ring-1 ring-primary' : 'border-default'"
            @click="escolherTipo(op.tipo)"
          >
            <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <UIcon :name="op.icone" class="size-6 text-primary" />
            </span>
            <span class="space-y-1">
              <span class="block text-base font-semibold">{{ op.titulo }}</span>
              <span class="block text-sm text-muted">{{ op.texto }}</span>
              <span class="block text-xs text-muted/80">{{ op.exemplo }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 2. Ponto de partida -->
      <div v-else-if="passo === 2" class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold">Por onde começar?</h2>
          <p class="text-sm text-muted">Escolha um modelo pronto e ajuste, ou comece com o básico.</p>
        </div>
        <div v-if="setoresComModelo.length > 2" class="flex flex-wrap gap-2">
          <UButton
            v-for="s in setoresComModelo"
            :key="s"
            size="xs"
            :label="s"
            :color="setorFiltro === s ? 'primary' : 'neutral'"
            :variant="setorFiltro === s ? 'soft' : 'outline'"
            @click="setorFiltro = s"
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            class="flex flex-col gap-2 rounded-xl border border-dashed p-4 text-left transition hover:border-primary hover:bg-primary/5"
            :class="estado.modeloId === 'branco' ? 'border-primary ring-1 ring-primary' : 'border-default'"
            @click="escolherModelo(null)"
          >
            <UIcon name="i-lucide-file-plus-2" class="size-6 text-primary" />
            <span class="font-semibold">Começar do básico</span>
            <span class="text-sm text-muted">
              {{ estado.tipo === 'documento' ? 'Saudação, texto, botão de acesso e código.' : 'Saudação, texto e botão "Confirmar recebimento".' }}
            </span>
          </button>
          <button
            v-for="m in modelosDoTipo"
            :key="m.id"
            type="button"
            class="flex flex-col gap-2 rounded-xl border p-4 text-left transition hover:border-primary hover:bg-primary/5"
            :class="estado.modeloId === m.id ? 'border-primary ring-1 ring-primary' : 'border-default'"
            @click="escolherModelo(m)"
          >
            <UBadge :label="m.setor" color="neutral" variant="subtle" size="xs" class="self-start" />
            <span class="font-semibold">{{ m.titulo }}</span>
            <span class="text-sm text-muted">{{ m.descricao }}</span>
          </button>
        </div>
      </div>

      <!-- 3. Identificação -->
      <div v-else-if="passo === 3" class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold">Como este template vai se chamar?</h2>
          <p class="text-sm text-muted">O nome e a categoria são para você e sua equipe acharem o template depois.</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Nome do template" required>
            <UInput v-model="estado.nome" class="w-full" placeholder="Ex.: Guia DAS mensal" autofocus />
          </UFormField>
          <UFormField label="Categoria (setor)">
            <UInput v-model="estado.categoria" class="w-full" placeholder="Ex.: Fiscal" />
            <div class="mt-2 flex flex-wrap gap-1">
              <UButton
                v-for="c in categoriasSugeridas"
                :key="c"
                size="xs"
                :label="c"
                :color="estado.categoria === c ? 'primary' : 'neutral'"
                :variant="estado.categoria === c ? 'soft' : 'ghost'"
                @click="estado.categoria = c"
              />
            </div>
          </UFormField>
        </div>
        <UFormField label="Assunto do e-mail" required help="É o que o cliente vê na caixa de entrada. Pode usar os dados personalizados.">
          <UInput v-model="estado.assunto" class="w-full" />
          <div class="mt-2 flex flex-wrap gap-1">
            <span class="text-xs text-muted">Sugestões:</span>
            <UButton
              v-for="a in ASSUNTOS_SUGERIDOS[estado.tipo!]"
              :key="a"
              size="xs"
              color="neutral"
              variant="ghost"
              :label="a"
              @click="estado.assunto = a"
            />
          </div>
        </UFormField>
      </div>

      <!-- 4. Conteúdo -->
      <div v-else-if="passo === 4" class="space-y-3">
        <div>
          <h2 class="text-lg font-semibold">Monte o e-mail</h2>
          <p class="text-sm text-muted">Clique num bloco para editar. Use "Ver como fica" para conferir o resultado.</p>
        </div>
        <EditorEmail
          v-model:formato="formato"
          v-model:blocos="estado.blocos"
          v-model:html="html"
          :assunto="estado.assunto"
          :arquivos="arquivos"
          :exige-botao="estado.tipo === 'documento'"
          @imagem-enviada="emit('imagemEnviada')"
        />
      </div>

      <!-- 5. Revisar e salvar -->
      <div v-else class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold">Revisar e salvar</h2>
          <p class="text-sm text-muted">Confira os pontos abaixo e mande um teste para você antes de salvar.</p>
        </div>
        <ul class="space-y-2">
          <li v-for="v in verificacoes" :key="v.rotulo" class="flex items-start gap-2 text-sm">
            <UIcon
              :name="v.ok ? 'i-lucide-circle-check' : v.obrigatorio ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
              class="mt-0.5 size-4 shrink-0"
              :class="v.ok ? 'text-success' : v.obrigatorio ? 'text-error' : 'text-warning'"
            />
            <span :class="!v.ok && v.obrigatorio && 'text-error'">{{ v.rotulo }}</span>
          </li>
        </ul>
        <div class="grid gap-2 rounded-lg border border-default p-3 text-sm sm:grid-cols-3">
          <p><span class="text-muted">Tipo:</span> {{ estado.tipo === 'documento' ? 'Documento para ciência' : 'Comunicado' }}</p>
          <p><span class="text-muted">Nome:</span> {{ estado.nome }}</p>
          <p><span class="text-muted">Categoria:</span> {{ estado.categoria || '—' }}</p>
          <p class="sm:col-span-3"><span class="text-muted">Assunto:</span> {{ estado.assunto }}</p>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Enviar teste para" class="min-w-[240px] flex-1" help="Chega com [TESTE] no assunto e dados de exemplo.">
            <UInput v-model="emailTeste" type="email" class="w-full" />
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
        </div>
      </div>

      <!-- navegação -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-4">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="cancelar" />
        <div class="flex gap-2">
          <UButton v-if="passo > 1" label="Voltar" icon="i-lucide-arrow-left" color="neutral" variant="outline" @click="passo--" />
          <UButton
            v-if="passo >= 3 && passo < 5"
            label="Continuar"
            trailing-icon="i-lucide-arrow-right"
            :disabled="!podeAvancar"
            @click="passo++"
          />
          <UButton
            v-if="passo === 5"
            label="Salvar template"
            icon="i-lucide-save"
            :loading="salvando"
            :disabled="!podeSalvar"
            @click="salvar"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
