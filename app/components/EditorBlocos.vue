<script setup lang="ts">
import { ROTULOS_BLOCO, ICONES_BLOCO, ehBlocoFixo } from '~~/shared/types/blocos'
import type { Bloco, TipoBloco } from '~~/shared/types/blocos'

/**
 * Editor visual do e-mail.
 *
 * A pessoa monta a mensagem com peças e escreve em campos comuns; o HTML de
 * tabelas é gerado no servidor (server/utils/blocos.ts). Ninguém digita HTML,
 * então não há como quebrar a renderização no Outlook nem apagar por acidente
 * o botão de acesso ou o aviso de LGPD.
 */
const blocos = defineModel<Bloco[]>({ required: true })

const props = defineProps<{ arquivos?: { nome: string }[] }>()

const toast = useToast()
const selecionado = ref<string | null>(null)
const arrastando = ref<string | null>(null)

const VARIAVEIS = [
  { chave: '{{nome}}', desc: 'Nome do destinatário' },
  { chave: '{{empresa}}', desc: 'Empresa do destinatário' },
  { chave: '{{email}}', desc: 'E-mail do destinatário' },
  { chave: '{{codigo}}', desc: 'Código único do envio' }
]

/** Blocos que a pessoa pode acrescentar (o rodapé é fixo e já existe). */
const DISPONIVEIS: TipoBloco[] = [
  'titulo',
  'texto',
  'aviso',
  'lista',
  'botao',
  'codigo',
  'imagem',
  'separador',
  'logo'
]

const CORES_AVISO = [
  { label: 'Neutro', value: 'neutro' },
  { label: 'Atenção (amarelo)', value: 'atencao' },
  { label: 'Alerta (vermelho)', value: 'alerta' }
]

const ALINHAMENTOS = [
  { label: 'Esquerda', value: 'esquerda' },
  { label: 'Centro', value: 'centro' },
  { label: 'Direita', value: 'direita' }
]

const opcoesArquivos = computed(() =>
  (props.arquivos || []).map(a => ({ label: a.nome, value: a.nome }))
)

function novoId() {
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function criar(tipo: TipoBloco): Bloco {
  const id = novoId()
  switch (tipo) {
    case 'logo': return { id, tipo, alinhamento: 'centro' }
    case 'titulo': return { id, tipo, texto: 'Olá, {{nome}}!' }
    case 'texto': return { id, tipo, texto: 'Escreva aqui o texto do comunicado.' }
    case 'botao': return { id, tipo, texto: 'Acessar documento' }
    case 'codigo': return { id, tipo, rotulo: 'Código de referência', ajuda: 'Informe este código caso precise falar com a nossa equipe.' }
    case 'aviso': return { id, tipo, texto: 'Informação importante.', cor: 'atencao' }
    case 'lista': return { id, tipo, itens: ['Primeiro item', 'Segundo item'] }
    case 'separador': return { id, tipo }
    case 'imagem': return { id, tipo, arquivo: '', alt: '', largura: 400, alinhamento: 'centro' }
    default: return { id, tipo: 'texto', texto: '' }
  }
}

/** Acrescenta antes do rodapé: ele fecha o e-mail e não faz sentido no meio. */
function adicionar(tipo: TipoBloco) {
  const bloco = criar(tipo)
  const i = blocos.value.findIndex(b => b.tipo === 'rodape')
  const lista = [...blocos.value]
  lista.splice(i >= 0 ? i : lista.length, 0, bloco)
  blocos.value = lista
  selecionado.value = bloco.id
}

function remover(id: string) {
  const b = blocos.value.find(x => x.id === id)
  if (!b) return
  if (ehBlocoFixo(b.tipo)) {
    toast.add({
      title: 'O rodapé não pode ser removido',
      description: 'É ele que avisa o destinatário sobre o registro de acesso — exigência da LGPD. O texto você pode editar.',
      color: 'warning'
    })
    return
  }
  if (b.tipo === 'botao' && blocos.value.filter(x => x.tipo === 'botao').length === 1) {
    toast.add({
      title: 'O e-mail precisa do botão de acesso',
      description: 'É ele que leva o destinatário ao documento.',
      color: 'warning'
    })
    return
  }
  blocos.value = blocos.value.filter(x => x.id !== id)
}

function duplicar(id: string) {
  const i = blocos.value.findIndex(b => b.id === id)
  const b = blocos.value[i]
  if (!b || ehBlocoFixo(b.tipo)) return
  const copia = { ...JSON.parse(JSON.stringify(b)), id: novoId() } as Bloco
  const lista = [...blocos.value]
  lista.splice(i + 1, 0, copia)
  blocos.value = lista
  selecionado.value = copia.id
}

function mover(id: string, direcao: -1 | 1) {
  const lista = [...blocos.value]
  const i = lista.findIndex(b => b.id === id)
  const j = i + direcao
  if (i < 0 || j < 0 || j >= lista.length) return
  // o rodapé fica sempre por último; ninguém passa por cima dele
  if (ehBlocoFixo(lista[i]!.tipo) || ehBlocoFixo(lista[j]!.tipo)) return
  ;[lista[i], lista[j]] = [lista[j]!, lista[i]!]
  blocos.value = lista
}

/* ---------- arrastar para reordenar ---------- */
function aoArrastar(id: string) {
  const b = blocos.value.find(x => x.id === id)
  if (b && ehBlocoFixo(b.tipo)) return
  arrastando.value = id
}

function aoSoltarSobre(id: string) {
  const origem = arrastando.value
  arrastando.value = null
  if (!origem || origem === id) return

  const lista = [...blocos.value]
  const de = lista.findIndex(b => b.id === origem)
  const para = lista.findIndex(b => b.id === id)
  if (de < 0 || para < 0) return
  if (ehBlocoFixo(lista[de]!.tipo) || ehBlocoFixo(lista[para]!.tipo)) return

  const [movido] = lista.splice(de, 1)
  lista.splice(para, 0, movido!)
  blocos.value = lista
}

/**
 * Insere a variável na posição do cursor do campo em foco.
 *
 * Sem isso a pessoa teria que digitar as chaves duplas na mão — que é
 * exatamente o que o editor visual existe para evitar.
 */
function inserirVariavel(chave: string) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  const editavel = el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')

  if (!editavel) {
    navigator.clipboard?.writeText(chave)
    toast.add({
      title: `${chave} copiado`,
      description: 'Clique dentro de um campo de texto e cole, ou clique na variável com o campo em foco.',
      color: 'info'
    })
    return
  }

  const inicio = el.selectionStart ?? el.value.length
  const fim = el.selectionEnd ?? el.value.length
  el.value = el.value.slice(0, inicio) + chave + el.value.slice(fim)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  nextTick(() => {
    el.focus()
    const pos = inicio + chave.length
    el.setSelectionRange(pos, pos)
  })
}

