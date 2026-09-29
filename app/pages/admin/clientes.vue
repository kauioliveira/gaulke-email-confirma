<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Linha do tempo do cliente: comunicados, solicitações, assinaturas e
 * respostas por e-mail de uma pessoa ou empresa, do mais recente ao mais antigo.
 */
definePageMeta({ layout: 'admin' })
useHead({ title: 'Clientes — Gaulke Comunica' })

const route = useRoute()
const router = useRouter()

/* ---------- busca ---------- */
const termo = ref(String(route.query.q || ''))
const termoAtrasado = ref(termo.value)
let atraso: ReturnType<typeof setTimeout> | undefined
watch(termo, v => {
  clearTimeout(atraso)
  atraso = setTimeout(() => (termoAtrasado.value = v.trim()), 300)
})
const { data: achados, status: statusBusca } = await useFetch<ClienteEncontrado[]>(api('/api/admin/clientes'), {
  query: computed(() => ({ q: termoAtrasado.value })),
  default: () => [],
  server: false,
  immediate: termoAtrasado.value.length >= 2
})

/* ---------- cliente escolhido ---------- */
const escolhido = computed(() => ({
  email: String(route.query.email || ''),
  documento: String(route.query.documento || '')
}))
const temEscolhido = computed(() => !!(escolhido.value.email || escolhido.value.documento))
const { data: linha, status: statusLinha } = await useFetch<LinhaDoTempoCliente>(api('/api/admin/clientes/linha'), {
  query: escolhido,
  server: false,
  immediate: temEscolhido.value,
  watch: [escolhido]
})

function abrir(c: { email?: string; documento?: string | null }) {
  router.push({ query: c.documento && !c.email ? { documento: c.documento } : { email: c.email } })
}
function abrirPorDocumento(doc: string) {
  router.push({ query: { documento: doc } })
}
function voltarABusca() {
  router.push({ query: termo.value ? { q: termo.value } : {} })
}

/* ---------- filtro por módulo ---------- */
const MODULOS: { valor: ModuloLinha; rotulo: string; icone: string }[] = [
  { valor: 'comunicado', rotulo: 'Comunicados', icone: 'i-lucide-mail' },
  { valor: 'solicitacao', rotulo: 'Solicitações', icone: 'i-lucide-folder-input' },
  { valor: 'assinatura', rotulo: 'Assinaturas', icone: 'i-lucide-signature' },
  { valor: 'caixa', rotulo: 'Respostas', icone: 'i-lucide-reply' }
]
const ICONE: Record<ModuloLinha, string> = Object.fromEntries(MODULOS.map(m => [m.valor, m.icone])) as never
const filtro = ref<ModuloLinha | null>(null)
watch(escolhido, () => (filtro.value = null))
const itens = computed(() => (linha.value?.itens ?? []).filter(i => !filtro.value || i.modulo === filtro.value))

/** Agrupa por mês (em São Paulo), para a linha do tempo ter marcos. */
const porMes = computed(() => {
  const grupos: { mes: string; itens: ItemLinhaCliente[] }[] = []
  for (const i of itens.value) {
    const p = partesSP(new Date(i.quando))
    const mes = new Date(`${p.ano}-${p.mes}-15T12:00:00${DESLOCAMENTO_SP}`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: FUSO })
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.mes === mes) ultimo.itens.push(i)
    else grupos.push({ mes, itens: [i] })
  }
  return grupos
})

