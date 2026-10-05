<script setup lang="ts">
import { dataHora, ROTULOS_CAIXA, CORES_CAIXA } from '~/utils/formato'

/**
 * Caixa de entrada: o que o monitor leu das caixas dos canais — devoluções,
 * recibos, respostas automáticas e respostas de clientes — e a lista de
 * supressão (endereços que devolveram definitivamente).
 *
 * Mensagem "sem vínculo" (não se liga a nenhum envio) aparece só com
 * remetente e assunto: o corpo não é guardado.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Caixa de entrada — Gaulke Comunica' })

const toast = useToast()
const { eSupervisor } = usePapel()
const aba = ref<'mensagens' | 'supressao'>('mensagens')

/* ---------- mensagens ---------- */
const TODAS = 'todas'
const filtros = reactive({ classificacao: TODAS, semVinculo: false, pagina: 1, porPagina: 50 })
const consulta = computed(() => ({
  classificacao: filtros.classificacao === TODAS ? undefined : filtros.classificacao,
  semVinculo: filtros.semVinculo ? '1' : undefined,
  pagina: filtros.pagina,
  porPagina: filtros.porPagina
}))
const { data, status: carregando } = await useFetch<{
  mensagens: MensagemCaixa[]
  total: number
  porTipo: { classificacao: string; n: number; semVinculo: number }[]
}>(api('/api/admin/caixa'), { query: consulta, watch: [consulta] })
watch(() => [filtros.classificacao, filtros.semVinculo], () => { filtros.pagina = 1 })

const opcoes = computed(() => [
  { label: 'Todas', value: TODAS },
  ...Object.entries(ROTULOS_CAIXA).map(([value, label]) => {
    const n = data.value?.porTipo.find(p => p.classificacao === value)?.n
    return { label: `${label}${n ? ` (${n})` : ''}`, value }
  })
])
const totalPaginas = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / filtros.porPagina)))
const aberta = ref<number | null>(null)

