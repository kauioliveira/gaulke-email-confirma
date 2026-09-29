<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Trilha de auditoria: quem fez o quê, quando e de onde.
 *
 * Supervisor e admin. Cada linha é gravada pelo servidor depois que a ação dá
 * certo (server/utils/auditoria.ts) e nunca é editada.
 */
definePageMeta({ layout: 'admin', middleware: 'admin', papel: 'supervisor' })
useHead({ title: 'Auditoria — Gaulke Comunica' })

const route = useRoute()

/** O Reka UI reserva '' para "sem seleção": a sentinela vira "sem filtro". */
const TODAS = 'todas'

const filtros = reactive({
  busca: '',
  acao: TODAS,
  // permite abrir "o histórico deste lote" a partir de outras telas
  entidade: String(route.query.entidade || ''),
  entidadeId: String(route.query.entidadeId || ''),
  de: '',
  ate: '',
  pagina: 1,
  porPagina: 50
})

// a busca só vai ao servidor quando a pessoa para de digitar
const buscaAplicada = ref('')
let espera: ReturnType<typeof setTimeout> | undefined
watch(
  () => filtros.busca,
  v => {
    clearTimeout(espera)
    espera = setTimeout(() => { buscaAplicada.value = v.trim() }, 350)
  }
)

const consulta = computed(() => ({
  busca: buscaAplicada.value || undefined,
  acao: filtros.acao === TODAS ? undefined : filtros.acao,
  entidade: filtros.entidade || undefined,
  entidadeId: filtros.entidadeId || undefined,
  de: filtros.de || undefined,
  ate: filtros.ate || undefined,
  pagina: filtros.pagina,
  porPagina: filtros.porPagina
}))

const { data, status: carregando } = await useFetch<RespostaAuditoria>(api('/api/admin/auditoria'), {
  query: consulta,
  watch: [consulta]
})

watch(
  () => [buscaAplicada.value, filtros.acao, filtros.entidade, filtros.entidadeId, filtros.de, filtros.ate],
  () => { filtros.pagina = 1 }
)

/** Rótulos amigáveis; ação nova sem rótulo aparece com o código, e não some. */
const ROTULOS_ACAO: Record<string, string> = {
  'lote.criar': 'Lote criado',
  'lote.disparar': 'Lote disparado',
  'lote.pausar': 'Lote pausado',
  'lote.agendar': 'Lote agendado',
  'lote.cancelar_agendamento': 'Agendamento cancelado',
  'lote.intervalo': 'Intervalo alterado',
  'lote.reenviar_falhas': 'Falhas reenviadas',
  'lote.excluir': 'Lote excluído',
  'lote.lixeira': 'Lote na lixeira',
  'lote.restaurar': 'Lote restaurado',
  'lote.arquivar': 'Lote arquivado',
  'lote.desarquivar': 'Lote desarquivado',
  'lote.reenviar': 'Reenvio em massa',
  'destinatario.reenviar': 'Reenvio individual',
  'template.criar': 'Template criado',
  'template.editar': 'Template editado',
  'template.excluir': 'Template excluído',
  'template.arquivar': 'Template arquivado',
  'template.desarquivar': 'Template desarquivado',
  'template.duplicar': 'Template duplicado',
  'template.restaurar_versao': 'Versão de template restaurada',
  'conta.criar': 'Canal cadastrado',
  'conta.editar': 'Canal editado',
  'conta.excluir': 'Canal excluído',
  'conta.ativar': 'Canal ativado',
  'conta.desativar': 'Canal desativado',
  'conta.testar': 'Canal testado',
  'conta.ler_caixa': 'Caixa lida (manual)',
  'supressao.remover': 'Saiu da supressão',
  'arquivo.enviar': 'Anexo enviado',
  'imagem.enviar': 'Imagem enviada',
  'email.teste': 'E-mail de teste',
  'relatorio.exportar': 'Relatório exportado',
  'relatorio.exportar_resumo': 'Resumo exportado',
  'dossie.destinatario': 'Dossiê do destinatário',
  'dossie.lote': 'Dossiê do lote',
  'arquivo.enviar_individuais': 'Arquivos individuais enviados',
  'config.alterar': 'Configuração alterada',
  'sessao.senha_local': 'Acesso de emergência',
  'sessao.senha_local_falhou': 'Senha local incorreta',
  'sessao.sair': 'Saída (senha local)'
}
const rotulo = (acao: string) => ROTULOS_ACAO[acao] ?? acao

