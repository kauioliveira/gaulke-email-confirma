<script setup lang="ts">
definePageMeta({ layout: 'admin' })

/**
 * Um documento em assinatura: quem já assinou e quem está com a vez, o PDF
 * original e o assinado, e o histórico encadeado (com a conferência da
 * corrente de hashes).
 */
const route = useRoute()
const toast = useToast()
const { sessao, pode } = usePapel()
const id = Number(route.params.id)
const { data: d, refresh, error } = await useFetch<DetalheAssinatura>(api(`/api/admin/assinaturas/${id}`))
useHead({ title: () => (d.value ? `${d.value.codigo} — ${d.value.titulo}` : 'Assinatura') })

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && d.value?.status === 'aguardando' && !ocupado.value) refresh()
  }, 20_000)
})
onBeforeUnmount(() => clearInterval(timer))

const ocupado = ref<string | null>(null)
async function acao(chave: string, fn: () => Promise<unknown>, ok?: string) {
  ocupado.value = chave
  try {
    await fn()
    if (ok) toast.add({ title: ok, color: 'success' })
    await refresh()
    return true
  } catch (e: any) {
    toast.add({ title: 'Não foi possível concluir', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
    return false
  } finally {
    ocupado.value = null
  }
}

const reenviando = ref<SignatarioAssinatura | null>(null)
const emailReenvio = ref('')
async function reenviar() {
  const s = reenviando.value
  if (!s) return
  const ok = await acao(`reenviar-${s.id}`, () =>
    $fetch(api(`/api/admin/assinaturas/${id}/signatarios/${s.id}/reenviar`), { method: 'POST', body: { email: emailReenvio.value.trim() || null } }),
    'Convite reenviado'
  )
  if (ok) reenviando.value = null
}

const cancelando = ref(false)
const motivo = ref('')
async function cancelar() {
  const ok = await acao('cancelar', () => $fetch(api(`/api/admin/assinaturas/${id}/cancelar`), { method: 'POST', body: { motivo: motivo.value } }), 'Documento cancelado')
  if (ok) cancelando.value = false
}
function gerarDeNovo() {
  return acao('finalizar', () => $fetch(api(`/api/admin/assinaturas/${id}/finalizar`), { method: 'POST' }), 'PDF final gerado')
}
const podeCancelar = computed(() => !!d.value && (d.value.criadoPorUserId === sessao.value?.usuario?.id || pode('supervisor')))

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.add({ title: 'Copiado', color: 'success' })
  } catch {
    toast.add({ title: texto, color: 'neutral' })
  }
}

const ICONE_EVENTO: Record<string, string> = {
  resposta_email: 'i-lucide-reply',
  devolucao: 'i-lucide-mail-x',
  auto_resposta: 'i-lucide-bot',
  recibo: 'i-lucide-mail-check',
  criado: 'i-lucide-sparkles',
  email_convite: 'i-lucide-send',
  email_lembrete: 'i-lucide-bell',
  email_erro: 'i-lucide-mail-x',
  email_corrigido: 'i-lucide-at-sign',
  visualizado: 'i-lucide-eye',
  codigo_enviado: 'i-lucide-key-round',
  codigo_invalido: 'i-lucide-shield-alert',
  assinado: 'i-lucide-signature',
  recusado: 'i-lucide-circle-x',
  concluido: 'i-lucide-badge-check',
  cancelado: 'i-lucide-ban',
  finalizacao_erro: 'i-lucide-triangle-alert'
}
</script>

