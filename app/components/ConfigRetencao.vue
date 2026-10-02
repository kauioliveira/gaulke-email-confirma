<script setup lang="ts">
/**
 * Retenção LGPD (D10): por quanto tempo cada registro fica guardado. A rotina
 * roda sozinha uma vez por dia; aqui o admin ajusta os prazos, vê a prévia do
 * que sairia e pode rodar na hora.
 */
const toast = useToast()
const { data, refresh } = await useFetch<RespostaRetencao>(api('/api/admin/retencao'))

const form = reactive<ConfigRetencao>({ ativa: true, comunicadosMeses: 24, solicitacoesMeses: 24, assinadosAnos: 10, lixeiraDias: 90 })
watchEffect(() => { if (data.value) Object.assign(form, data.value.config) })
const mudou = computed(() => !!data.value && (Object.keys(form) as (keyof ConfigRetencao)[]).some(k => form[k] !== data.value!.config[k]))

const previa = ref<ResumoRetencao | null>(null)
const simulando = ref(false)
async function simular() {
  simulando.value = true
  try {
    previa.value = await $fetch<ResumoRetencao>(api('/api/admin/retencao/previa'), {
      method: 'POST',
      body: { comunicadosMeses: form.comunicadosMeses, solicitacoesMeses: form.solicitacoesMeses, assinadosAnos: form.assinadosAnos, lixeiraDias: form.lixeiraDias }
    })
  } catch (e: any) {
    toast.add({ title: 'Não foi possível simular', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    simulando.value = false
  }
}

const salvando = ref(false)
async function salvar() {
  salvando.value = true
  try {
    await $fetch(api('/api/admin/config'), { method: 'PUT', body: { chave: 'retencao', valor: { ...form } } })
    toast.add({ title: form.ativa ? 'Prazos de retenção salvos' : 'Retenção desligada', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

const confirmando = ref(false)
const executando = ref(false)
async function executar() {
  executando.value = true
  try {
    const r = await $fetch<ResumoRetencao>(api('/api/admin/retencao/executar'), { method: 'POST' })
    toast.add({
      title: 'Retenção executada',
      description: r.erros.length ? `${r.erros.length} erro(s) — veja o resumo.` : descrever(r),
      color: r.erros.length ? 'warning' : 'success'
    })
    confirmando.value = false
    previa.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível executar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    executando.value = false
  }
}

function linhas(r: ResumoRetencao) {
  return [
    { rotulo: 'Comunicados (lotes)', n: r.lotes, extra: r.destinatarios ? `${r.destinatarios} destinatário(s)` : '' },
    { rotulo: 'Lotes da lixeira', n: r.lixeira, extra: '' },
    { rotulo: 'Solicitações de documentos', n: r.solicitacoes, extra: 'com a pasta de arquivos' },
    { rotulo: 'Documentos para assinar', n: r.assinaturas, extra: 'com o PDF original e o assinado' },
    { rotulo: 'Arquivos soltos', n: r.arquivos, extra: 'anexos sem uso e temporários' },
    { rotulo: 'Mensagens da caixa', n: r.caixa, extra: '' },
    { rotulo: 'Auditoria: IP e navegador anonimizados', n: r.auditoriaAnonimizada, extra: 'o registro fica' },
    { rotulo: 'Entregas de webhook antigas', n: r.webhookEntregas, extra: '' }
  ]
}
function descrever(r: ResumoRetencao) {
  const n = linhas(r).filter(l => l.n)
  return n.length ? n.map(l => `${l.n} ${l.rotulo.toLowerCase()}`).join(', ') : 'Nada venceu.'
}
const ROTULO_TIPO: Record<string, string> = { lote: 'Lote', lixeira: 'Lixeira', solicitacao: 'Solicitação', assinatura: 'Assinatura' }
const LINK_TIPO: Record<string, string> = { lote: '/admin/lotes/', lixeira: '/admin/lotes/', solicitacao: '/admin/solicitacoes/', assinatura: '/admin/assinaturas/' }
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-archive-x" class="size-5 text-primary" />
          <div>
            <h2 class="font-semibold">Retenção de dados (LGPD)</h2>
            <p class="text-sm text-muted">Depois do prazo, o registro e os arquivos são apagados de vez. Roda sozinha uma vez por dia, a partir das 2h.</p>
          </div>
        </div>
        <USwitch v-model="form.ativa" :label="form.ativa ? 'Ligada' : 'Desligada'" />
      </div>
    </template>

    <div class="space-y-5">
      <UAlert
        v-if="!form.ativa"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Com a retenção desligada, nada é apagado"
        description="O rodapé dos e-mails promete aos clientes que os registros ficam guardados por 24 meses. Desligue só temporariamente."
      />

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" :class="!form.ativa && 'opacity-60'">
        <UFormField label="Comunicados" help="Lotes, destinatários, eventos. Também assinaturas não concluídas.">
          <UInput v-model.number="form.comunicadosMeses" type="number" min="0" class="w-full" :disabled="!form.ativa">
            <template #trailing><span class="text-xs text-muted">meses</span></template>
          </UInput>
        </UFormField>
        <UFormField label="Solicitações" help="Pedidos de documentos e os arquivos enviados pelo cliente.">
          <UInput v-model.number="form.solicitacoesMeses" type="number" min="0" class="w-full" :disabled="!form.ativa">
            <template #trailing><span class="text-xs text-muted">meses</span></template>
          </UInput>
        </UFormField>
        <UFormField label="Assinados por todos" help="Contam da conclusão. Prova de contrato: prazo longo.">
          <UInput v-model.number="form.assinadosAnos" type="number" min="0" class="w-full" :disabled="!form.ativa">
            <template #trailing><span class="text-xs text-muted">anos</span></template>
          </UInput>
        </UFormField>
        <UFormField label="Lixeira" help="Lote excluído é apagado de vez depois disto.">
          <UInput v-model.number="form.lixeiraDias" type="number" min="0" class="w-full" :disabled="!form.ativa">
            <template #trailing><span class="text-xs text-muted">dias</span></template>
          </UInput>
        </UFormField>
      </div>

      <p class="text-xs text-muted">
        A auditoria (quem fez o quê) fica; depois do prazo dos comunicados só o IP e o navegador de quem agiu são apagados.
        Endereços que devolveram continuam na lista de supressão, para não receberem de novo.
      </p>

      <div class="flex flex-wrap gap-2">
        <UButton label="Salvar" icon="i-lucide-save" :loading="salvando" :disabled="!mudou" @click="salvar" />
        <UButton label="Ver o que sairia hoje" icon="i-lucide-eye" color="neutral" variant="outline" :loading="simulando" @click="simular" />
        <UButton
          v-if="data?.config.ativa"
          label="Rodar agora"
          icon="i-lucide-play"
          color="error"
          variant="ghost"
          :disabled="mudou"
          @click="confirmando = true"
        />
      </div>

      <div v-if="previa" class="rounded-lg border border-default bg-elevated/40 p-4">
        <p class="mb-2 text-sm font-medium">Prévia com estes prazos — nada foi apagado</p>
        <ul class="grid gap-1 text-sm sm:grid-cols-2">
          <li v-for="l in linhas(previa)" :key="l.rotulo" class="flex gap-2">
            <span class="w-10 text-right font-semibold tabular-nums" :class="l.n ? 'text-error' : 'text-muted'">{{ l.n }}</span>
            <span>{{ l.rotulo }}<span v-if="l.extra && l.n" class="text-muted"> · {{ l.extra }}</span></span>
          </li>
        </ul>
        <div v-if="previa.exemplos.length" class="mt-3 border-t border-default pt-3">
          <p class="mb-1 text-xs text-muted">Alguns dos itens:</p>
          <ul class="space-y-0.5 text-xs">
            <li v-for="e in previa.exemplos.slice(0, 12)" :key="`${e.tipo}-${e.id}`">
              <UBadge :label="ROTULO_TIPO[e.tipo]" size="sm" color="neutral" variant="subtle" />
              <NuxtLink :to="`${LINK_TIPO[e.tipo]}${e.id}`" class="ml-1 hover:text-primary">{{ e.nome }}</NuxtLink>
              <span class="text-muted"> · {{ formatarData(e.quando) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="data?.ultima" class="text-xs text-muted">
        Última execução {{ data.ultima.automatica ? 'automática' : `manual por ${data.ultima.porNome}` }} em
        {{ formatarDataHora(data.ultima.em) }}: {{ descrever(data.ultima) }}
        <p v-for="(e, i) in data.ultima.erros" :key="i" class="text-error">{{ e }}</p>
      </div>
      <p v-else class="text-xs text-muted">A rotina ainda não rodou.</p>
    </div>

    <UModal v-model:open="confirmando" title="Rodar a retenção agora?">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            Tudo que passou do prazo é <strong>apagado de vez</strong>: registros, eventos e arquivos. Não há como desfazer.
            Use “Ver o que sairia hoje” antes, se ainda não viu.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" @click="confirmando = false" />
            <UButton label="Apagar o que venceu" color="error" icon="i-lucide-trash-2" :loading="executando" @click="executar" />
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
