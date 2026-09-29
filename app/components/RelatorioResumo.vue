<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Relatório resumido de um período: o funil de cada lote (enviados → leituras
 * → acessos → confirmações → downloads), as mesmas contas por quem criou, por
 * setor e por canal, quem nunca confirma e as devoluções por domínio.
 * A exportação XLSX sai da mesma consulta, com uma aba para cada visão.
 */
type Linha = {
  grupo: string
  lotes: number
  enviados: number
  aberturas: number
  acessos: number
  confirmados: number
  downloads: number
  respostas: number
  devolucoes: number
  loteId?: number
  disparadoEm?: string | null
}
type Resumo = {
  porLote: Linha[]
  porUsuario: Linha[]
  porSetor: Linha[]
  porCanal: Linha[]
  nuncaConfirmam: { email: string; nome: string | null; empresa: string | null; envios: number; ultimoEnvio: string }[]
  devolucoesPorDominio: { dominio: string; devolucoes: number; enderecos: number }[]
}

const periodo = reactive({ de: dataSP(new Date(Date.now() - 29 * 86_400_000)), ate: dataSP() })
const { data, status } = await useFetch<Resumo>(api('/api/admin/relatorio/resumo'), {
  query: computed(() => ({ de: periodo.de, ate: periodo.ate })),
  lazy: true
})

const visao = ref<'lote' | 'usuario' | 'setor' | 'canal'>('lote')
const VISOES = [
  { valor: 'lote', rotulo: 'Por lote' },
  { valor: 'usuario', rotulo: 'Por quem criou' },
  { valor: 'setor', rotulo: 'Por setor' },
  { valor: 'canal', rotulo: 'Por canal' }
] as const
const linhas = computed<Linha[]>(() => {
  const r = data.value
  if (!r) return []
  return visao.value === 'lote' ? r.porLote : visao.value === 'usuario' ? r.porUsuario : visao.value === 'setor' ? r.porSetor : r.porCanal
})

const pct = (parte: number, total: number) => (total ? Math.round((parte / total) * 100) : 0)

function exportar() {
  window.location.href = api(`/api/admin/relatorio/resumo-export?de=${periodo.de}&ate=${periodo.ate}`)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <SeletorPeriodo v-model:de="periodo.de" v-model:ate="periodo.ate" />
      <UButton icon="i-lucide-sheet" label="Exportar XLSX" color="neutral" variant="outline" @click="exportar" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">Funil</h2>
          <UFieldGroup size="sm">
            <UButton
              v-for="v in VISOES"
              :key="v.valor"
              :label="v.rotulo"
              :color="visao === v.valor ? 'primary' : 'neutral'"
              :variant="visao === v.valor ? 'soft' : 'outline'"
              @click="visao = v.valor"
            />
          </UFieldGroup>
        </div>
      </template>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2">{{ VISOES.find(v => v.valor === visao)?.rotulo.replace('Por ', '') }}</th>
              <th v-if="visao !== 'lote'" class="px-3 py-2 text-right">Lotes</th>
              <th class="px-3 py-2 text-right">Enviados</th>
              <th class="px-3 py-2 text-right">Prováveis leituras</th>
              <th class="px-3 py-2 text-right">Acessos</th>
              <th class="px-3 py-2">Confirmações</th>
              <th class="px-3 py-2 text-right">Downloads</th>
              <th class="px-3 py-2 text-right">Respostas</th>
              <th class="px-3 py-2 text-right">Devoluções</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in linhas" :key="l.grupo + (l.loteId ?? '')" class="border-t border-default">
              <td class="max-w-[260px] px-3 py-2">
                <NuxtLink v-if="l.loteId" :to="`/admin/lotes/${l.loteId}`" class="block truncate hover:text-primary">{{ l.grupo }}</NuxtLink>
                <span v-else class="block truncate">{{ l.grupo }}</span>
                <span v-if="l.disparadoEm" class="text-xs text-muted">{{ dataHora(l.disparadoEm) }}</span>
              </td>
              <td v-if="visao !== 'lote'" class="px-3 py-2 text-right tabular-nums">{{ l.lotes }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ l.enviados }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ l.aberturas }} <span class="text-xs text-muted">{{ pct(l.aberturas, l.enviados) }}%</span></td>
              <td class="px-3 py-2 text-right tabular-nums">{{ l.acessos }} <span class="text-xs text-muted">{{ pct(l.acessos, l.enviados) }}%</span></td>
              <td class="px-3 py-2">
                <!-- barra de proporção: uma cor só, o número ao lado diz o valor -->
                <div class="flex items-center gap-2">
                  <div class="h-1.5 w-20 overflow-hidden rounded-full bg-elevated">
                    <div class="h-full rounded-full bg-primary" :style="{ width: `${pct(l.confirmados, l.enviados)}%` }" />
                  </div>
                  <span class="tabular-nums">{{ l.confirmados }}</span>
                  <span class="text-xs text-muted">{{ pct(l.confirmados, l.enviados) }}%</span>
                </div>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ l.downloads }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ l.respostas }}</td>
              <td class="px-3 py-2 text-right tabular-nums" :class="{ 'text-error': l.devolucoes > 0 }">{{ l.devolucoes }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!linhas.length" class="py-10 text-center text-sm text-muted">
          {{ status === 'pending' ? 'Carregando…' : 'Nenhum envio no período.' }}
        </p>
      </div>
    </UCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <UCard>
        <template #header>
          <div>
            <h2 class="font-semibold">Quem nunca confirma</h2>
            <p class="text-xs text-muted">Receberam 2 ou mais envios que pediam confirmação e não confirmaram nenhum.</p>
          </div>
        </template>
        <ul class="divide-y divide-default text-sm">
          <li v-for="c in data?.nuncaConfirmam" :key="c.email" class="flex items-center gap-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate">{{ c.nome || c.email }}</p>
              <p class="truncate text-xs text-muted">{{ c.email }}<template v-if="c.empresa"> · {{ c.empresa }}</template></p>
            </div>
            <span class="text-xs text-muted">{{ c.envios }} envios · último {{ dataHora(c.ultimoEnvio) }}</span>
          </li>
          <li v-if="!data?.nuncaConfirmam.length" class="py-6 text-center text-muted">Ninguém nesse caso no período.</li>
        </ul>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h2 class="font-semibold">Devoluções por domínio</h2>
            <p class="text-xs text-muted">Endereços que não existem, agrupados pelo domínio.</p>
          </div>
        </template>
        <ul class="divide-y divide-default text-sm">
          <li v-for="d in data?.devolucoesPorDominio" :key="d.dominio" class="flex items-center justify-between gap-3 py-2">
            <span class="truncate font-mono text-xs">{{ d.dominio }}</span>
            <span class="text-xs text-muted">{{ d.devolucoes }} devolução(ões) · {{ d.enderecos }} endereço(s)</span>
          </li>
          <li v-if="!data?.devolucoesPorDominio.length" class="py-6 text-center text-muted">Nenhuma devolução no período.</li>
        </ul>
      </UCard>
    </div>
  </div>
</template>
