<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * E-mail recebido: a resposta do cliente inteira, os arquivos que ele mandou
 * e o "Responder", que sai pelo canal na mesma conversa. Existe porque quem
 * pediu quase nunca tem acesso à caixa do canal — o chamado no painel aponta
 * para cá.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })

type Mensagem = {
  id: number
  contaNome: string | null
  de: string | null
  para: string | null
  assunto: string | null
  recebidoEm: string | null
  processadoEm: string
  classificacao: string
  texto: string | null
  completo: boolean
  html: string | null
  temEml: boolean
  anexos: { n: number; nome: string; tipo: string; tamanho: number; antivirus: string }[]
  vinculo:
    | { tipo: 'solicitacao' | 'assinatura' | 'lote'; id: number; codigo: string; titulo: string; cliente: string | null; empresa: string | null; destinatarioId?: number }
    | null
  ticket: { code: string | null; status: string } | null
  podeResponder: boolean
  respostas: { id: number; para: string; assunto: string; texto: string; anexos: { nome: string; tamanho: number }[]; porNome: string | null; enviadoEm: string | null; erro: string | null; criadoEm: string }[]
}

const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)
const { data: m, error, refresh } = await useFetch<Mensagem>(api(`/api/admin/caixa/${id}`))
useHead({ title: () => `${m.value?.assunto || 'E-mail recebido'} — Gaulke Comunica` })

const verHtml = ref(false)
const linkVinculo = computed(() => {
  const v = m.value?.vinculo
  if (!v) return null
  if (v.tipo === 'solicitacao') return `/admin/solicitacoes/${v.id}`
  if (v.tipo === 'assinatura') return `/admin/assinaturas/${v.id}`
  return v.destinatarioId ? `/admin/destinatario/${v.destinatarioId}` : `/admin/lotes/${v.id}`
})
const ROTULO_VINCULO = { solicitacao: 'Solicitação', assinatura: 'Assinatura', lote: 'Envio' } as const
const abreNoNavegador = (tipo: string) => /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(tipo)

