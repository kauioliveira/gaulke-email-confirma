<script setup lang="ts">
import { dataHora, CORES_STATUS, ROTULOS_EVENTO, ICONES_EVENTO } from '~/utils/formato'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const toast = useToast()
const { data } = await useFetch<RespostaFichaDestinatario>(api(`/api/admin/destinatarios/${route.params.id}`))

useHead({ title: () => `${data.value?.destinatario.email || 'Destinatário'} — Gaulke Envios` })

const d = computed(() => data.value?.destinatario)
const mostrarHtml = ref(false)

function copiar(texto: string) {
  navigator.clipboard.writeText(texto)
  toast.add({ title: 'Copiado', icon: 'i-lucide-copy-check', color: 'success' })
}

const MARCOS = computed(() => [
  { r: 'E-mail enviado', v: d.value?.sentAt, i: 'i-lucide-send' },
  { r: 'Provável leitura', v: d.value?.firstHumanOpenAt, i: 'i-lucide-eye' },
  { r: 'Acessou a página', v: d.value?.firstAccessAt, i: 'i-lucide-mouse-pointer-click' },
  { r: 'Confirmou a leitura', v: d.value?.confirmedAt, i: 'i-lucide-badge-check' },
  { r: 'Baixou o arquivo', v: d.value?.firstDownloadAt, i: 'i-lucide-download' }
])
</script>