<template>
  <div v-if="error" class="py-20 text-center">
    <p class="text-muted">Documento não encontrado.</p>
    <UButton to="/admin/assinaturas" label="Voltar" variant="soft" class="mt-4" />
  </div>
  <div v-else-if="d" class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <NuxtLink to="/admin/assinaturas" class="text-sm text-muted hover:text-primary"><UIcon name="i-lucide-arrow-left" class="mr-1 size-3.5 align-[-2px]" />Assinaturas</NuxtLink>
        <h1 class="mt-1 text-2xl font-semibold">{{ d.titulo }}</h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span class="font-mono">{{ d.codigo }}</span>
          <UBadge :color="COR_STATUS_ASSIN[d.status]" variant="subtle">{{ ROTULO_STATUS_ASSIN[d.status] }}</UBadge>
          <UBadge v-if="d.assinarComoGaulke" color="primary" variant="subtle" icon="i-lucide-badge-check">Selo da Gaulke</UBadge>
          <span>· enviado por {{ d.criadoPorNome || '—' }} em {{ formatarDataHora(d.enviadoEm || d.createdAt) }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="d.status === 'concluido'" label="Baixar assinado" icon="i-lucide-file-check" :to="api(`/api/admin/assinaturas/${id}/pdf?versao=final`)" external />
        <UButton label="Original" icon="i-lucide-file" color="neutral" variant="outline" :to="api(`/api/admin/assinaturas/${id}/pdf?inline=1`)" target="_blank" external />
        <UButton v-if="d.status === 'aguardando' && podeCancelar" label="Cancelar" icon="i-lucide-ban" color="error" variant="ghost" @click="motivo = ''; cancelando = true" />
      </div>
    </div>

    <UAlert
      v-if="d.finalizacaoErro"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Todos assinaram, mas o PDF final não foi gerado"
      :description="d.finalizacaoErro"
      :actions="[{ label: 'Gerar de novo', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'solid', loading: ocupado === 'finalizar', onClick: gerarDeNovo }]"
    />
    <UAlert v-if="d.status === 'cancelado'" color="neutral" variant="subtle" icon="i-lucide-ban" title="Cancelado" :description="`Em ${formatarDataHora(d.canceladoEm)} por ${d.canceladoPorNome}: ${d.canceladoMotivo}`" />
    <UAlert v-if="!d.corrente.ok" color="error" variant="solid" icon="i-lucide-shield-x" title="O histórico foi alterado" :description="`A corrente de hashes quebra no evento #${d.corrente.quebraNoEvento}. Avise a TI.`" />

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-2">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Quem assina</h2>
              <span class="text-sm text-muted">{{ d.assinados }}/{{ d.total }} · {{ d.ordem === 'sequencial' ? 'um depois do outro' : 'todos ao mesmo tempo' }}</span>
            </div>
          </template>
          <ul class="divide-y divide-default">
            <li v-for="s in d.signatarios" :key="s.id" class="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold">{{ s.ordem }}</span>
              <div class="min-w-0 flex-1">
                <p class="font-medium">{{ s.nome }} <span v-if="s.papel" class="text-sm font-normal text-muted">· {{ s.papel }}</span></p>
                <p class="text-sm text-muted">
                  {{ s.email }}
                  <NuxtLink :to="`/admin/clientes?email=${encodeURIComponent(s.email)}`" class="ml-1 inline-flex items-center align-middle text-primary" title="Linha do tempo do cliente">
                    <UIcon name="i-lucide-history" class="size-3.5" />
                  </NuxtLink>
                </p>
                <p class="mt-1 text-xs text-muted">
                  <template v-if="s.assinadoEm">Assinou em {{ formatarDataHora(s.assinadoEm) }} · IP {{ s.ip }} · {{ s.tipoAssinatura === 'desenhada' ? 'desenhou' : 'digitou o nome' }}</template>
                  <template v-else-if="s.recusadoEm">Recusou em {{ formatarDataHora(s.recusadoEm) }}: “{{ s.recusaMotivo }}”</template>
                  <template v-else-if="s.status === 'aguardando'">
                    Convite {{ s.conviteEnviadoEm ? `enviado em ${formatarDataHora(s.conviteEnviadoEm)}` : 'enviando…' }}
                    · {{ s.visualizadoEm ? `abriu em ${formatarDataHora(s.visualizadoEm)}` : 'ainda não abriu' }}
                    <template v-if="s.lembretesEnviados"> · {{ s.lembretesEnviados }} lembrete(s)</template>
                  </template>
                  <template v-else>Recebe o convite quando for a vez.</template>
                </p>
                <p v-if="s.envioErro" class="mt-1 text-xs text-error">O e-mail não saiu: {{ s.envioErro }}</p>
              </div>
              <UBadge :color="COR_SIGNATARIO[s.status]" variant="subtle">{{ ROTULO_SIGNATARIO[s.status] }}</UBadge>
              <UButton
                v-if="d.status === 'aguardando' && s.status === 'aguardando'"
                label="Reenviar"
                icon="i-lucide-send"
                color="neutral"
                variant="outline"
                size="xs"
                @click="reenviando = s; emailReenvio = s.email"
              />
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header><h2 class="font-semibold">Documento</h2></template>
          <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="text-muted">Arquivo original</dt>
            <dd>{{ d.originalNome }} · {{ d.originalPaginas }} página(s)</dd>
            <dt class="text-muted">SHA-256 do original</dt>
            <dd class="break-all font-mono text-xs">{{ d.originalSha256 }}</dd>
            <template v-if="d.finalSha256">
              <dt class="text-muted">SHA-256 do assinado</dt>
              <dd class="break-all font-mono text-xs">{{ d.finalSha256 }}</dd>
            </template>
            <dt class="text-muted">Validação pública</dt>
            <dd class="flex items-center gap-2">
              <span class="font-mono">{{ d.codigoVerificacao }}</span>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copiar link" @click="copiar(d.linkValidacao)" />
              <NuxtLink :to="`/validar?c=${d.codigoVerificacao}`" target="_blank" class="text-xs text-primary hover:underline">abrir</NuxtLink>
            </dd>
            <template v-if="d.certificado">
              <dt class="text-muted">Selo</dt>
              <dd>{{ d.certificado.nome }} ({{ d.certificado.titular }}, vence {{ formatarData(d.certificado.validoAte) }})</dd>
            </template>
            <template v-if="d.clienteNome || d.clienteDocumento">
              <dt class="text-muted">Referente a</dt>
              <dd>{{ [d.clienteNome, d.clienteDocumento].filter(Boolean).join(' · ') }}</dd>
            </template>
            <dt class="text-muted">Prazo</dt>
            <dd>{{ formatarPrazo(d.prazo) }}</dd>
            <dt class="text-muted">Canal · respostas</dt>
            <dd>{{ d.contaNome || 'padrão' }} · {{ d.responderPara || 'o do canal' }}</dd>
            <dt class="text-muted">Pasta</dt>
            <dd class="break-all font-mono text-xs">{{ d.pasta }}</dd>
          </dl>
          <p v-if="d.mensagem" class="mt-4 whitespace-pre-line rounded-md bg-elevated/50 p-3 text-sm">{{ d.mensagem }}</p>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Histórico</h2>
            <UTooltip :text="d.corrente.ok ? `Corrente de hashes íntegra (${d.corrente.eventos} eventos)` : 'Corrente quebrada'">
              <UBadge :color="d.corrente.ok ? 'success' : 'error'" variant="subtle" :icon="d.corrente.ok ? 'i-lucide-link' : 'i-lucide-unlink'">{{ d.corrente.ok ? 'íntegro' : 'alterado' }}</UBadge>
            </UTooltip>
          </div>
        </template>
        <ol class="space-y-3">
          <li v-for="e in [...d.eventos].reverse()" :key="e.id" class="flex gap-3 text-sm">
            <UIcon :name="ICONE_EVENTO[e.tipo] || 'i-lucide-dot'" class="mt-0.5 size-4 shrink-0 text-muted" />
            <div class="min-w-0">
              <p class="break-words">{{ e.descricao }}</p>
              <p class="text-xs text-muted">
                {{ formatarDataHora(e.criadoEm) }}<template v-if="e.porNome"> · {{ e.porNome }}</template><template v-if="e.ip"> · IP {{ e.ip }}</template>
              </p>
              <p class="truncate font-mono text-[10px] text-muted/70" :title="e.hash">{{ e.hash }}</p>
            </div>
          </li>
        </ol>
      </UCard>
    </div>

    <UModal :open="!!reenviando" title="Reenviar o convite" description="O link continua o mesmo. Corrija o e-mail se a pessoa informou outro." @update:open="v => { if (!v) reenviando = null }">
      <template #body>
        <UFormField label="Para"><UInput v-model="emailReenvio" type="email" class="w-full" /></UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="reenviando = null" />
          <UButton label="Reenviar agora" icon="i-lucide-send" :loading="ocupado?.startsWith('reenviar')" @click="reenviar" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="cancelando" title="Cancelar o documento" description="Os links deixam de funcionar para quem ainda não assinou. As assinaturas já feitas ficam no histórico.">
      <template #body>
        <UFormField label="Motivo" required><UTextarea v-model="motivo" :rows="2" autoresize class="w-full" /></UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="cancelando = false" />
          <UButton label="Cancelar documento" icon="i-lucide-ban" color="error" :disabled="motivo.trim().length < 3" :loading="ocupado === 'cancelar'" @click="cancelar" />
        </div>
      </template>
    </UModal>
  </div>
</template>