/* ---------- responder ---------- */
const texto = ref('')
const arquivos = ref<File[]>([])
const enviando = ref(false)
function escolher(e: Event) {
  const input = e.target as HTMLInputElement
  arquivos.value = [...arquivos.value, ...(input.files ?? [])].slice(0, 10)
  input.value = ''
}
async function responder() {
  enviando.value = true
  try {
    const fd = new FormData()
    fd.append('texto', texto.value)
    for (const f of arquivos.value) fd.append('arquivo', f)
    const r = await $fetch<{ para: string }>(api(`/api/admin/caixa/${id}/responder`), { method: 'POST', body: fd })
    toast.add({ title: `Resposta enviada para ${r.para}`, description: 'Ela chega na mesma conversa do cliente e foi registrada no chamado.', color: 'success', icon: 'i-lucide-send' })
    texto.value = ''
    arquivos.value = []
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'A resposta não saiu', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <NuxtLink to="/admin/caixa" class="text-sm text-muted hover:text-primary">
      <UIcon name="i-lucide-arrow-left" class="align-[-2px]" /> Caixa de entrada
    </NuxtLink>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-mail-x" :title="error.statusMessage || 'Não foi possível abrir a mensagem'" />

    <template v-else-if="m">
      <!-- cabeçalho -->
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">{{ m.assunto || '(sem assunto)' }}</h1>
        <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt class="inline text-muted">De: </dt><dd class="inline break-all font-medium">{{ m.de || '—' }}</dd></div>
          <div><dt class="inline text-muted">Recebida em: </dt><dd class="inline">{{ dataHora(m.recebidoEm ?? m.processadoEm) }}</dd></div>
          <div v-if="m.para"><dt class="inline text-muted">Para: </dt><dd class="inline break-all">{{ m.para }}</dd></div>
          <div><dt class="inline text-muted">Caixa: </dt><dd class="inline">{{ m.contaNome || '—' }}</dd></div>
        </dl>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <UButton
            v-if="m.vinculo && linkVinculo"
            :to="linkVinculo"
            :label="`${ROTULO_VINCULO[m.vinculo.tipo]} ${m.vinculo.codigo} · ${m.vinculo.titulo}`"
            icon="i-lucide-link"
            color="neutral"
            variant="outline"
            size="sm"
            class="max-w-full"
          />
          <UBadge v-if="m.ticket" icon="i-lucide-ticket" color="primary" variant="subtle" :label="m.ticket.code ?? (m.ticket.status === 'erro' ? 'chamado com erro' : 'chamado na fila')" />
          <UButton v-if="m.temEml" :to="api(`/api/admin/caixa/${id}/eml`)" external label="Baixar e-mail (.eml)" icon="i-lucide-download" color="neutral" variant="ghost" size="sm" />
        </div>
      </div>

      <!-- corpo -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-semibold">Mensagem do cliente</h2>
            <UButton
              v-if="m.html"
              :label="verHtml ? 'Ver como texto' : 'Ver formatado'"
              :icon="verHtml ? 'i-lucide-text' : 'i-lucide-layout-template'"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="verHtml = !verHtml"
            />
          </div>
        </template>
        <iframe v-if="verHtml && m.html" :srcdoc="m.html" sandbox="" class="h-[60vh] w-full rounded-lg border border-default bg-white" title="Mensagem formatada" />
        <pre v-else class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{{ m.texto || '(sem texto)' }}</pre>
        <p v-if="!m.completo" class="mt-3 text-xs text-muted">
          Esta mensagem chegou antes de o sistema guardar os e-mails por inteiro: aqui está só o trecho lido na época.
        </p>
      </UCard>

      <!-- anexos -->
      <UCard v-if="m.anexos.length">
        <template #header><h2 class="font-semibold">Anexos do cliente ({{ m.anexos.length }})</h2></template>
        <ul class="divide-y divide-default">
          <li v-for="a in m.anexos" :key="a.n" class="flex flex-wrap items-center gap-3 py-2 text-sm">
            <UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate" :class="a.antivirus === 'infectado' && 'text-muted line-through'">{{ a.nome }}</span>
            <span class="text-xs text-muted">{{ tamanho(a.tamanho) }}</span>
            <UBadge v-if="a.antivirus === 'infectado'" color="error" variant="subtle" size="sm" icon="i-lucide-shield-x">bloqueado pelo antivírus</UBadge>
            <template v-else>
              <UButton v-if="abreNoNavegador(a.tipo)" :to="api(`/api/admin/caixa/${id}/anexos/${a.n}?ver=1`)" external target="_blank" icon="i-lucide-eye" size="xs" color="neutral" variant="ghost" aria-label="Ver" />
              <UButton :to="api(`/api/admin/caixa/${id}/anexos/${a.n}`)" external icon="i-lucide-download" size="xs" color="neutral" variant="ghost" aria-label="Baixar" />
            </template>
          </li>
        </ul>
      </UCard>

      <!-- respostas já enviadas -->
      <UCard v-if="m.respostas.length">
        <template #header><h2 class="font-semibold">Respostas enviadas pelo sistema</h2></template>
        <div class="space-y-4">
          <div v-for="r in m.respostas" :key="r.id" class="rounded-lg border px-3 py-2" :class="r.erro ? 'border-error/40 bg-error/5' : 'border-default'">
            <p class="text-xs text-muted">
              {{ r.porNome || '—' }} · {{ dataHora(r.enviadoEm ?? r.criadoEm) }} · para {{ r.para }}
              <span v-if="r.erro" class="font-medium text-error"> · não saiu: {{ r.erro }}</span>
            </p>
            <p class="mt-1 whitespace-pre-wrap text-sm">{{ r.texto }}</p>
            <p v-if="r.anexos.length" class="mt-1 text-xs text-muted">
              <UIcon name="i-lucide-paperclip" class="align-[-2px]" /> {{ r.anexos.map(a => a.nome).join(', ') }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- responder -->
      <UCard v-if="m.podeResponder">
        <template #header>
          <div>
            <h2 class="font-semibold">Responder ao cliente</h2>
            <p class="text-xs text-muted">
              Sai pela caixa {{ m.contaNome }}, para {{ m.de }}, na mesma conversa do e-mail dele. A mensagem dele vai citada embaixo.
            </p>
          </div>
        </template>
        <div class="space-y-3">
          <UTextarea v-model="texto" :rows="6" autoresize :maxrows="20" class="w-full" placeholder="Escreva a resposta…" />
          <div class="flex flex-wrap items-center gap-2">
            <label class="inline-flex">
              <input type="file" multiple class="sr-only" @change="escolher" />
              <UButton as="span" label="Anexar arquivo" icon="i-lucide-paperclip" color="neutral" variant="outline" size="sm" class="cursor-pointer" />
            </label>
            <UBadge
              v-for="(f, i) in arquivos"
              :key="i"
              color="neutral"
              variant="subtle"
              class="gap-1"
            >
              {{ f.name }}
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="link" class="p-0" :aria-label="`Tirar ${f.name}`" @click="arquivos = arquivos.filter((_, j) => j !== i)" />
            </UBadge>
          </div>
          <div class="flex justify-end">
            <UButton label="Enviar resposta" icon="i-lucide-send" :loading="enviando" :disabled="texto.trim().length < 2" @click="responder" />
          </div>
        </div>
      </UCard>
      <p v-else-if="m.classificacao === 'resposta'" class="text-sm text-muted">
        Esta mensagem não está ligada a um envio do sistema, por isso não dá para responder por aqui.
      </p>
    </template>
  </div>
</template>