const formatarDoc = (d: string) =>
  d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.length === 11
      ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      : d
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Clientes</h1>
      <p class="text-sm text-muted">
        Tudo que foi enviado, pedido e assinado com uma pessoa ou empresa, numa linha do tempo só.
      </p>
    </div>

    <!-- BUSCA -->
    <template v-if="!temEscolhido">
      <UInput
        v-model="termo"
        icon="i-lucide-search"
        size="lg"
        placeholder="Nome, e-mail, empresa ou CPF/CNPJ"
        class="w-full sm:max-w-xl"
        autofocus
      />
      <UCard v-if="termoAtrasado.length >= 2">
        <p v-if="statusBusca === 'pending'" class="py-6 text-center text-sm text-muted">Buscando…</p>
        <p v-else-if="!achados.length" class="py-6 text-center text-sm text-muted">Ninguém encontrado com “{{ termoAtrasado }}”.</p>
        <ul v-else class="divide-y divide-default">
          <li v-for="c in achados" :key="c.email">
            <button class="flex w-full flex-wrap items-center gap-3 px-1 py-3 text-left hover:bg-elevated/50" @click="abrir(c)">
              <UIcon name="i-lucide-user-round" class="size-5 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ c.nome || c.email }}</p>
                <p class="truncate text-xs text-muted">
                  {{ c.email }}<template v-if="c.empresa"> · {{ c.empresa }}</template><template v-if="c.documento"> · {{ formatarDoc(c.documento) }}</template>
                </p>
              </div>
              <div class="flex flex-wrap gap-1 text-xs">
                <UBadge v-if="c.comunicados" color="neutral" variant="subtle" icon="i-lucide-mail" :label="String(c.comunicados)" />
                <UBadge v-if="c.solicitacoes" color="neutral" variant="subtle" icon="i-lucide-folder-input" :label="String(c.solicitacoes)" />
                <UBadge v-if="c.assinaturas" color="neutral" variant="subtle" icon="i-lucide-signature" :label="String(c.assinaturas)" />
              </div>
              <span class="w-full text-xs text-muted sm:w-40 sm:text-right">{{ c.ultimoEm ? dataHora(c.ultimoEm) : 'só em lista' }}</span>
            </button>
          </li>
        </ul>
      </UCard>
    </template>

    <!-- LINHA DO TEMPO -->
    <template v-else>
      <UButton icon="i-lucide-arrow-left" label="Buscar outro cliente" color="neutral" variant="ghost" size="sm" @click="voltarABusca" />

      <p v-if="statusLinha === 'pending' && !linha" class="py-10 text-center text-sm text-muted">Carregando…</p>

      <template v-else-if="linha">
        <UCard>
          <div class="flex flex-wrap items-start gap-4">
            <UIcon name="i-lucide-user-round" class="size-10 shrink-0 text-primary" />
            <div class="min-w-0 flex-1 space-y-1">
              <p class="text-lg font-semibold">{{ linha.nome || linha.emails[0] || formatarDoc(linha.documentos[0] ?? '') }}</p>
              <p v-if="linha.empresa" class="text-sm text-muted">{{ linha.empresa }}</p>
              <div class="flex flex-wrap gap-1.5 pt-1">
                <UBadge v-for="e in linha.emails" :key="e" color="neutral" variant="outline" icon="i-lucide-at-sign" :label="e" />
                <UButton
                  v-for="d in linha.documentos"
                  :key="d"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-id-card"
                  :label="formatarDoc(d)"
                  title="Ver tudo deste CPF/CNPJ"
                  @click="abrirPorDocumento(d)"
                />
              </div>
            </div>
          </div>
        </UCard>

        <div class="flex flex-wrap gap-2">
          <UButton
            label="Tudo"
            :color="!filtro ? 'primary' : 'neutral'"
            :variant="!filtro ? 'soft' : 'ghost'"
            size="sm"
            @click="filtro = null"
          >
            <template #trailing><span class="text-xs opacity-70">{{ linha.itens.length }}</span></template>
          </UButton>
          <UButton
            v-for="m in MODULOS"
            :key="m.valor"
            :icon="m.icone"
            :label="m.rotulo"
            :color="filtro === m.valor ? 'primary' : 'neutral'"
            :variant="filtro === m.valor ? 'soft' : 'ghost'"
            :disabled="!linha.totais[m.valor]"
            size="sm"
            @click="filtro = m.valor"
          >
            <template #trailing><span class="text-xs opacity-70">{{ linha.totais[m.valor] }}</span></template>
          </UButton>
        </div>

        <UCard v-if="!itens.length">
          <p class="py-8 text-center text-sm text-muted">Nada registrado para este cliente.</p>
        </UCard>

        <div v-for="g in porMes" :key="g.mes" class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">{{ g.mes }}</p>
          <ol class="relative space-y-2 border-l border-default pl-5">
            <li v-for="i in g.itens" :key="`${i.modulo}-${i.id}-${i.email}`" class="relative">
              <span class="absolute -left-[1.72rem] top-3 flex size-5 items-center justify-center rounded-full border border-default bg-default">
                <UIcon :name="ICONE[i.modulo]" class="size-3 text-muted" />
              </span>
              <component
                :is="i.link ? resolveComponent('NuxtLink') : 'div'"
                :to="i.link ?? undefined"
                class="block rounded-lg border border-default bg-default p-3 transition"
                :class="i.link && 'hover:border-primary'"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <p class="min-w-0 flex-1 font-medium sm:truncate">{{ i.titulo }}</p>
                  <UBadge :color="i.cor" variant="subtle" :label="i.status" />
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  {{ dataHora(i.quando) }}
                  <template v-if="i.email && linha.emails.length > 1"> · {{ i.email }}</template>
                  <template v-if="i.por"> · por {{ i.por }}</template>
                </p>
                <ul v-if="i.detalhes.length" class="mt-1.5 space-y-0.5 text-sm text-muted">
                  <li v-for="(d, k) in i.detalhes" :key="k" class="line-clamp-2">{{ d }}</li>
                </ul>
              </component>
            </li>
          </ol>
        </div>
      </template>
    </template>
  </div>
</template>
