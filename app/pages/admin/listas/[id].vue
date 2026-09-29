<script setup lang="ts">
import { dataHora } from '~/utils/formato'

definePageMeta({ layout: 'admin' })

const route = useRoute()
const toast = useToast()
const { sessao, pode } = usePapel()
const id = Number(route.params.id)

const { data: lista, refresh, error } = await useFetch<DetalheLista>(api(`/api/admin/listas/${id}`))
useHead({ title: computed(() => `${lista.value?.nome ?? 'Lista'} — Gaulke Comunica`) })

const podeExcluir = computed(() => pode('supervisor') || !lista.value?.criadoPorNome || lista.value?.criadoPorNome === sessao.value?.usuario?.nome)

/* ---------- membros: busca e seleção ---------- */
const busca = ref('')
const membros = computed(() => {
  const q = busca.value.trim().toLowerCase()
  const todos = lista.value?.membros ?? []
  return q ? todos.filter(m => `${m.email} ${m.nome ?? ''} ${m.empresa ?? ''} ${m.documento ?? ''}`.toLowerCase().includes(q)) : todos
})
const selecionados = ref<Set<number>>(new Set())
function alternar(idMembro: number) {
  const s = new Set(selecionados.value)
  if (s.has(idMembro)) s.delete(idMembro)
  else s.add(idMembro)
  selecionados.value = s
}
const todosMarcados = computed(() => membros.value.length > 0 && membros.value.every(m => selecionados.value.has(m.id)))
function alternarTodos() {
  selecionados.value = todosMarcados.value ? new Set() : new Set(membros.value.map(m => m.id))
}
const suprimidos = computed(() => lista.value?.membros.filter(m => m.suprimido).length ?? 0)

const removendo = ref(false)
async function removerSelecionados() {
  if (!selecionados.value.size) return
  if (!confirm(`Tirar ${selecionados.value.size} contato(s) da lista?`)) return
  removendo.value = true
  try {
    const r = await $fetch<{ removidos: number }>(api(`/api/admin/listas/${id}/remover`), {
      method: 'POST',
      body: { ids: [...selecionados.value] }
    })
    toast.add({ title: `${r.removidos} contato(s) retirado(s)`, color: 'success' })
    selecionados.value = new Set()
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível retirar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    removendo.value = false
  }
}

/* ---------- acrescentar: colar/digitar ou planilha ---------- */
const modalAcrescentar = ref(false)
const aba = ref<'colar' | 'planilha'>('colar')
const textoColado = ref('')
const RE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/

type Entrada = { email: string; nome?: string; empresa?: string; documento?: string; extras?: Record<string, string> }

/** Uma linha por pessoa, colunas separadas por tab (planilha colada) ou ";" em qualquer ordem. */
function lerColado(texto: string): Entrada[] {
  const saida: Entrada[] = []
  for (const linha of texto.split(/\r?\n/)) {
    const cols = linha.split(/\t|;/).map(c => c.trim()).filter(Boolean)
    const email = cols.find(c => RE_EMAIL.test(c))
    if (!email) continue
    const documento = cols.find(c => [11, 14].includes(c.replace(/\D/g, '').length) && !/[a-z]/i.test(c)) ?? ''
    const textos = cols.filter(c => c !== email && c !== documento)
    saida.push({ email: email.toLowerCase(), documento, nome: textos[0] ?? '', empresa: textos[1] ?? '' })
  }
  return saida
}
const colados = computed(() => lerColado(textoColado.value))

