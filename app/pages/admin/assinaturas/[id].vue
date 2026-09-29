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

/** Cada tipo de evento: título curto, ícone e cor na linha do tempo. */
type Cor = 'success' | 'primary' | 'warning' | 'error' | 'neutral' | 'info'
const TIPO_EVENTO: Record<string, { titulo: string; icone: string; cor: Cor }> = {
  criado: { titulo: 'Documento enviado para assinatura', icone: 'i-lucide-sparkles', cor: 'primary' },
  email_convite: { titulo: 'Convite enviado', icone: 'i-lucide-send', cor: 'info' },
  email_lembrete: { titulo: 'Lembrete enviado', icone: 'i-lucide-bell', cor: 'info' },
  email_erro: { titulo: 'Falha no envio do e-mail', icone: 'i-lucide-mail-x', cor: 'error' },
  email_corrigido: { titulo: 'E-mail corrigido', icone: 'i-lucide-at-sign', cor: 'warning' },
  visualizado: { titulo: 'Abriu o documento', icone: 'i-lucide-eye', cor: 'neutral' },
  codigo_enviado: { titulo: 'Código de confirmação enviado', icone: 'i-lucide-key-round', cor: 'neutral' },
  codigo_invalido: { titulo: 'Código inválido', icone: 'i-lucide-shield-alert', cor: 'warning' },
  assinado: { titulo: 'Assinou', icone: 'i-lucide-signature', cor: 'success' },
  recusado: { titulo: 'Recusou', icone: 'i-lucide-circle-x', cor: 'error' },
  concluido: { titulo: 'Assinado por todos', icone: 'i-lucide-badge-check', cor: 'success' },
  cancelado: { titulo: 'Cancelado', icone: 'i-lucide-ban', cor: 'neutral' },
  finalizacao_erro: { titulo: 'Falha ao gerar o PDF final', icone: 'i-lucide-triangle-alert', cor: 'error' },
  resposta_email: { titulo: 'Respondeu por e-mail', icone: 'i-lucide-reply', cor: 'primary' },
  devolucao: { titulo: 'E-mail devolvido', icone: 'i-lucide-mail-x', cor: 'error' },
  auto_resposta: { titulo: 'Resposta automática', icone: 'i-lucide-bot', cor: 'neutral' },
  recibo: { titulo: 'Recibo de leitura', icone: 'i-lucide-mail-check', cor: 'neutral' }
}
const tipoEvento = (t: string) => TIPO_EVENTO[t] ?? { titulo: t.replace(/_/g, ' '), icone: 'i-lucide-dot', cor: 'neutral' as Cor }
/** classes fixas por cor: o Tailwind precisa ver o nome inteiro no código */
const BOLINHA: Record<Cor, string> = {
  success: 'bg-success/10 text-success ring-success/30',
  primary: 'bg-primary/10 text-primary ring-primary/30',
  warning: 'bg-warning/10 text-warning ring-warning/30',
  error: 'bg-error/10 text-error ring-error/30',
  info: 'bg-info/10 text-info ring-info/30',
  neutral: 'bg-elevated text-muted ring-default'
}

/** Mais recente primeiro, agrupado por dia (São Paulo). */
const historico = computed(() => {
  const grupos: { dia: string; eventos: DetalheAssinatura['eventos'] }[] = []
  for (const e of [...(d.value?.eventos ?? [])].reverse()) {
    const dia = formatarData(e.criadoEm)
    const g = grupos[grupos.length - 1]
    if (g?.dia === dia) g.eventos.push(e)
    else grupos.push({ dia, eventos: [e] })
  }
  const hoje = formatarData(new Date())
  const ontem = formatarData(new Date(Date.now() - 86_400_000))
  return grupos.map(g => ({ ...g, rotulo: g.dia === hoje ? 'Hoje' : g.dia === ontem ? 'Ontem' : g.dia }))
})
const aberto = ref<number | null>(null)
/** SHA-256 inteiro no meio da frase só atrapalha a leitura: o texto mostra o começo e o fim */
const semHashLongo = (t: string) => t.replace(/\b([0-9a-f]{8})[0-9a-f]{50}([0-9a-f]{6})\b/g, '$1…$2')
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
              <dd>{{ [d.clienteNome, d.clienteDocumento && formatarDocumento(d.clienteDocumento)].filter(Boolean).join(' · ') }}</dd>
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
        <div class="space-y-5">
          <section v-for="g in historico" :key="g.dia">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{{ g.rotulo }}</p>
            <ol class="relative">
              <li v-for="(e, i) in g.eventos" :key="e.id" class="relative flex gap-3 pb-4 last:pb-0">
                <!-- fio que liga um evento ao próximo -->
                <span v-if="i < g.eventos.length - 1" class="absolute left-[15px] top-8 bottom-0 border-l border-default" aria-hidden="true" />
                <span class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1" :class="BOLINHA[tipoEvento(e.tipo).cor]">
                  <UIcon :name="tipoEvento(e.tipo).icone" class="size-4" />
                </span>
                <div class="min-w-0 flex-1 pt-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <p class="text-sm font-medium">{{ tipoEvento(e.tipo).titulo }}</p>
                    <time class="shrink-0 text-xs tabular-nums text-muted">{{ formatarHora(e.criadoEm).slice(0, 5) }}</time>
                  </div>
                  <p class="mt-0.5 break-words text-sm text-muted">{{ semHashLongo(e.descricao) }}</p>
                  <button
                    class="mt-1 inline-flex items-center gap-1 text-[11px] text-muted hover:text-default"
                    @click="aberto = aberto === e.id ? null : e.id"
                  >
                    <UIcon :name="aberto === e.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3" />
                    {{ aberto === e.id ? 'ocultar detalhes' : 'detalhes' }}
                  </button>
                  <dl v-if="aberto === e.id" class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-elevated/60 p-2 text-[11px]">
                    <dt class="text-muted">Quando</dt><dd class="tabular-nums">{{ formatarDataHora(e.criadoEm) }} (Brasília)</dd>
                    <template v-if="e.porNome"><dt class="text-muted">Por</dt><dd>{{ e.porNome }}</dd></template>
                    <template v-if="e.ip"><dt class="text-muted">IP</dt><dd class="font-mono">{{ e.ip }}</dd></template>
                    <dt class="text-muted">Hash</dt>
                    <dd class="flex min-w-0 items-center gap-1">
                      <span class="truncate font-mono" :title="e.hash">{{ e.hash }}</span>
                      <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Copiar hash" @click="copiar(e.hash)" />
                    </dd>
                  </dl>
                </div>
              </li>
            </ol>
          </section>
        </div>
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
