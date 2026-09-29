<script setup lang="ts">
import { FAMILIAS_SOLICITACAO, acceptDe, descreverFamilias, TIPOS_ANEXO } from '~~/shared/types/tipos-arquivo'

/**
 * Lista de documentos pedidos ao cliente: nome, obrigatório ou opcional,
 * formatos aceitos, quantos arquivos e, se preciso, um arquivo modelo para
 * ele baixar, preencher e devolver. Serve à solicitação e ao modelo de
 * checklist, que têm os mesmos itens.
 */
const itens = defineModel<ItemModeloChecklist[]>({ required: true })
const toast = useToast()

const opcoesTipos = FAMILIAS_SOLICITACAO.map(f => ({ label: f.rotulo, value: f.valor, icon: f.icone }))
const abertos = ref<Set<number>>(new Set())

function novoItem(): ItemModeloChecklist {
  return { titulo: '', instrucao: null, obrigatorio: true, tipos: ['PDF', 'imagem'], maxArquivos: 5, modeloPath: null, modeloNome: null }
}
function adicionar() {
  itens.value = [...itens.value, novoItem()]
  abertos.value = new Set([...abertos.value, itens.value.length - 1])
  nextTick(() => document.getElementById(`item-solic-${itens.value.length - 1}`)?.focus())
}
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
}
function alterar(i: number, parcial: Partial<ItemModeloChecklist>) {
  itens.value = itens.value.map((x, n) => (n === i ? { ...x, ...parcial } : x))
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

function resumoTipos(tipos: string[]) {
  return tipos.length ? descreverFamilias(tipos) : 'qualquer formato'
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(item, i) in itens"
      :key="i"
      class="rounded-lg border border-default bg-default"
    >
      <div class="flex items-center gap-2 p-2 pl-3">
        <span class="w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted">{{ i + 1 }}</span>
        <UInput
          :id="`item-solic-${i}`"
          :model-value="item.titulo"
          placeholder="Ex.: RG ou CNH de cada sócio"
          class="min-w-0 flex-1"
          :ui="{ base: 'font-medium' }"
          @update:model-value="v => alterar(i, { titulo: String(v) })"
        />
        <USwitch
          :model-value="item.obrigatorio"
          :label="item.obrigatorio ? 'Obrigatório' : 'Opcional'"
          class="hidden shrink-0 sm:flex"
          @update:model-value="v => alterar(i, { obrigatorio: v })"
        />
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
        <span class="sm:hidden">{{ item.obrigatorio ? 'Obrigatório' : 'Opcional' }} · </span>
        {{ resumoTipos(item.tipos) }} · até {{ item.maxArquivos }} arquivo(s)
        <template v-if="item.modeloNome"> · modelo: {{ item.modeloNome }}</template>
        <template v-if="item.instrucao"> · “{{ item.instrucao }}”</template>
      </p>

      <div v-else class="grid gap-4 border-t border-default p-3 sm:grid-cols-2">
        <USwitch
          :model-value="item.obrigatorio"
          :label="item.obrigatorio ? 'Obrigatório' : 'Opcional'"
          description="Obrigatório: a solicitação só conclui com ele aprovado (ou com “não possuo” aceito)."
          class="sm:col-span-2 sm:hidden"
          @update:model-value="v => alterar(i, { obrigatorio: v })"
        />
        <UFormField label="Instrução para o cliente" class="sm:col-span-2" help="Aparece embaixo do nome do item, na página do cliente.">
          <UTextarea
            :model-value="item.instrucao ?? ''"
            :rows="2"
            autoresize
            placeholder="Ex.: Frente e verso, legível. Pode ser foto."
            class="w-full"
            @update:model-value="v => alterar(i, { instrucao: String(v) || null })"
          />
        </UFormField>
        <UFormField label="Formatos aceitos" help="Nenhum marcado = qualquer formato seguro.">
          <USelectMenu
            :model-value="item.tipos"
            :items="opcoesTipos"
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
      </div>
    </div>

    <UButton label="Adicionar documento" icon="i-lucide-plus" color="neutral" variant="outline" block @click="adicionar" />
  </div>
</template>