const importando = ref(false)
const planilha = ref<RespostaImportacao | null>(null)
const SEM = '__sem__'
const mapa = reactive({ email: '', nome: SEM, empresa: SEM, documento: SEM })
async function lerPlanilha(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  importando.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    const r = await $fetch<RespostaImportacao>(api('/api/admin/importar'), { method: 'POST', body: fd })
    planilha.value = r
    mapa.email = r.sugestao.email
    mapa.nome = r.sugestao.nome || SEM
    mapa.empresa = r.sugestao.empresa || SEM
    mapa.documento = r.sugestao.documento || SEM
  } catch (err: any) {
    toast.add({ title: 'Não foi possível ler a planilha', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    importando.value = false
  }
}
const opcoesColuna = computed(() => [{ label: '— nenhuma —', value: SEM }, ...(planilha.value?.colunas ?? []).map(c => ({ label: c, value: c }))])
const daPlanilha = computed<Entrada[]>(() => {
  const p = planilha.value
  if (!p || !mapa.email) return []
  const usadas = new Set([mapa.email, mapa.nome, mapa.empresa, mapa.documento])
  return p.linhas.map(l => {
    const extras: Record<string, string> = {}
    for (const c of p.colunas) if (!usadas.has(c) && l[c]) extras[c] = String(l[c])
    const col = (c: string) => (c === SEM ? '' : String(l[c] ?? ''))
    return { email: col(mapa.email).trim().toLowerCase(), nome: col(mapa.nome), empresa: col(mapa.empresa), documento: col(mapa.documento), extras }
  })
})

const entradas = computed(() => (aba.value === 'colar' ? colados.value : daPlanilha.value))
const salvandoMembros = ref(false)
async function acrescentar() {
  salvandoMembros.value = true
  try {
    const r = await $fetch<{ adicionados: number; atualizados: number; invalidos: string[] }>(api(`/api/admin/listas/${id}/membros`), {
      method: 'POST',
      body: { membros: entradas.value }
    })
    toast.add({
      title: `${r.adicionados} contato(s) acrescentado(s)${r.atualizados ? `, ${r.atualizados} atualizado(s)` : ''}`,
      description: r.invalidos.length ? `${r.invalidos.length} linha(s) com e-mail inválido ficaram de fora: ${r.invalidos.slice(0, 5).join(', ')}` : undefined,
      color: r.invalidos.length ? 'warning' : 'success'
    })
    modalAcrescentar.value = false
    textoColado.value = ''
    planilha.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível acrescentar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvandoMembros.value = false
  }
}

/* ---------- editar e excluir ---------- */
const modalEditar = ref(false)
const edicao = reactive({ nome: '', descricao: '' })
function abrirEdicao() {
  edicao.nome = lista.value?.nome ?? ''
  edicao.descricao = lista.value?.descricao ?? ''
  modalEditar.value = true
}
async function salvarEdicao() {
  try {
    await $fetch(api(`/api/admin/listas/${id}`), { method: 'PUT', body: { nome: edicao.nome, descricao: edicao.descricao || null } })
    modalEditar.value = false
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  }
}
async function excluir() {
  if (!lista.value) return
  const digitado = prompt(`Excluir a lista "${lista.value.nome}" com ${lista.value.total} contato(s)? Os envios já feitos não mudam.\n\nDigite o nome da lista para confirmar:`)
  if (digitado === null) return
  if (digitado.trim() !== lista.value.nome) {
    toast.add({ title: 'O nome não confere — nada foi excluído', color: 'warning' })
    return
  }
  try {
    await $fetch(api(`/api/admin/listas/${id}`), { method: 'DELETE' })
    toast.add({ title: 'Lista excluída', color: 'success' })
    await navigateTo('/admin/listas')
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  }
}

const formatarDoc = (d: string) =>
  d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.length === 11
      ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      : d

function exportarCsv() {
  if (!lista.value) return
  const esc = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhas = [['Nome', 'E-mail', 'Empresa', 'CPF/CNPJ'].join(';'), ...lista.value.membros.map(m => [m.nome, m.email, m.empresa, m.documento].map(esc).join(';'))]
  const blob = new Blob([`﻿${linhas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `lista-${lista.value.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="space-y-6">
    <UButton to="/admin/listas" icon="i-lucide-arrow-left" label="Listas" color="neutral" variant="ghost" size="sm" />

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Lista não encontrada" />

    <template v-else-if="lista">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold">{{ lista.nome }}</h1>
          <p v-if="lista.descricao" class="text-sm text-muted">{{ lista.descricao }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ lista.total }} contato(s) · criada por {{ lista.criadoPorNome ?? '—' }} · atualizada em {{ dataHora(lista.atualizadoEm) }}<template v-if="lista.atualizadoPorNome"> por {{ lista.atualizadoPorNome }}</template>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton label="Acrescentar contatos" icon="i-lucide-user-plus" @click="modalAcrescentar = true" />
          <UButton label="Usar num envio" icon="i-lucide-send" color="neutral" variant="outline" :to="`/admin/lotes/novo?lista=${lista.id}`" :disabled="!lista.total" />
          <UDropdownMenu
            :items="[
              { label: 'Renomear / descrição', icon: 'i-lucide-pencil', onSelect: abrirEdicao },
              { label: 'Baixar CSV', icon: 'i-lucide-download', onSelect: exportarCsv },
              ...(podeExcluir ? [{ label: 'Excluir lista', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: excluir }] : [])
            ]"
          >
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="outline" aria-label="Mais ações" />
          </UDropdownMenu>
        </div>
      </div>

      <UAlert
        v-if="suprimidos"
        color="warning"
        variant="subtle"
        icon="i-lucide-mail-x"
        :title="`${suprimidos} contato(s) desta lista já devolveram e-mail (endereço inexistente)`"
        description="Eles ficam de fora dos envios automaticamente. Corrija o e-mail ou tire-os da lista."
      />

      <UCard>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <UInput v-model="busca" icon="i-lucide-search" placeholder="Buscar por nome, e-mail, empresa ou CPF/CNPJ" class="w-full sm:w-96" />
          <UButton
            v-if="selecionados.size"
            :label="`Tirar ${selecionados.size} da lista`"
            icon="i-lucide-user-minus"
            color="error"
            variant="soft"
            :loading="removendo"
            @click="removerSelecionados"
          />
        </div>

        <p v-if="!lista.membros.length" class="py-10 text-center text-sm text-muted">
          A lista está vazia. Use “Acrescentar contatos” para colar da planilha ou importar um arquivo.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted">
              <tr class="border-b border-default">
                <th class="w-8 py-2"><UCheckbox :model-value="todosMarcados" aria-label="Marcar todos" @update:model-value="alternarTodos" /></th>
                <th class="py-2 pr-3 font-medium">Nome</th>
                <th class="py-2 pr-3 font-medium">E-mail</th>
                <th class="hidden py-2 pr-3 font-medium md:table-cell">Empresa</th>
                <th class="hidden py-2 pr-3 font-medium lg:table-cell">CPF/CNPJ</th>
                <th class="w-10 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in membros" :key="m.id" class="border-b border-default last:border-0">
                <td class="py-2"><UCheckbox :model-value="selecionados.has(m.id)" @update:model-value="alternar(m.id)" /></td>
                <td class="py-2 pr-3">{{ m.nome || '—' }}</td>
                <td class="py-2 pr-3">
                  <span class="break-all">{{ m.email }}</span>
                  <UTooltip v-if="m.suprimido" :text="`Devolveu: ${m.suprimido}`">
                    <UBadge color="error" variant="subtle" size="sm" label="devolve" class="ml-1" />
                  </UTooltip>
                </td>
                <td class="hidden py-2 pr-3 md:table-cell">{{ m.empresa || '—' }}</td>
                <td class="hidden whitespace-nowrap py-2 pr-3 text-xs tabular-nums lg:table-cell">{{ m.documento ? formatarDoc(m.documento) : '—' }}</td>
                <td class="py-2">
                  <UTooltip text="Linha do tempo do cliente">
                    <UButton :to="`/admin/clientes?email=${encodeURIComponent(m.email)}`" icon="i-lucide-history" color="neutral" variant="ghost" size="xs" aria-label="Linha do tempo" />
                  </UTooltip>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="busca && !membros.length" class="py-6 text-center text-sm text-muted">Ninguém com “{{ busca }}”.</p>
        </div>
      </UCard>
    </template>

    <UModal v-model:open="modalAcrescentar" title="Acrescentar contatos" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <div class="flex gap-2">
            <UButton label="Colar ou digitar" icon="i-lucide-clipboard" :color="aba === 'colar' ? 'primary' : 'neutral'" :variant="aba === 'colar' ? 'soft' : 'ghost'" @click="aba = 'colar'" />
            <UButton label="Planilha (CSV/XLSX)" icon="i-lucide-file-spreadsheet" :color="aba === 'planilha' ? 'primary' : 'neutral'" :variant="aba === 'planilha' ? 'soft' : 'ghost'" @click="aba = 'planilha'" />
          </div>

          <template v-if="aba === 'colar'">
            <UTextarea
              v-model="textoColado"
              :rows="8"
              class="w-full font-mono text-xs"
              placeholder="Maria Oliveira; maria@empresa.com.br; Empresa Exemplo LTDA; 12.345.678/0001-90&#10;joao@outra.com.br"
            />
            <p class="text-xs text-muted">
              Uma pessoa por linha. Cole direto da planilha (colunas separadas por tab) ou separe por “;”. Só o e-mail é obrigatório;
              o CPF/CNPJ é reconhecido sozinho. {{ colados.length }} e-mail(s) reconhecido(s).
            </p>
          </template>

          <template v-else>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-default p-4 hover:border-primary">
              <input type="file" accept=".csv,.txt,.xlsx,.xls" class="sr-only" @change="lerPlanilha" >
              <UIcon :name="importando ? 'i-lucide-loader-circle' : 'i-lucide-upload'" class="size-6 text-primary" :class="importando && 'animate-spin'" />
              <span class="text-sm">{{ planilha ? `${planilha.arquivo} · ${planilha.total} linha(s)` : 'Escolher arquivo CSV ou XLSX' }}</span>
            </label>
            <div v-if="planilha" class="grid gap-3 sm:grid-cols-2">
              <UFormField label="E-mail" required>
                <USelect v-model="mapa.email" :items="opcoesColuna.slice(1)" class="w-full" />
              </UFormField>
              <UFormField label="Nome"><USelect v-model="mapa.nome" :items="opcoesColuna" class="w-full" /></UFormField>
              <UFormField label="Empresa"><USelect v-model="mapa.empresa" :items="opcoesColuna" class="w-full" /></UFormField>
              <UFormField label="CPF/CNPJ"><USelect v-model="mapa.documento" :items="opcoesColuna" class="w-full" /></UFormField>
              <p class="text-xs text-muted sm:col-span-2">As demais colunas ficam guardadas como variáveis do e-mail.</p>
            </div>
          </template>

          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalAcrescentar = false" />
            <UButton :label="`Acrescentar ${entradas.length}`" icon="i-lucide-check" :loading="salvandoMembros" :disabled="!entradas.length" @click="acrescentar" />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="modalEditar" title="Editar lista">
      <template #body>
        <form class="space-y-4" @submit.prevent="salvarEdicao">
          <UFormField label="Nome" required><UInput v-model="edicao.nome" class="w-full" /></UFormField>
          <UFormField label="Descrição"><UTextarea v-model="edicao.descricao" :rows="2" class="w-full" /></UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalEditar = false" />
            <UButton type="submit" label="Salvar" :disabled="edicao.nome.trim().length < 2" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
