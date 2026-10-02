<script setup lang="ts">
import { mascaraDocumento } from '~~/shared/utils/documento'
import { mascaraTelefone, lerNumeroBR, type EntradaEscolha } from '~~/shared/utils/itens-solic'

/**
 * Campo de resposta do cliente para um item que não é documento. Só mostra e
 * devolve o valor digitado; quem valida e salva é a página (/r/:token), com
 * as mesmas regras do servidor.
 *
 * `salvar` pede para gravar já (saiu do campo, marcou uma opção, aceitou a
 * declaração) — o resto espera uma pausa na digitação.
 */
type Item = LandingSolicitacao['itens'][number]
const props = defineProps<{ item: Item; desabilitado?: boolean; erro?: string | null }>()
const valor = defineModel<unknown>({ required: true })
const emit = defineEmits<{ salvar: [] }>()

const cfg = computed(() => props.item.config)
const texto = computed(() => (typeof valor.value === 'string' ? valor.value : ''))
const escolha = computed<EntradaEscolha>(() => (valor.value as EntradaEscolha) ?? { escolhas: [], outro: null })
const OUTRO = '__outro__'

function definirTexto(v: unknown) {
  valor.value = String(v ?? '')
}

/* escolha unica: radio; "Outro" e uma opcao a mais */
const radio = computed(() => (escolha.value.outro != null ? OUTRO : (escolha.value.escolhas[0] ?? '')))
const itensRadio = computed(() => [
  ...(cfg.value.opcoes ?? []).map(o => ({ label: o, value: o })),
  ...(cfg.value.outro ? [{ label: 'Outro', value: OUTRO }] : [])
])
function escolherRadio(v: unknown) {
  valor.value = v === OUTRO ? { escolhas: [], outro: escolha.value.outro ?? '' } : { escolhas: [String(v)], outro: null }
  emit('salvar')
}

/* varias: checkboxes */
function alternarOpcao(o: string, marcado: boolean | 'indeterminate') {
  const atual = new Set(escolha.value.escolhas)
  if (marcado === true) atual.add(o)
  else atual.delete(o)
  valor.value = { escolhas: [...atual], outro: escolha.value.outro ?? null }
  emit('salvar')
}
function alternarOutro(marcado: boolean | 'indeterminate') {
  valor.value = { escolhas: escolha.value.escolhas, outro: marcado === true ? '' : null }
  emit('salvar')
}
function textoOutro(v: unknown) {
  valor.value = { escolhas: cfg.value.multipla ? escolha.value.escolhas : [], outro: String(v ?? '') }
}

/* valor: ao sair do campo, mostra no formato brasileiro */
function formatarMoedaAoSair() {
  const n = lerNumeroBR(texto.value)
  if (n != null) valor.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  emit('salvar')
}

const limite = computed(() => cfg.value.maxLen ?? (props.item.tipo === 'texto_curto' ? 200 : 2000))
const cor = computed(() => (props.erro ? 'error' : undefined))
</script>