/** Cor pela gravidade: exclusões e falhas de acesso chamam atenção. */
function corAcao(acao: string) {
  if (acao.endsWith('.excluir') || acao === 'lote.lixeira' || acao === 'sessao.senha_local_falhou') return 'error'
  if (acao.startsWith('sessao.') || acao.startsWith('config.') || acao.startsWith('conta.')) return 'warning'
  if (acao === 'lote.disparar' || acao === 'relatorio.exportar' || acao.endsWith('.reenviar')) return 'info'
  return 'neutral'
}

const opcoesAcao = computed(() => [
  { label: 'Todas as ações', value: TODAS },
  ...(data.value?.acoes ?? []).map(a => ({ label: rotulo(a), value: a }))
])

const totalPaginas = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / filtros.porPagina)))
const aberto = ref<number | null>(null)

function limpar() {
  Object.assign(filtros, { busca: '', acao: TODAS, entidade: '', entidadeId: '', de: '', ate: '', pagina: 1 })
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Auditoria</h1>
      <p class="text-sm text-muted">
        Tudo o que foi feito no sistema, por quem e de onde. Horários de Brasília.
      </p>
    </div>

    <UCard>
      <div class="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <UFormField label="Buscar" class="md:col-span-3 lg:col-span-2">
          <UInput v-model="filtros.busca" icon="i-lucide-search" placeholder="Pessoa ou texto da ação" class="w-full" />
        </UFormField>
        <UFormField label="Ação" class="lg:col-span-2">
          <USelect v-model="filtros.acao" :items="opcoesAcao" class="w-full" />
        </UFormField>
        <UFormField label="De">
          <UInput v-model="filtros.de" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Até">
          <UInput v-model="filtros.ate" type="date" class="w-full" />
        </UFormField>
      </div>
      <div v-if="filtros.entidade" class="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <UBadge color="primary" variant="subtle" icon="i-lucide-filter">
          Só {{ filtros.entidade }}{{ filtros.entidadeId ? ` #${filtros.entidadeId}` : '' }}
        </UBadge>
        <UButton label="Limpar filtros" size="xs" color="neutral" variant="ghost" @click="limpar" />
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-3 whitespace-nowrap">Quando</th>
              <th class="px-3 py-3">Quem</th>
              <th class="px-3 py-3">Ação</th>
              <th class="px-3 py-3">IP</th>
              <th class="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            <template v-for="r in data?.registros" :key="r.id">
              <tr class="border-t border-default align-top hover:bg-elevated/30">
                <td class="px-3 py-2 text-xs whitespace-nowrap">{{ dataHora(r.quando) }}</td>
                <td class="max-w-[200px] px-3 py-2">
                  <p class="truncate font-medium" :class="r.userId === null && 'text-warning'">
                    {{ r.userNome || 'Sistema / não identificado' }}
                  </p>
                  <p v-if="r.papel" class="text-xs text-muted">{{ ROTULO_PAPEL[r.papel] }}</p>
                </td>
                <td class="px-3 py-2">
                  <UBadge :color="corAcao(r.acao) as any" variant="subtle" size="xs" :label="rotulo(r.acao)" />
                  <p class="mt-1">{{ r.resumo }}</p>
                </td>
                <td class="px-3 py-2 font-mono text-xs text-muted">{{ r.ip || '—' }}</td>
                <td class="px-3 py-2">
                  <UButton
                    v-if="r.dados && Object.keys(r.dados).length"
                    :icon="aberto === r.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="aberto === r.id ? 'Ocultar detalhes' : 'Ver detalhes'"
                    @click="aberto = aberto === r.id ? null : r.id"
                  />
                </td>
              </tr>
              <tr v-if="aberto === r.id" class="bg-elevated/30">
                <td colspan="5" class="px-3 py-3">
                  <pre class="overflow-x-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(r.dados, null, 2) }}</pre>
                  <p v-if="r.userAgent" class="mt-2 text-xs text-muted">Navegador: {{ r.userAgent }}</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>

        <p v-if="!data?.registros.length" class="py-12 text-center text-muted">
          {{ carregando === 'pending' ? 'Carregando…' : 'Nenhum registro encontrado com esses filtros.' }}
        </p>
      </div>

      <div v-if="data?.total" class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-3 py-3 text-sm">
        <span class="text-muted">
          {{ (filtros.pagina - 1) * filtros.porPagina + 1 }}–{{ Math.min(filtros.pagina * filtros.porPagina, data.total) }}
          de {{ data.total }}
        </span>
        <div class="flex items-center gap-2">
          <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina <= 1" @click="filtros.pagina--" />
          <span class="text-xs text-muted">{{ filtros.pagina }} / {{ totalPaginas }}</span>
          <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="outline" :disabled="filtros.pagina >= totalPaginas" @click="filtros.pagina++" />
        </div>
      </div>
    </UCard>
  </div>
</template>
