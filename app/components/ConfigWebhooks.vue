<script setup lang="ts">
/**
 * Webhooks (n8n e afins): avisam outro sistema quando algo acontece aqui.
 * Cada entrega vai assinada com HMAC; o segredo aparece uma vez só.
 */
const toast = useToast()
type Resposta = { webhooks: WebhookCadastrado[]; eventos: { valor: string; rotulo: string }[] }
const { data, refresh } = await useFetch<Resposta>(api('/api/admin/webhooks'))

/* ---------- criar / editar ---------- */
const editor = ref(false)
const editando = ref<WebhookCadastrado | null>(null)
const form = reactive({ nome: '', url: '', eventos: [] as string[], todos: false, ativo: true })
function abrir(w?: WebhookCadastrado) {
  editando.value = w ?? null
  form.nome = w?.nome ?? 'n8n'
  form.url = w?.url ?? ''
  form.todos = w?.eventos.includes('*') ?? false
  form.eventos = w ? w.eventos.filter(e => e !== '*') : ['assinatura.concluida', 'solicitacao.concluida']
  form.ativo = w?.ativo ?? true
  editor.value = true
}
function alternarEvento(v: string) {
  form.eventos = form.eventos.includes(v) ? form.eventos.filter(e => e !== v) : [...form.eventos, v]
}
const salvando = ref(false)
const segredoNovo = ref<string | null>(null)
async function salvar() {
  salvando.value = true
  const body = { nome: form.nome, url: form.url, eventos: form.todos ? ['*'] : form.eventos, ativo: form.ativo }
  try {
    if (editando.value) {
      await $fetch(api(`/api/admin/webhooks/${editando.value.id}`), { method: 'PUT', body })
      toast.add({ title: 'Webhook salvo', color: 'success' })
    } else {
      const r = await $fetch<{ id: number; segredo: string }>(api('/api/admin/webhooks'), { method: 'POST', body })
      segredoNovo.value = r.segredo
    }
    editor.value = false
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

async function alternarAtivo(w: WebhookCadastrado, ativo: boolean) {
  try {
    await $fetch(api(`/api/admin/webhooks/${w.id}`), { method: 'PUT', body: { nome: w.nome, url: w.url, eventos: w.eventos, ativo } })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível alterar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  }
}

async function trocarSegredo(w: WebhookCadastrado) {
  if (!confirm(`Gerar um novo segredo para "${w.nome}"? O atual para de valer agora — atualize no n8n em seguida.`)) return
  const r = await $fetch<{ segredo: string }>(api(`/api/admin/webhooks/${w.id}/segredo`), { method: 'POST' })
  segredoNovo.value = r.segredo
}

async function excluir(w: WebhookCadastrado) {
  if (!confirm(`Excluir o webhook "${w.nome}"? As entregas pendentes não saem mais.`)) return
  await $fetch(api(`/api/admin/webhooks/${w.id}`), { method: 'DELETE' })
  toast.add({ title: 'Webhook excluído', color: 'success' })
  await refresh()
}

const testando = ref<number | null>(null)
async function testar(w: WebhookCadastrado) {
  testando.value = w.id
  try {
    const r = await $fetch<{ ok: boolean; status: number | null; erro: string | null; ms: number }>(api(`/api/admin/webhooks/${w.id}/testar`), { method: 'POST' })
    toast.add({
      title: r.ok ? `Entregue (HTTP ${r.status}, ${r.ms} ms)` : 'O teste falhou',
      description: r.ok ? undefined : r.erro ?? undefined,
      color: r.ok ? 'success' : 'error'
    })
    await refresh()
  } finally {
    testando.value = null
  }
}

/* ---------- entregas ---------- */
const vendo = ref<WebhookCadastrado | null>(null)
const entregas = ref<EntregaWebhook[]>([])
async function verEntregas(w: WebhookCadastrado) {
  vendo.value = w
  entregas.value = await $fetch<EntregaWebhook[]>(api(`/api/admin/webhooks/${w.id}/entregas`))
}
async function reenviar(e: EntregaWebhook) {
  await $fetch(api(`/api/admin/webhooks/entregas/${e.id}/reenviar`), { method: 'POST' })
  toast.add({ title: 'Entrega de volta à fila', description: 'Sai em até 30 segundos.', color: 'success' })
  if (vendo.value) await verEntregas(vendo.value)
}
const COR_ENTREGA = { pendente: 'warning', entregue: 'success', erro: 'error' } as const

const rotuloEvento = (v: string) => (v === '*' ? 'todos os eventos' : data.value?.eventos.find(e => e.valor === v)?.rotulo ?? v)
async function copiar(t: string) {
  try {
    await navigator.clipboard.writeText(t)
    toast.add({ title: 'Copiado', color: 'success' })
  } catch {
    /* sem permissao de area de transferencia: o texto continua na tela */
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-webhook" class="size-5 text-primary" />
          <div>
            <h2 class="font-semibold">Webhooks (n8n)</h2>
            <p class="text-sm text-muted">Avisa outro sistema quando algo acontece aqui: assinatura concluída, documentos entregues…</p>
          </div>
        </div>
        <UButton label="Novo webhook" icon="i-lucide-plus" @click="abrir()" />
      </div>
    </template>

    <p v-if="!data?.webhooks.length" class="py-4 text-sm text-muted">
      Nenhum webhook. No n8n, crie um nó “Webhook” (método POST) e cole a URL de produção dele aqui.
    </p>
    <ul v-else class="divide-y divide-default">
      <li v-for="w in data.webhooks" :key="w.id" class="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
        <div class="min-w-0 flex-1 space-y-1">
          <p class="font-medium">
            {{ w.nome }}
            <UBadge v-if="!w.ativo" color="neutral" variant="subtle" label="desligado" class="ml-1" />
          </p>
          <p class="break-all font-mono text-xs text-muted">{{ w.url }}</p>
          <div class="flex flex-wrap gap-1">
            <UBadge v-for="e in w.eventos" :key="e" color="neutral" variant="outline" size="sm" :label="rotuloEvento(e)" />
          </div>
          <p class="text-xs" :class="w.ultimoErro ? 'text-error' : 'text-muted'">
            <template v-if="w.ultimaEntregaEm">
              Última entrega {{ formatarDataHora(w.ultimaEntregaEm) }}:
              {{ w.ultimoErro ? w.ultimoErro : `HTTP ${w.ultimoStatus}` }}
            </template>
            <template v-else>Nada entregue ainda.</template>
            <template v-if="w.pendentes"> · {{ w.pendentes }} na fila</template>
            <template v-if="w.falhas"> · {{ w.falhas }} desistida(s)</template>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <USwitch :model-value="w.ativo" @update:model-value="v => alternarAtivo(w, Boolean(v))" />
          <UButton label="Testar" icon="i-lucide-send" size="xs" color="neutral" variant="outline" :loading="testando === w.id" @click="testar(w)" />
          <UDropdownMenu
            :items="[
              { label: 'Editar', icon: 'i-lucide-pencil', onSelect: () => abrir(w) },
              { label: 'Entregas recentes', icon: 'i-lucide-list', onSelect: () => verEntregas(w) },
              { label: 'Gerar novo segredo', icon: 'i-lucide-key-round', onSelect: () => trocarSegredo(w) },
              { label: 'Excluir', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => excluir(w) }
            ]"
          >
            <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" aria-label="Mais ações" />
          </UDropdownMenu>
        </div>
      </li>
    </ul>

    <!-- criar / editar -->
    <UModal v-model:open="editor" :title="editando ? 'Editar webhook' : 'Novo webhook'" :ui="{ content: 'sm:max-w-xl' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="salvar">
          <UFormField label="Nome" required><UInput v-model="form.nome" class="w-full" /></UFormField>
          <UFormField label="URL" required help="A URL de produção do nó Webhook do n8n (POST).">
            <UInput v-model="form.url" placeholder="https://n8n.contabilgaulke.com.br/webhook/…" class="w-full font-mono text-sm" />
          </UFormField>
          <UFormField label="Eventos">
            <UCheckbox v-model="form.todos" label="Todos (inclusive os que forem criados depois)" class="mb-2" />
            <div v-if="!form.todos" class="grid gap-1.5 sm:grid-cols-2">
              <UCheckbox
                v-for="e in data?.eventos"
                :key="e.valor"
                :model-value="form.eventos.includes(e.valor)"
                :label="e.rotulo"
                :description="e.valor"
                @update:model-value="alternarEvento(e.valor)"
              />
            </div>
          </UFormField>
          <USwitch v-model="form.ativo" label="Ligado" />
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" @click="editor = false" />
            <UButton type="submit" label="Salvar" :loading="salvando" :disabled="!form.url || (!form.todos && !form.eventos.length)" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- segredo: mostrado uma vez -->
    <UModal :open="!!segredoNovo" title="Segredo do webhook" @update:open="v => { if (!v) segredoNovo = null }">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm">
            Copie agora: ele <strong>não aparece de novo</strong>. No n8n, confira o cabeçalho
            <code>X-Gaulke-Assinatura</code> = <code>sha256=</code>HMAC-SHA256(segredo, <code>X-Gaulke-Timestamp</code> + "." + corpo).
          </p>
          <div class="flex items-center gap-2 rounded-lg border border-default bg-elevated/50 p-3">
            <code class="min-w-0 flex-1 break-all text-sm">{{ segredoNovo }}</code>
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Copiar" @click="copiar(segredoNovo!)" />
          </div>
          <div class="flex justify-end"><UButton label="Guardei" @click="segredoNovo = null" /></div>
        </div>
      </template>
    </UModal>

    <!-- entregas recentes -->
    <UModal :open="!!vendo" :title="`Entregas — ${vendo?.nome ?? ''}`" :ui="{ content: 'sm:max-w-2xl' }" @update:open="v => { if (!v) vendo = null }">
      <template #body>
        <p v-if="!entregas.length" class="py-6 text-center text-sm text-muted">Nenhuma entrega ainda.</p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="e in entregas" :key="e.id" class="flex flex-wrap items-center gap-2 py-2">
            <UBadge :color="COR_ENTREGA[e.status]" variant="subtle" :label="e.status" />
            <span class="font-mono text-xs">{{ e.evento }}</span>
            <span class="text-xs text-muted">{{ formatarDataHora(e.criadoEm) }} · {{ e.tentativas }} tentativa(s)</span>
            <span v-if="e.ultimoErro" class="w-full truncate text-xs text-error">{{ e.ultimoErro }}</span>
            <span v-else-if="e.status === 'pendente'" class="w-full text-xs text-muted">próxima tentativa {{ formatarDataHora(e.proximaTentativaEm) }}</span>
            <UButton v-if="e.status === 'erro'" label="Reenviar" size="xs" color="neutral" variant="outline" class="ml-auto" @click="reenviar(e)" />
          </li>
        </ul>
      </template>
    </UModal>
  </UCard>
</template>