<template>
  <div class="space-y-1.5">
    <!-- texto curto -->
    <UInput
      v-if="item.tipo === 'texto_curto'"
      :model-value="texto"
      :maxlength="limite"
      :placeholder="cfg.placeholder"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full"
      @update:model-value="definirTexto"
      @blur="emit('salvar')"
    />

    <!-- texto longo -->
    <template v-else-if="item.tipo === 'texto_longo'">
      <UTextarea
        :model-value="texto"
        :maxlength="limite"
        :placeholder="cfg.placeholder"
        :disabled="desabilitado"
        :color="cor"
        :highlight="!!erro"
        :rows="4"
        autoresize
        :maxrows="16"
        class="w-full"
        @update:model-value="definirTexto"
        @blur="emit('salvar')"
      />
      <p class="text-right text-xs tabular-nums text-muted">{{ texto.length }}/{{ limite }}</p>
    </template>

    <!-- escolha -->
    <template v-else-if="item.tipo === 'escolha'">
      <URadioGroup
        v-if="!cfg.multipla"
        :model-value="radio"
        :items="itensRadio"
        :disabled="desabilitado"
        variant="card"
        :ui="{ fieldset: 'gap-2', item: 'py-2.5' }"
        @update:model-value="escolherRadio"
      />
      <div v-else class="space-y-2">
        <UCheckbox
          v-for="o in cfg.opcoes ?? []"
          :key="o"
          :model-value="escolha.escolhas.includes(o)"
          :label="o"
          :disabled="desabilitado"
          variant="card"
          :ui="{ root: 'py-2.5' }"
          @update:model-value="v => alternarOpcao(o, v)"
        />
        <UCheckbox
          v-if="cfg.outro"
          :model-value="escolha.outro != null"
          label="Outro"
          :disabled="desabilitado"
          variant="card"
          :ui="{ root: 'py-2.5' }"
          @update:model-value="alternarOutro"
        />
      </div>
      <UInput
        v-if="cfg.outro && escolha.outro != null"
        :model-value="escolha.outro"
        maxlength="300"
        placeholder="Qual?"
        :disabled="desabilitado"
        class="w-full"
        @update:model-value="textoOutro"
        @blur="emit('salvar')"
      />
      <p v-if="cfg.multipla && (cfg.minEscolhas || cfg.maxEscolhas)" class="text-xs text-muted">
        <template v-if="cfg.minEscolhas && cfg.maxEscolhas">Marque de {{ cfg.minEscolhas }} a {{ cfg.maxEscolhas }}.</template>
        <template v-else-if="cfg.minEscolhas">Marque pelo menos {{ cfg.minEscolhas }}.</template>
        <template v-else>Marque no máximo {{ cfg.maxEscolhas }}.</template>
      </p>
    </template>

    <!-- e-mail -->
    <UInput
      v-else-if="item.tipo === 'email'"
      :model-value="texto"
      type="email"
      inputmode="email"
      autocomplete="email"
      placeholder="nome@empresa.com.br"
      maxlength="320"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full"
      @update:model-value="definirTexto"
      @blur="emit('salvar')"
    />

    <!-- telefone -->
    <UInput
      v-else-if="item.tipo === 'telefone'"
      :model-value="texto"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      placeholder="(47) 99999-9999"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full sm:w-64"
      @update:model-value="v => definirTexto(mascaraTelefone(String(v ?? '')))"
      @blur="emit('salvar')"
    />

    <!-- cpf / cnpj -->
    <UInput
      v-else-if="item.tipo === 'cpf_cnpj'"
      :model-value="texto"
      inputmode="numeric"
      :placeholder="cfg.aceita === 'cpf' ? '000.000.000-00' : cfg.aceita === 'cnpj' ? '00.000.000/0000-00' : 'CPF ou CNPJ'"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full sm:w-64"
      @update:model-value="v => definirTexto(mascaraDocumento(String(v ?? '')))"
      @blur="emit('salvar')"
    />

    <!-- data -->
    <UInput
      v-else-if="item.tipo === 'data'"
      :model-value="texto"
      type="date"
      :min="typeof cfg.min === 'string' ? cfg.min : undefined"
      :max="typeof cfg.max === 'string' ? cfg.max : cfg.naoFutura ? dataSP() : undefined"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full sm:w-56"
      @update:model-value="v => { definirTexto(v); emit('salvar') }"
    />

    <!-- numero -->
    <UInput
      v-else-if="item.tipo === 'numero'"
      :model-value="texto"
      inputmode="decimal"
      placeholder="0"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full sm:w-56"
      @update:model-value="definirTexto"
      @blur="emit('salvar')"
    />

    <!-- valor -->
    <UInput
      v-else-if="item.tipo === 'moeda'"
      :model-value="texto"
      inputmode="decimal"
      placeholder="0,00"
      :disabled="desabilitado"
      :color="cor"
      :highlight="!!erro"
      size="lg"
      class="w-full sm:w-56"
      :ui="{ base: 'ps-10' }"
      @update:model-value="definirTexto"
      @blur="formatarMoedaAoSair"
    >
      <template #leading><span class="text-sm text-muted">R$</span></template>
    </UInput>

    <!-- declaracao -->
    <template v-else-if="item.tipo === 'declaracao'">
      <div class="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-default bg-elevated/50 px-3 py-2 text-sm leading-relaxed">
        {{ cfg.texto }}
      </div>
      <UCheckbox
        :model-value="valor === true"
        label="Li e concordo com a declaração acima"
        :disabled="desabilitado"
        variant="card"
        :ui="{ root: 'py-2.5', label: 'font-medium' }"
        @update:model-value="v => { valor = v === true; emit('salvar') }"
      />
    </template>

    <p v-if="erro" class="text-sm text-error"><UIcon name="i-lucide-circle-alert" class="mr-1 align-[-2px]" />{{ erro }}</p>
  </div>
</template>
