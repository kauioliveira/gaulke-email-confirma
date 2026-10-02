<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { FAMILIAS_SOLICITACAO, acceptDe, descreverFamilias, TIPOS_ANEXO } from '~~/shared/types/tipos-arquivo'
import {
  TIPOS_ITEM_SOLIC,
  LIMITES_ITEM,
  novoItemSolic,
  normalizarConfig,
  rotuloTipoItem,
  iconeTipoItem,
  descreverConfig,
  classesInformativo
} from '~~/shared/utils/itens-solic'

/**
 * Itens pedidos ao cliente. Cada item tem um tipo:
 *   documento   o cliente envia arquivo(s) — formatos, quantidade e modelo
 *   texto, escolha, campos (e-mail, CPF/CNPJ, data, valor...) e declaração
 *               o cliente responde na própria página
 * Todos podem ser obrigatórios ou opcionais. Serve à solicitação e ao modelo
 * de checklist, que têm os mesmos itens.
 */
const itens = defineModel<ItemModeloChecklist[]>({ required: true })
const toast = useToast()

const opcoesFamilias = FAMILIAS_SOLICITACAO.map(f => ({ label: f.rotulo, value: f.valor, icon: f.icone }))
const opcoesTipo = TIPOS_ITEM_SOLIC.map(t => ({ label: t.rotulo, value: t.valor, icon: t.icone }))
const abertos = ref<Set<number>>(new Set())

const PLACEHOLDER: Partial<Record<TipoItemSolic, string>> = {
  documento: 'Ex.: RG ou CNH de cada sócio',
  texto_curto: 'Ex.: Nome do responsável financeiro',
  texto_longo: 'Ex.: Descreva as atividades da empresa',
  escolha: 'Ex.: A empresa tem funcionários?',
  email: 'Ex.: E-mail para receber as guias',
  telefone: 'Ex.: Telefone do responsável',
  cpf_cnpj: 'Ex.: CPF do sócio administrador',
  data: 'Ex.: Data de admissão',
  numero: 'Ex.: Quantidade de funcionários',
  moeda: 'Ex.: Faturamento médio mensal',
  declaracao: 'Ex.: Declaração de veracidade',
  informativo: 'Título (opcional) — ex.: Antes de começar'
}

const ALINHAMENTOS = [
  { label: 'Justificado', value: 'justificado', icon: 'i-lucide-align-justify' },
  { label: 'Esquerda', value: 'esquerda', icon: 'i-lucide-align-left' },
  { label: 'Centro', value: 'centro', icon: 'i-lucide-align-center' }
]
const DESTAQUES = [
  { label: 'Texto corrido', value: 'nenhum' },
  { label: 'Caixa neutra', value: 'neutro' },
  { label: 'Atenção (amarelo)', value: 'atencao' },
  { label: 'Alerta (vermelho)', value: 'alerta' }
]

function adicionar(tipo: TipoItemSolic, preset?: 'sim_nao') {
  const novo = novoItemSolic(tipo, preset)
  itens.value = [...itens.value, novo]
  const n = itens.value.length - 1
  // escolha e declaracao ja abrem: tem o que configurar
  abertos.value = new Set([...abertos.value, n])
  nextTick(() => document.getElementById(`item-solic-${n}`)?.focus())
}

const menuAdicionar: DropdownMenuItem[][] = [
  [{ label: 'Documento (arquivo)', icon: 'i-lucide-file-up', onSelect: () => adicionar('documento') }],
  [
    { label: 'Texto curto', icon: 'i-lucide-type', onSelect: () => adicionar('texto_curto') },
    { label: 'Texto longo', icon: 'i-lucide-align-left', onSelect: () => adicionar('texto_longo') },
    { label: 'Escolha (alternativas)', icon: 'i-lucide-list-checks', onSelect: () => adicionar('escolha') },
    { label: 'Sim / Não', icon: 'i-lucide-toggle-left', onSelect: () => adicionar('escolha', 'sim_nao') }
  ],
  TIPOS_ITEM_SOLIC.filter(t => t.grupo === 'campo').map(t => ({ label: t.rotulo, icon: t.icone, onSelect: () => adicionar(t.valor) })),
  [
    { label: 'Declaração / aceite', icon: 'i-lucide-signature', onSelect: () => adicionar('declaracao') },
    { label: 'Texto / informação', icon: 'i-lucide-text', onSelect: () => adicionar('informativo') }
  ]
]