/* ---------- supressão ---------- */
const buscaSup = ref('')
const { data: sup, refresh: refreshSup } = await useFetch<{ enderecos: EnderecoSuprimido[] }>(api('/api/admin/supressao'), {
  query: computed(() => ({ busca: buscaSup.value || undefined })),
  lazy: true
})
const removendo = ref<string | null>(null)
async function removerSupressao(e: EnderecoSuprimido) {
  if (!confirm(`Tirar ${e.email} da lista de supressão?\n\nSó faça isso se tiver certeza de que o endereço voltou a existir: mandar para endereço que devolve prejudica a entrega de TODOS os envios.`)) return
  removendo.value = e.email
  try {
    await $fetch(api('/api/admin/supressao'), { method: 'DELETE', body: { email: e.email } })
    toast.add({ title: `${e.email} saiu da lista de supressão`, color: 'success' })
    await refreshSup()
  } catch (err: any) {
    toast.add({ title: 'Não foi possível remover', description: err?.statusMessage, color: 'error' })
  } finally {
    removendo.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Caixa de entrada</h1>
      <p class="text-sm text-muted">
        O que voltou dos envios: devoluções, recibos de leitura e respostas de clientes, lidos das caixas dos canais
        (somente leitura — nada é alterado nelas).
      </p>
    </div>

    <UFieldGroup>
      <UButton
        label="Mensagens"
        icon="i-lucide-inbox"
        :color="aba === 'mensagens' ? 'primary' : 'neutral'"
        :variant="aba === 'mensagens' ? 'solid' : 'outline'"
        @click="aba = 'mensagens'"
      />
      <UButton
        :label="`Supressão${sup?.enderecos.length ? ` (${sup.enderecos.length})` : ''}`"
        icon="i-lucide-ban"
        :color="aba === 'supressao' ? 'primary' : 'neutral'"
        :variant="aba === 'supressao' ? 'solid' : 'outline'"
        @click="aba = 'supressao'"
      />
    </UFieldGroup>

    <!-- Mensagens -->
    <template v-if="aba === 'mensagens'">
      <UCard>
        <div class="flex flex-wrap items-end gap-4">
          <UFormField label="Tipo" class="w-64">
            <USelect v-model="filtros.classificacao" :items="opcoes" class="w-full" />
          </UFormField>
          <USwitch v-model="filtros.semVinculo" label="Só as sem vínculo com envio" />
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="divide-y divide-default">
          <div v-for="m in data?.mensagens" :key="m.id" class="px-4 py-3">
            <div class="flex flex-wrap items-start gap-3">
              <UBadge :color="(CORES_CAIXA[m.classificacao] as any) || 'neutral'" variant="subtle" :label="ROTULOS_CAIXA[m.classificacao] ?? m.classificacao" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ m.assunto || '(sem assunto)' }}</p>
                <p class="truncate text-xs text-muted">
                  De {{ m.de || '—' }} · {{ dataHora(m.recebidoEm ?? m.processadoEm) }} · caixa {{ m.contaNome ?? '—' }}
                </p>
                <p v-if="m.recipientId" class="mt-1 text-xs">
                  <NuxtLink :to="`/admin/destinatario/${m.recipientId}`" class="text-primary hover:underline">
                    {{ m.destinatarioNome || m.destinatarioEmail }}
                  </NuxtLink>
                  <span class="text-muted"> · lote </span>
                  <NuxtLink :to="`/admin/lotes/${m.batchId}`" class="text-primary hover:underline">{{ m.loteNome }}</NuxtLink>
                </p>
                <p v-else-if="m.solicId" class="mt-1 text-xs">
                  <span class="text-muted">Solicitação </span>
                  <NuxtLink :to="`/admin/solicitacoes/${m.solicId}`" class="text-primary hover:underline">
                    {{ m.solicCodigo ?? `SOL-${String(m.solicId).padStart(6, '0')}` }} · {{ m.solicTitulo }}
                  </NuxtLink>
                </p>
                <p v-else-if="m.assinDocumentoId" class="mt-1 text-xs">
                  <span class="text-muted">Assinatura </span>
                  <NuxtLink :to="`/admin/assinaturas/${m.assinDocumentoId}`" class="text-primary hover:underline">
                    {{ m.assinCodigo ?? `ASS-${String(m.assinDocumentoId).padStart(6, '0')}` }} · {{ m.assinTitulo }}
                  </NuxtLink>
                </p>
                <p v-else class="mt-1 text-xs text-muted italic">Sem vínculo com envio</p>
                <p v-if="m.detalhe?.diagnostico || m.detalhe?.status" class="mt-1 break-all text-xs text-error">
                  {{ [m.detalhe?.status, m.detalhe?.diagnostico].filter(Boolean).join(' — ') }}
                  <template v-if="m.detalhe?.destinatarioFalho"> ({{ m.detalhe.destinatarioFalho }})</template>
                </p>
              </div>
              <UBadge
                v-if="m.ticketCode || m.ticketStatus"
                icon="i-lucide-ticket"
                :color="m.ticketStatus === 'erro' ? 'error' : m.ticketCode ? 'primary' : 'warning'"
                variant="subtle"
                :label="m.ticketCode ?? (m.ticketStatus === 'erro' ? 'chamado com erro' : 'chamado na fila')"
              />
              <UButton
                v-if="m.classificacao === 'resposta' && (m.recipientId || m.solicId || m.assinDocumentoId)"
                :to="`/admin/caixa/${m.id}`"
                label="Abrir e responder"
                icon="i-lucide-mail-open"
                size="xs"
                color="primary"
                variant="soft"
              />
              <UButton
                v-if="m.trecho"
                :icon="aberta === m.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="aberta === m.id ? 'Ocultar mensagem' : 'Ver mensagem'"
                @click="aberta = aberta === m.id ? null : m.id"
              />
            </div>
            <pre v-if="aberta === m.id && m.trecho" class="mt-2 whitespace-pre-wrap break-words rounded bg-elevated/50 p-3 text-sm">{{ m.trecho }}</pre>
          </div>
          <p v-if="!data?.mensagens.length" class="py-12 text-center text-muted">
            {{ carregando === 'pending' ? 'Carregando…' : 'Nada lido ainda. Ligue “Monitorar a caixa de entrada” em Configurações → canal.' }}
          </p>
        </div>
        <div v-if="(data?.total ?? 0) > filtros.porPagina" class="flex items-center justify-between border-t border-default px-4 py-3 text-sm">
          <span class="text-muted">{{ data?.total }} mensagem(ns)</span>
          <div class="flex items-center gap-2">
            <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina <= 1" @click="filtros.pagina--" />
            <span class="text-xs text-muted">{{ filtros.pagina }} / {{ totalPaginas }}</span>
            <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina >= totalPaginas" @click="filtros.pagina++" />
          </div>
        </div>
      </UCard>
    </template>

    <!-- Supressão -->
    <template v-else>
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        description="Endereços que devolveram definitivamente (não existem, domínio inexistente). Eles ficam de fora dos novos envios e dos reenvios: mandar de novo só gera outra devolução e piora a entrega de todos os envios. Para reenviar a uma dessas pessoas, corrija o e-mail dela no reenvio."
      />
      <UInput v-model="buscaSup" icon="i-lucide-search" placeholder="Buscar endereço" class="w-full sm:w-80" />
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="divide-y divide-default">
          <div v-for="e in sup?.enderecos" :key="e.email" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="break-all text-sm font-medium">{{ e.email }}</p>
              <p class="break-all text-xs text-muted">{{ e.motivo || '—' }} · desde {{ dataHora(e.criadoEm) }}</p>
            </div>
            <UButton
              v-if="e.recipientId"
              :to="`/admin/destinatario/${e.recipientId}`"
              label="Destinatário"
              size="xs"
              color="neutral"
              variant="ghost"
            />
            <UButton
              v-if="eSupervisor"
              label="Tirar da lista"
              icon="i-lucide-undo-2"
              size="xs"
              color="neutral"
              variant="outline"
              :loading="removendo === e.email"
              @click="removerSupressao(e)"
            />
          </div>
          <p v-if="!sup?.enderecos.length" class="py-12 text-center text-muted">Nenhum endereço suprimido.</p>
        </div>
      </UCard>
    </template>
  </div>
</template>