<template>
  <div v-if="data && d" class="space-y-6">
    <div class="flex items-center gap-2">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="xs" @click="$router.back()" />
      <h1 class="text-2xl font-semibold">{{ d.nome || d.email }}</h1>
      <UBadge :color="(CORES_STATUS[d.status] as any) || 'neutral'" variant="subtle" :label="d.status" />
    </div>

    <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-6">
        <!-- Marcos -->
        <UCard>
          <template #header><h2 class="font-semibold">Marcos</h2></template>
          <div class="grid gap-3 sm:grid-cols-5">
            <div v-for="m in MARCOS" :key="m.r" class="rounded-lg border p-3" :class="m.v ? 'border-primary/40 bg-primary/5' : 'border-default'">
              <UIcon :name="m.i" class="size-5" :class="m.v ? 'text-primary' : 'text-muted/40'" />
              <p class="mt-2 text-xs text-muted">{{ m.r }}</p>
              <p class="text-xs font-medium">{{ dataHora(m.v) }}</p>
            </div>
          </div>
          <UAlert
            v-if="d.ultimoErro"
            class="mt-4"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Último erro de envio"
            :description="d.ultimoErro"
          />
        </UCard>

        <!-- Timeline completa: a evidência de auditoria -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Histórico completo</h2>
              <UBadge variant="subtle" color="neutral" :label="`${data.timeline.length} evento(s)`" />
            </div>
          </template>

          <div class="space-y-3">
            <div v-for="ev in data.timeline" :key="ev.id" class="flex gap-3 rounded-lg border border-default p-3">
              <UIcon :name="ICONES_EVENTO[ev.tipo] || 'i-lucide-circle'" class="mt-0.5 size-5 shrink-0" :class="ev.tipo === 'erro' ? 'text-error' : 'text-primary'" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-medium">{{ ROTULOS_EVENTO[ev.tipo] || ev.tipo }}</p>
                  <span class="text-xs text-muted">{{ dataHora(ev.createdAt) }}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <!-- para abertura, a classificacao vale mais que o horario -->
                  <UBadge
                    v-if="ev.tipo === 'abertura' && (ev.meta as any)?.classe"
                    size="xs"
                    variant="subtle"
                    :color="(ev.meta as any).classe === 'provavel-pessoa' ? 'info' : 'neutral'"
                    :label="(ev.meta as any).classe === 'provavel-pessoa' ? 'provável pessoa' : `automático — ${(ev.meta as any).motivo}`"
                  />
                  <span v-if="ev.ip">IP: <span class="font-mono">{{ ev.ip }}</span></span>
                  <span v-if="ev.referer" class="truncate">Origem: {{ ev.referer }}</span>
                </div>
                <p v-if="ev.userAgent" class="mt-1 truncate text-xs text-muted/70">{{ ev.userAgent }}</p>
                <pre v-if="ev.meta" class="mt-1 overflow-x-auto rounded bg-elevated/50 p-2 text-xs">{{ ev.meta }}</pre>
              </div>
            </div>
            <p v-if="!data.timeline.length" class="py-8 text-center text-muted">Nenhum evento registrado ainda.</p>
          </div>
        </UCard>
      </div>

      <!-- Lateral -->
      <div class="space-y-6">
        <UCard>
          <template #header><h2 class="font-semibold">Dados</h2></template>
          <dl class="space-y-3 text-sm">
            <div><dt class="text-xs text-muted">E-mail</dt><dd class="break-all">{{ d.email }}</dd></div>
            <div v-if="d.empresa"><dt class="text-xs text-muted">Empresa</dt><dd>{{ d.empresa }}</dd></div>
            <div>
              <dt class="text-xs text-muted">Código</dt>
              <dd class="flex items-center gap-2">
                <span class="font-mono font-semibold">{{ d.codigo }}</span>
                <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copiar(d.codigo)" />
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Lote</dt>
              <dd><NuxtLink :to="`/admin/lotes/${data.loteId}`" class="text-primary hover:underline">{{ data.loteNome }}</NuxtLink></dd>
            </div>
            <div>
              <dt class="flex items-center gap-1 text-xs text-muted">
                Aberturas do e-mail
                <UTooltip text="Quantas vezes as imagens do e-mail foram carregadas. É medido por um pixel invisível na mensagem — não é o mesmo que abrir a página do documento.">
                  <UIcon name="i-lucide-circle-help" class="size-3.5" />
                </UTooltip>
              </dt>
              <dd>
                <template v-if="d.openCount">
                  {{ d.openCount }}x
                  <span v-if="d.lastOpenAt" class="text-xs text-muted">· última {{ dataHora(d.lastOpenAt) }}</span>
                  <span v-if="!d.firstHumanOpenAt" class="block text-xs italic text-muted">
                    todas parecem carregamento automático
                  </span>
                </template>
                <!--
                  "0x" nao dizia nada a quem olhava. Zero aqui e comum e tem
                  varias causas legitimas, entao a tela explica em vez de so
                  mostrar o numero.
                -->
                <template v-else>
                  <span class="text-muted">nenhuma detectada</span>
                  <span class="block text-xs text-muted">
                    Normal quando o cliente de e-mail bloqueia imagens, ou quando
                    <code>URL_ACESSO</code> não é acessível pela internet.
                  </span>
                </template>
              </dd>
            </div>
            <div><dt class="text-xs text-muted">Downloads</dt><dd>{{ d.downloadCount }}x</dd></div>
            <div><dt class="text-xs text-muted">Tentativas de envio</dt><dd>{{ d.tentativas }}</dd></div>
            <div v-if="d.messageId"><dt class="text-xs text-muted">Message-ID (SMTP)</dt><dd class="break-all font-mono text-xs">{{ d.messageId }}</dd></div>
            <div>
              <dt class="text-xs text-muted">Link individual de acesso</dt>
              <dd class="flex items-start gap-2">
                <span class="break-all font-mono text-xs">{{ data.link }}</span>
                <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copiar(data.link)" />
              </dd>
            </div>
            <div v-if="data.arquivoNome"><dt class="text-xs text-muted">Documento</dt><dd>{{ data.arquivoNome }}</dd></div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">E-mail enviado</h2>
              <UButton
                :label="mostrarHtml ? 'Ocultar' : 'Ver'"
                :icon="mostrarHtml ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="mostrarHtml = !mostrarHtml"
              />
            </div>
          </template>
          <p class="mb-3 text-sm"><span class="text-muted">Assunto:</span> {{ data.assunto }}</p>
          <!-- snapshot: mostra o que foi realmente enviado, mesmo que o template tenha mudado -->
          <iframe
            v-if="mostrarHtml"
            :srcdoc="data.html"
            sandbox=""
            class="h-96 w-full rounded border border-default bg-white"
            title="E-mail enviado"
          />
        </UCard>
      </div>
    </div>
  </div>
</template>