function remover(i: number) {
  itens.value = itens.value.filter((_, n) => n !== i)
  abertos.value = new Set()
}
function mover(i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= itens.value.length) return
  const copia = [...itens.value]
  ;[copia[i], copia[j]] = [copia[j]!, copia[i]!]
  itens.value = copia
  abertos.value = new Set()
}
function alterar(i: number, parcial: Partial<ItemModeloChecklist>) {
  itens.value = itens.value.map((x, n) => (n === i ? { ...x, ...parcial } : x))
}
function alterarConfig(i: number, parcial: Partial<ConfigItem>) {
  itens.value = itens.value.map((x, n) => (n === i ? { ...x, config: { ...x.config, ...parcial } } : x))
}
/** Troca o tipo mantendo o que vale para todos: nome, instrução, obrigatório. */
function trocarTipo(i: number, tipo: TipoItemSolic) {
  const atual = itens.value[i]!
  if (atual.tipo === tipo) return
  const novo = novoItemSolic(tipo)
  alterar(i, {
    ...novo,
    titulo: atual.titulo || novo.titulo,
    instrucao: atual.instrucao,
    obrigatorio: tipo === 'informativo' ? false : atual.obrigatorio
  })
  abertos.value = new Set([...abertos.value, i])
}
function alternar(i: number) {
  const s = new Set(abertos.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  abertos.value = s
}

const enviandoModelo = ref<number | null>(null)
async function enviarModelo(i: number, e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  enviandoModelo.value = i
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    const r = await $fetch<{ path: string; nome: string }>(api('/api/admin/solicitacoes/modelo-arquivo'), { method: 'POST', body: fd })
    alterar(i, { modeloPath: r.path, modeloNome: r.nome })
  } catch (err: any) {
    toast.add({ title: 'Não foi possível enviar o modelo', description: err?.statusMessage || err?.data?.statusMessage, color: 'error' })
  } finally {
    enviandoModelo.value = null
  }
}

/** Erro de configuração do item (alternativa vazia, declaração sem texto...). */
const erros = computed(() =>
  itens.value.map(item => {
    const r = normalizarConfig(item.tipo, item.config)
    return r.ok ? null : r.erro
  })
)

function resumo(item: ItemModeloChecklist) {
  if (item.tipo === 'documento') {
    const partes = [item.tipos.length ? descreverFamilias(item.tipos) : 'qualquer formato', `até ${item.maxArquivos} arquivo(s)`]
    if (item.modeloNome) partes.push(`modelo: ${item.modeloNome}`)
    return partes.join(' · ')
  }
  return [rotuloTipoItem(item.tipo), descreverConfig(item.tipo, item.config), item.config.conferir === false ? 'aprovação automática' : '']
    .filter(Boolean)
    .join(' · ')
}