/** Resumo mostrado na linha fechada do bloco. */
function resumo(b: Bloco) {
  switch (b.tipo) {
    case 'titulo':
    case 'texto':
    case 'aviso':
    case 'rodape':
      return b.texto.slice(0, 70) || '(vazio)'
    case 'botao': return b.texto
    case 'codigo': return b.rotulo
    case 'lista': return `${b.itens.filter(i => i.trim()).length} item(ns)`
    case 'imagem': return b.arquivo || '(escolha um arquivo)'
    case 'logo': return `alinhada à ${b.alinhamento}`
    default: return ''
  }
}

function atualizarItem(b: Bloco, i: number, valor: string) {
  if (b.tipo !== 'lista') return
  const itens = [...b.itens]
  itens[i] = valor
  b.itens = itens
}
</script>

<template>
  <div class="space-y-3">
    <!-- Variáveis: clique insere no campo em foco -->
    <div class="rounded-lg border border-default bg-elevated/40 p-3">
      <p class="mb-2 text-xs font-medium text-muted">
        Clique numa variável para inserir onde o cursor estiver
      </p>
      <div class="flex flex-wrap gap-2">
        <UTooltip v-for="v in VARIAVEIS" :key="v.chave" :text="v.desc">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            class="font-mono"
            :label="v.chave"
            @mousedown.prevent
            @click="inserirVariavel(v.chave)"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Blocos -->
    <div class="space-y-2">
      <div
        v-for="(b, i) in blocos"
        :key="b.id"
        class="rounded-lg border transition"
        :class="[
          selecionado === b.id ? 'border-primary ring-1 ring-primary' : 'border-default',
          arrastando === b.id ? 'opacity-40' : ''
        ]"
        :draggable="!ehBlocoFixo(b.tipo)"
        @dragstart="aoArrastar(b.id)"
        @dragend="arrastando = null"
        @dragover.prevent
        @drop.prevent="aoSoltarSobre(b.id)"
      >
        <!-- Cabeçalho da peça -->
        <div class="flex items-center gap-2 p-2">
          <UIcon
            :name="ehBlocoFixo(b.tipo) ? 'i-lucide-lock' : 'i-lucide-grip-vertical'"
            class="size-4 shrink-0 text-muted"
            :class="!ehBlocoFixo(b.tipo) && 'cursor-grab'"
          />
          <UIcon :name="ICONES_BLOCO[b.tipo]" class="size-4 shrink-0 text-primary" />

          <button class="min-w-0 flex-1 text-left" @click="selecionado = selecionado === b.id ? null : b.id">
            <span class="text-sm font-medium">{{ ROTULOS_BLOCO[b.tipo] }}</span>
            <span class="ml-2 truncate text-xs text-muted">{{ resumo(b) }}</span>
          </button>

          <UButton
            icon="i-lucide-chevron-up"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="i === 0 || ehBlocoFixo(b.tipo)"
            @click="mover(b.id, -1)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="ehBlocoFixo(b.tipo) || ehBlocoFixo(blocos[i + 1]?.tipo as any) || i === blocos.length - 1"
            @click="mover(b.id, 1)"
          />
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="ehBlocoFixo(b.tipo)"
            @click="duplicar(b.id)"
          />
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            :disabled="ehBlocoFixo(b.tipo)"
            @click="remover(b.id)"
          />
        </div>

        <!-- Campos da peça -->
        <div v-if="selecionado === b.id" class="space-y-3 border-t border-default p-3">
          <template v-if="b.tipo === 'titulo' || b.tipo === 'botao'">
            <UFormField :label="b.tipo === 'botao' ? 'Texto do botão' : 'Texto'">
              <UInput v-model="b.texto" class="w-full" />
            </UFormField>
            <p v-if="b.tipo === 'botao'" class="text-xs text-muted">
              O botão sempre leva ao documento do destinatário — o endereço é gerado pelo sistema.
            </p>
          </template>

          <UFormField v-else-if="b.tipo === 'texto'" label="Texto" help="Quebras de linha são mantidas.">
            <UTextarea v-model="b.texto" :rows="4" class="w-full" />
          </UFormField>

          <template v-else-if="b.tipo === 'aviso'">
            <UFormField label="Texto do aviso">
              <UTextarea v-model="b.texto" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="Cor">
              <USelect v-model="b.cor" :items="CORES_AVISO" class="w-full sm:w-56" />
            </UFormField>
          </template>

          <template v-else-if="b.tipo === 'lista'">
            <UFormField label="Itens">
              <div class="space-y-2">
                <div v-for="(item, j) in b.itens" :key="j" class="flex gap-2">
                  <UInput
                    :model-value="item"
                    class="w-full"
                    @update:model-value="atualizarItem(b, j, String($event))"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    @click="b.itens = b.itens.filter((_, k) => k !== j)"
                  />
                </div>
              </div>
            </UFormField>
            <UButton
              icon="i-lucide-plus"
              label="Acrescentar item"
              size="xs"
              color="neutral"
              variant="outline"
              @click="b.itens = [...b.itens, '']"
            />
          </template>

          <template v-else-if="b.tipo === 'codigo'">
            <UFormField label="Rótulo" help="O código em si é gerado pelo sistema, um por destinatário.">
              <UInput v-model="b.rotulo" class="w-full" />
            </UFormField>
            <UFormField label="Texto de apoio">
              <UInput v-model="b.ajuda" class="w-full" />
            </UFormField>
          </template>

          <template v-else-if="b.tipo === 'imagem'">
            <UFormField label="Arquivo" help="Precisa estar em public/brand para ser acessível pela internet.">
              <USelect v-model="b.arquivo" :items="opcoesArquivos" class="w-full" />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField label="Texto alternativo">
                <UInput v-model="b.alt" class="w-full" />
              </UFormField>
              <UFormField label="Largura (px)">
                <UInput v-model.number="b.largura" type="number" min="40" max="600" class="w-full" />
              </UFormField>
              <UFormField label="Alinhamento">
                <USelect v-model="b.alinhamento" :items="ALINHAMENTOS" class="w-full" />
              </UFormField>
            </div>
          </template>

          <UFormField v-else-if="b.tipo === 'logo'" label="Alinhamento">
            <USelect v-model="b.alinhamento" :items="ALINHAMENTOS" class="w-full sm:w-56" />
          </UFormField>

          <template v-else-if="b.tipo === 'rodape'">
            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-shield-check"
              title="Este bloco não pode ser removido"
              description="É ele que informa ao destinatário que o acesso é registrado — a base legal do rastreamento. O texto você pode ajustar."
            />
            <UFormField label="Texto do aviso">
              <UTextarea v-model="b.texto" :rows="4" class="w-full" />
            </UFormField>
          </template>

          <p v-else-if="b.tipo === 'separador'" class="text-sm text-muted">
            Linha horizontal. Não tem o que configurar.
          </p>
        </div>
      </div>
    </div>

    <!-- Acrescentar peça -->
    <div class="rounded-lg border border-dashed border-default p-3">
      <p class="mb-2 text-xs font-medium text-muted">Acrescentar bloco</p>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="t in DISPONIVEIS"
          :key="t"
          size="xs"
          color="neutral"
          variant="outline"
          :icon="ICONES_BLOCO[t]"
          :label="ROTULOS_BLOCO[t]"
          @click="adicionar(t)"
        />
      </div>
    </div>
  </div>
</template>