const numeroOuNada = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v))
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(item, i) in itens"
      :key="i"
      class="rounded-lg border bg-default"
      :class="erros[i] ? 'border-error/60' : 'border-default'"
    >
      <div class="flex items-center gap-2 p-2 pl-3">
        <span class="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted">{{ i + 1 }}</span>
        <UTooltip :text="rotuloTipoItem(item.tipo)">
          <UIcon :name="iconeTipoItem(item.tipo)" class="size-4 shrink-0 text-muted" />
        </UTooltip>
        <UInput
          :id="`item-solic-${i}`"
          :model-value="item.titulo"
          :placeholder="PLACEHOLDER[item.tipo] ?? 'Nome do item'"
          class="min-w-0 flex-1"
          :ui="{ base: 'font-medium' }"
          @update:model-value="v => alterar(i, { titulo: String(v) })"
        />
        <USwitch
          v-if="item.tipo !== 'informativo'"
          :model-value="item.obrigatorio"
          :label="item.obrigatorio ? 'Obrigatório' : 'Opcional'"
          class="hidden shrink-0 sm:flex"
          @update:model-value="v => alterar(i, { obrigatorio: v })"
        />
        <span v-else class="hidden shrink-0 text-xs text-muted sm:inline">Só leitura</span>
        <UButton
          :icon="abertos.has(i) ? 'i-lucide-chevron-up' : 'i-lucide-sliders-horizontal'"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="abertos.has(i) ? 'Fechar detalhes' : 'Detalhes do item'"
          @click="alternar(i)"
        />
        <div class="flex shrink-0 flex-col">
          <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="xs" :disabled="i === 0" aria-label="Subir" class="h-4" @click="mover(i, -1)" />
          <UButton icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="xs" :disabled="i === itens.length - 1" aria-label="Descer" class="h-4" @click="mover(i, 1)" />
        </div>
        <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="sm" aria-label="Remover item" @click="remover(i)" />
      </div>

      <p v-if="!abertos.has(i)" class="-mt-1 px-3 pb-2 pl-11 text-xs text-muted">
        <span v-if="item.tipo !== 'informativo'" class="sm:hidden">{{ item.obrigatorio ? 'Obrigatório' : 'Opcional' }} · </span>
        {{ resumo(item) }}
        <template v-if="item.instrucao"> · “{{ item.instrucao }}”</template>
        <span v-if="erros[i]" class="block text-error">{{ erros[i] }}</span>
      </p>

      <div v-else class="grid gap-4 border-t border-default p-3 sm:grid-cols-2">
        <UFormField label="Tipo do item">
          <USelectMenu
            :model-value="item.tipo"
            :items="opcoesTipo"
            value-key="value"
            :icon="iconeTipoItem(item.tipo)"
            class="w-full"
            @update:model-value="(v: TipoItemSolic) => trocarTipo(i, v)"
          />
        </UFormField>
        <USwitch
          v-if="item.tipo !== 'informativo'"
          :model-value="item.obrigatorio"
          :label="item.obrigatorio ? 'Obrigatório' : 'Opcional'"
          :description="
            item.tipo === 'documento'
              ? 'Obrigatório: a solicitação só conclui com ele aprovado (ou com “não possuo” aceito).'
              : 'Obrigatório: o cliente precisa responder para concluir.'
          "
          class="self-end"
          @update:model-value="v => alterar(i, { obrigatorio: v })"
        />
        <UFormField
          v-if="item.tipo !== 'informativo'"
          label="Instrução para o cliente"
          class="sm:col-span-2"
          help="Aparece embaixo do nome do item, na página do cliente."
        >
          <UTextarea
            :model-value="item.instrucao ?? ''"
            :rows="2"
            autoresize
            :placeholder="item.tipo === 'documento' ? 'Ex.: Frente e verso, legível. Pode ser foto.' : 'Ex.: Se não souber, deixe em branco.'"
            class="w-full"
            @update:model-value="v => alterar(i, { instrucao: String(v) || null })"
          />
        </UFormField>

        <!-- documento -->
        <template v-if="item.tipo === 'documento'">
          <UFormField label="Formatos aceitos" help="Nenhum marcado = qualquer formato seguro.">
            <USelectMenu
              :model-value="item.tipos"
              :items="opcoesFamilias"
              value-key="value"
              multiple
              placeholder="Qualquer formato"
              class="w-full"
              @update:model-value="(v: string[]) => alterar(i, { tipos: v })"
            />
          </UFormField>
          <UFormField label="Até quantos arquivos">
            <UInputNumber
              :model-value="item.maxArquivos"
              :min="1"
              :max="30"
              class="w-32"
              @update:model-value="v => alterar(i, { maxArquivos: Number(v) || 1 })"
            />
          </UFormField>
          <UFormField label="Arquivo modelo (opcional)" class="sm:col-span-2" help="Ficha ou declaração para o cliente baixar, preencher e devolver.">
            <div class="flex flex-wrap items-center gap-2">
              <template v-if="item.modeloPath">
                <UButton
                  :label="item.modeloNome || 'modelo'"
                  icon="i-lucide-paperclip"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :to="api(`/api/admin/solicitacoes/modelo-arquivo?path=${encodeURIComponent(item.modeloPath)}&nome=${encodeURIComponent(item.modeloNome || '')}`)"
                  external
                  target="_blank"
                />
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Tirar o modelo" @click="alterar(i, { modeloPath: null, modeloNome: null })" />
              </template>
              <label v-else class="inline-flex">
                <input type="file" class="sr-only" :accept="acceptDe(TIPOS_ANEXO)" @change="enviarModelo(i, $event)" />
                <UButton
                  as="span"
                  label="Anexar modelo"
                  icon="i-lucide-upload"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :loading="enviandoModelo === i"
                  class="cursor-pointer"
                />
              </label>
            </div>
          </UFormField>
        </template>

        <!-- texto -->
        <template v-else-if="item.tipo === 'texto_curto' || item.tipo === 'texto_longo'">
          <UFormField label="Limite de caracteres">
            <UInputNumber
              :model-value="item.config.maxLen"
              :min="1"
              :max="item.tipo === 'texto_curto' ? LIMITES_ITEM.textoCurto.max : LIMITES_ITEM.textoLongo.max"
              class="w-36"
              @update:model-value="v => alterarConfig(i, { maxLen: Number(v) || undefined })"
            />
          </UFormField>
          <UFormField label="Exemplo dentro do campo (opcional)">
            <UInput
              :model-value="item.config.placeholder ?? ''"
              maxlength="120"
              placeholder="Ex.: Comércio varejista de roupas"
              class="w-full"
              @update:model-value="v => alterarConfig(i, { placeholder: String(v) || undefined })"
            />
          </UFormField>
        </template>

        <!-- escolha -->
        <template v-else-if="item.tipo === 'escolha'">
          <UFormField label="Alternativas" class="sm:col-span-2">
            <EditorOpcoesEscolha :model-value="item.config.opcoes ?? []" @update:model-value="v => alterarConfig(i, { opcoes: v })" />
          </UFormField>
          <div class="flex flex-col gap-3">
            <USwitch
              :model-value="!!item.config.multipla"
              label="Pode marcar mais de uma"
              @update:model-value="v => alterarConfig(i, { multipla: v, minEscolhas: undefined, maxEscolhas: undefined })"
            />
            <USwitch
              :model-value="!!item.config.outro"
              label="Opção “Outro” com texto livre"
              @update:model-value="v => alterarConfig(i, { outro: v })"
            />
          </div>
          <div v-if="item.config.multipla" class="flex gap-3">
            <UFormField label="Mínimo">
              <UInputNumber
                :model-value="item.config.minEscolhas"
                :min="1"
                placeholder="—"
                class="w-24"
                @update:model-value="v => alterarConfig(i, { minEscolhas: numeroOuNada(v) })"
              />
            </UFormField>
            <UFormField label="Máximo">
              <UInputNumber
                :model-value="item.config.maxEscolhas"
                :min="1"
                placeholder="—"
                class="w-24"
                @update:model-value="v => alterarConfig(i, { maxEscolhas: numeroOuNada(v) })"
              />
            </UFormField>
          </div>
        </template>

        <!-- numero / moeda -->
        <template v-else-if="item.tipo === 'numero' || item.tipo === 'moeda'">
          <div class="flex gap-3">
            <UFormField :label="item.tipo === 'moeda' ? 'Mínimo (R$)' : 'Mínimo'">
              <UInputNumber
                :model-value="typeof item.config.min === 'number' ? item.config.min : undefined"
                placeholder="—"
                :step="item.tipo === 'moeda' ? 0.01 : 1"
                class="w-36"
                @update:model-value="v => alterarConfig(i, { min: numeroOuNada(v) })"
              />
            </UFormField>
            <UFormField :label="item.tipo === 'moeda' ? 'Máximo (R$)' : 'Máximo'">
              <UInputNumber
                :model-value="typeof item.config.max === 'number' ? item.config.max : undefined"
                placeholder="—"
                :step="item.tipo === 'moeda' ? 0.01 : 1"
                class="w-36"
                @update:model-value="v => alterarConfig(i, { max: numeroOuNada(v) })"
              />
            </UFormField>
          </div>
          <UFormField v-if="item.tipo === 'numero'" label="Casas decimais">
            <UInputNumber
              :model-value="item.config.casas ?? 0"
              :min="0"
              :max="4"
              class="w-24"
              @update:model-value="v => alterarConfig(i, { casas: Number(v) || 0 })"
            />
          </UFormField>
        </template>

        <!-- data -->
        <template v-else-if="item.tipo === 'data'">
          <div class="flex gap-3">
            <UFormField label="A partir de">
              <UInput
                type="date"
                :model-value="typeof item.config.min === 'string' ? item.config.min : ''"
                @update:model-value="v => alterarConfig(i, { min: String(v) || undefined })"
              />
            </UFormField>
            <UFormField label="Até">
              <UInput
                type="date"
                :model-value="typeof item.config.max === 'string' ? item.config.max : ''"
                @update:model-value="v => alterarConfig(i, { max: String(v) || undefined })"
              />
            </UFormField>
          </div>
          <USwitch
            :model-value="!!item.config.naoFutura"
            label="Não aceitar data no futuro"
            class="self-end"
            @update:model-value="v => alterarConfig(i, { naoFutura: v || undefined })"
          />
        </template>

        <!-- cpf/cnpj -->
        <UFormField v-else-if="item.tipo === 'cpf_cnpj'" label="Aceita">
          <URadioGroup
            :model-value="item.config.aceita ?? 'ambos'"
            orientation="horizontal"
            :items="[
              { label: 'CPF ou CNPJ', value: 'ambos' },
              { label: 'Só CPF', value: 'cpf' },
              { label: 'Só CNPJ', value: 'cnpj' }
            ]"
            @update:model-value="v => alterarConfig(i, { aceita: v as ConfigItem['aceita'] })"
          />
        </UFormField>

        <!-- declaracao -->
        <UFormField
          v-else-if="item.tipo === 'declaracao'"
          label="Texto da declaração"
          class="sm:col-span-2"
          help="O cliente lê e marca “Li e concordo”. Guardamos data, hora, IP e uma impressão digital (SHA-256) do texto aceito."
        >
          <UTextarea
            :model-value="item.config.texto ?? ''"
            :rows="4"
            autoresize
            :maxlength="LIMITES_ITEM.declaracao"
            class="w-full"
            @update:model-value="v => alterarConfig(i, { texto: String(v) })"
          />
        </UFormField>

        <!-- texto / informacao -->
        <template v-if="item.tipo === 'informativo'">
          <UFormField
            label="Texto que o cliente vai ler"
            class="sm:col-span-2"
            help="Orientações, avisos, contexto. Ele não responde nada aqui. Quebras de linha são mantidas."
          >
            <UTextarea
              :model-value="item.config.texto ?? ''"
              :rows="4"
              autoresize
              :maxlength="LIMITES_ITEM.declaracao"
              placeholder="Ex.: Os documentos abaixo são necessários para o registro na Junta Comercial. Envie cópias legíveis; se tiver dúvida, fale com a gente pelo WhatsApp."
              class="w-full"
              @update:model-value="v => alterarConfig(i, { texto: String(v) })"
            />
          </UFormField>
          <UFormField label="Alinhamento">
            <USelect
              :model-value="item.config.alinhamento ?? 'justificado'"
              :items="ALINHAMENTOS"
              class="w-full"
              @update:model-value="v => alterarConfig(i, { alinhamento: v as ConfigItem['alinhamento'] })"
            />
          </UFormField>
          <UFormField label="Destaque">
            <USelect
              :model-value="item.config.cor ?? 'nenhum'"
              :items="DESTAQUES"
              class="w-full"
              @update:model-value="v => alterarConfig(i, { cor: v === 'nenhum' ? undefined : (v as ConfigItem['cor']) })"
            />
          </UFormField>
          <div v-if="item.config.texto?.trim()" class="sm:col-span-2">
            <p class="mb-1 text-xs font-medium text-muted">Como o cliente vê</p>
            <div class="rounded-lg border border-dashed border-default p-3">
              <p v-if="item.titulo.trim()" class="mb-1 font-medium">{{ item.titulo }}</p>
              <div class="text-sm" :class="classesInformativo(item.config)">{{ item.config.texto }}</div>
            </div>
          </div>
        </template>

        <USwitch
          v-if="item.tipo !== 'documento' && item.tipo !== 'informativo'"
          :model-value="item.config.conferir === false"
          label="Aprovar a resposta automaticamente"
          description="Sem conferência da equipe: respondeu, está aprovado."
          class="sm:col-span-2"
          @update:model-value="v => alterarConfig(i, { conferir: v ? false : undefined })"
        />

        <p v-if="erros[i]" class="text-sm text-error sm:col-span-2">
          <UIcon name="i-lucide-circle-alert" class="mr-1 align-[-2px]" />{{ erros[i] }}
        </p>
      </div>
    </div>

    <UDropdownMenu :items="menuAdicionar" :content="{ align: 'center' }" :ui="{ content: 'w-64' }">
      <UButton label="Adicionar item" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" color="neutral" variant="outline" block />
    </UDropdownMenu>
  </div>
</template>
