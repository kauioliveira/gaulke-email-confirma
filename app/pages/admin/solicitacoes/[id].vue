<script setup lang="ts">
import { iconeDoArquivo, TIPOS_SOLICITACAO, descreverFamilias } from '~~/shared/types/tipos-arquivo'

definePageMeta({ layout: 'admin' })

/**
 * Uma solicitação: o que o cliente já entregou, a análise item a item
 * (aprovar, recusar com motivo, aceitar "não possuo") e o histórico.
 */
const route = useRoute()
const toast = useToast()
const { sessao, pode } = usePapel()
const id = Number(route.params.id)

const { data: s, refresh, error } = await useFetch<DetalheSolicitacao>(api(`/api/admin/solicitacoes/${id}`))
useHead({ title: () => (s.value ? `${s.value.codigo} — ${s.value.titulo}` : 'Solicitação') })

// atualiza sozinho enquanto a aba está visível: o cliente pode estar enviando agora
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && !ocupado.value) refresh()
  }, 20_000)
})
onBeforeUnmount(() => clearInterval(timer))

const encerrada = computed(() => s.value?.status === 'concluida' || s.value?.status === 'cancelada')
const souQuemPediu = computed(() => !!sessao.value?.usuario?.id && s.value?.criadoPorUserId === sessao.value.usuario.id)
const podeCancelar = computed(() => souQuemPediu.value || pode('supervisor'))

const ocupado = ref<string | null>(null)
async function acao(chave: string, fn: () => Promise<unknown>, sucesso?: string) {
  ocupado.value = chave
  try {
    await fn()
    if (sucesso) toast.add({ title: sucesso, color: 'success' })
    await refresh()
    return true
  } catch (e: any) {
    toast.add({ title: 'Não foi possível concluir', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
    return false
  } finally {
    ocupado.value = null
  }
}

/* ---------- análise ---------- */
function analisar(item: ItemSolicitacao, acaoItem: 'aprovar' | 'aceitar' | 'desfazer') {
  return acao(`${acaoItem}-${item.id}`, () =>
    $fetch(api(`/api/admin/solicitacoes/${id}/itens/${item.id}/analisar`), { method: 'POST', body: { acao: acaoItem } })
  )
}

const recusando = ref<ItemSolicitacao | null>(null)
const motivoRecusa = ref('')
const descartar = ref(true)
const MOTIVOS_RAPIDOS = ['Está ilegível', 'Não é o documento pedido', 'Falta a frente ou o verso', 'Documento vencido', 'Está incompleto']
function abrirRecusa(item: ItemSolicitacao) {
  recusando.value = item
  motivoRecusa.value = ''
  descartar.value = item.status !== 'nao_possui'
}
async function confirmarRecusa() {
  const item = recusando.value
  if (!item) return
  const ok = await acao(`recusar-${item.id}`, () =>
    $fetch(api(`/api/admin/solicitacoes/${id}/itens/${item.id}/analisar`), {
      method: 'POST',
      body: { acao: 'recusar', motivo: motivoRecusa.value, descartarArquivos: descartar.value }
    })
  )
  if (ok) recusando.value = null
}

function avisarPendencias() {
  return acao('pendencias', () => $fetch(api(`/api/admin/solicitacoes/${id}/avisar-pendencias`), { method: 'POST' }), 'Cliente avisado das pendências')
}

/* ---------- reenviar, concluir, cancelar, reabrir ---------- */
const modalReenvio = ref(false)
const emailReenvio = ref('')
function abrirReenvio() {
  emailReenvio.value = s.value?.destinatarioEmail ?? ''
  modalReenvio.value = true
}
async function reenviar() {
  const ok = await acao('reenviar', () =>
    $fetch(api(`/api/admin/solicitacoes/${id}/reenviar`), { method: 'POST', body: { email: emailReenvio.value.trim() || null } }),
    'Pedido reenviado'
  )
  if (ok) modalReenvio.value = false
}

const modalConcluir = ref(false)
const obsConclusao = ref('')
const avisarNaConclusao = ref(true)
async function concluir() {
  const ok = await acao('concluir', () =>
    $fetch(api(`/api/admin/solicitacoes/${id}/concluir`), {
      method: 'POST',
      body: { observacao: obsConclusao.value || null, avisarCliente: avisarNaConclusao.value }
    }),
    'Solicitação concluída'
  )
  if (ok) modalConcluir.value = false
}

const modalCancelar = ref(false)
const motivoCancelar = ref('')
async function cancelar() {
  const ok = await acao('cancelar', () =>
    $fetch(api(`/api/admin/solicitacoes/${id}/cancelar`), { method: 'POST', body: { motivo: motivoCancelar.value } }),
    'Solicitação cancelada'
  )
  if (ok) modalCancelar.value = false
}

function reabrir() {
  return acao('reabrir', () => $fetch(api(`/api/admin/solicitacoes/${id}/reabrir`), { method: 'POST' }), 'Solicitação reaberta')
}

/* ---------- lembrete e item novo ---------- */
const faltaDoCliente = computed(() => s.value?.status === 'aberta' && s.value.itens.some(i => i.obrigatorio && (i.status === 'pendente' || i.status === 'recusado')))
function lembrar() {
  return acao('lembrete', () => $fetch(api(`/api/admin/solicitacoes/${id}/lembrete`), { method: 'POST' }), 'Lembrete enviado')
}

const incluindo = ref<ItemModeloChecklist[] | null>(null)
async function incluirItem() {
  const item = incluindo.value?.[0]
  if (!item) return
  const ok = await acao('incluir', () => $fetch(api(`/api/admin/solicitacoes/${id}/itens`), { method: 'POST', body: item }), 'Documento incluído')
  if (ok) incluindo.value = null
}

/* ---------- ajustes ---------- */
const prazoEdit = ref('')
watch(() => s.value?.prazo, p => (prazoEdit.value = p ?? ''), { immediate: true })
function ajustar(body: Record<string, unknown>) {
  return acao('ajuste', () => $fetch(api(`/api/admin/solicitacoes/${id}`), { method: 'PATCH', body }), 'Salvo')
}

async function copiarLink() {
  if (!s.value) return
  try {
    await navigator.clipboard.writeText(s.value.link)
    toast.add({ title: 'Link copiado', description: 'É o mesmo link do e-mail: pessoal, do cliente.', color: 'success' })
  } catch {
    toast.add({ title: 'Não foi possível copiar', description: s.value.link, color: 'warning' })
  }
}

/* ---------- apresentação ---------- */
const arquivoUrl = (a: ArquivoSolicitacao, inline = false) =>
  api(`/api/admin/solicitacoes/${id}/arquivos/${a.id}${inline ? '?inline=1' : ''}`)
const abreNoNavegador = (nome: string) => /\.(pdf|png|jpe?g|webp)$/i.test(nome)
const liberado = (a: ArquivoSolicitacao) => a.antivirus === 'limpo' || a.antivirus === 'sem_antivirus'

const AV: Record<StatusAntivirus, { rotulo: string; cor: 'success' | 'neutral' | 'warning' | 'error'; icone: string }> = {
  limpo: { rotulo: 'Verificado', cor: 'success', icone: 'i-lucide-shield-check' },
  sem_antivirus: { rotulo: 'Sem antivírus', cor: 'neutral', icone: 'i-lucide-shield-off' },
  pendente: { rotulo: 'Em verificação', cor: 'warning', icone: 'i-lucide-shield-ellipsis' },
  erro: { rotulo: 'Na quarentena', cor: 'warning', icone: 'i-lucide-shield-alert' },
  infectado: { rotulo: 'Bloqueado (vírus)', cor: 'error', icone: 'i-lucide-shield-x' }
}

// classes inteiras (e nao montadas) para o Tailwind as encontrar no codigo
const COR_ICONE_ITEM: Record<StatusItemSolicitacao, string> = {
  pendente: 'text-muted',
  enviado: 'text-info',
  aprovado: 'text-success',
  recusado: 'text-error',
  nao_possui: 'text-warning'
}

const pct = computed(() => (s.value?.obrigatorios ? Math.round((s.value.obrigatoriosEntregues / s.value.obrigatorios) * 100) : 0))
const documentoFormatado = computed(() => {
  const d = s.value?.documento || ''
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return d
})
const temArquivoLiberado = computed(() => s.value?.itens.some(i => i.arquivos.some(a => !a.removidoEm && liberado(a))) ?? false)

const ICONE_EVENTO_SOLIC: Record<string, string> = {
  resposta_email: 'i-lucide-reply',
  devolucao: 'i-lucide-mail-x',
  auto_resposta: 'i-lucide-bot',
  recibo: 'i-lucide-mail-check',
  criada: 'i-lucide-sparkles',
  email_pedido: 'i-lucide-send',
  email_lembrete: 'i-lucide-bell',
  email_pendencias: 'i-lucide-mail-warning',
  email_concluida: 'i-lucide-mail-check',
  email_erro: 'i-lucide-mail-x',
  email_corrigido: 'i-lucide-at-sign',
  acesso: 'i-lucide-eye',
  arquivo_recebido: 'i-lucide-file-up',
  arquivo_removido: 'i-lucide-file-minus',
  arquivo_infectado: 'i-lucide-shield-x',
  nao_possui: 'i-lucide-circle-slash',
  nao_possui_desfeito: 'i-lucide-undo-2',
  item_aprovar: 'i-lucide-circle-check',
  item_aceitar: 'i-lucide-circle-check',
  item_recusar: 'i-lucide-circle-x',
  item_desfazer: 'i-lucide-undo-2',
  aviso_equipe: 'i-lucide-bell-ring',
  aviso_equipe_erro: 'i-lucide-bell-off',
  aviso_equipe_sem_email: 'i-lucide-bell-off',
  concluida: 'i-lucide-badge-check',
  reaberta: 'i-lucide-rotate-ccw',
  cancelada: 'i-lucide-ban',
  ajuste: 'i-lucide-settings-2'
}
</script>

<template>
  <div v-if="error" class="py-20 text-center">
    <UIcon name="i-lucide-folder-x" class="size-10 text-muted" />
    <p class="mt-2 text-muted">Solicitação não encontrada.</p>
    <UButton to="/admin/solicitacoes" label="Voltar para a lista" variant="soft" class="mt-4" />
  </div>

  <div v-else-if="s" class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <NuxtLink to="/admin/solicitacoes" class="text-sm text-muted hover:text-primary">
          <UIcon name="i-lucide-arrow-left" class="mr-1 size-3.5 align-[-2px]" />Solicitações
        </NuxtLink>
        <h1 class="mt-1 text-2xl font-semibold">{{ s.titulo }}</h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span class="font-mono">{{ s.codigo }}</span>
          <UBadge :color="COR_STATUS_SOLIC[s.status]" variant="subtle">{{ ROTULO_STATUS_SOLIC[s.status] }}</UBadge>
          <UBadge v-if="solicitacaoAtrasada(s)" color="error" variant="subtle" icon="i-lucide-alarm-clock">Prazo vencido</UBadge>
          <span>· pedido por {{ s.criadoPorNome || '—' }} em {{ formatarDataHora(s.createdAt) }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          label="Baixar tudo (ZIP)"
          icon="i-lucide-folder-down"
          color="neutral"
          variant="outline"
          :disabled="!temArquivoLiberado"
          :to="api(`/api/admin/solicitacoes/${id}/zip`)"
          external
        />
        <UButton v-if="!encerrada" label="Concluir" icon="i-lucide-badge-check" color="success" variant="soft" @click="obsConclusao = ''; avisarNaConclusao = s.avisarConclusao; modalConcluir = true" />
        <UButton v-if="encerrada && (s.status === 'concluida' || podeCancelar)" label="Reabrir" icon="i-lucide-rotate-ccw" color="neutral" variant="outline" :loading="ocupado === 'reabrir'" @click="reabrir" />
      </div>
    </div>

    <!-- avisos -->
    <UAlert
      v-if="s.envioErro"
      color="error"
      variant="subtle"
      icon="i-lucide-mail-x"
      title="O último e-mail não saiu"
      :description="s.envioErro"
      :actions="[{ label: 'Reenviar pedido', icon: 'i-lucide-send', color: 'error', variant: 'solid', onClick: abrirReenvio }]"
    />
    <UAlert
      v-if="s.recusasNaoAvisadas && !encerrada"
      color="warning"
      variant="subtle"
      icon="i-lucide-mail-warning"
      :title="`${s.recusasNaoAvisadas} recusa(s) ainda não avisada(s) ao cliente`"
      description="Um e-mail só, com todos os itens recusados e os motivos. Mande quando terminar de analisar."
      :actions="[{ label: 'Avisar o cliente', icon: 'i-lucide-send', color: 'warning', variant: 'solid', loading: ocupado === 'pendencias', onClick: avisarPendencias }]"
    />
    <UAlert
      v-if="s.status === 'concluida'"
      color="success"
      variant="subtle"
      icon="i-lucide-badge-check"
      title="Concluída"
      :description="`Em ${formatarDataHora(s.concluidaEm)}${s.concluidaPorNome ? ` por ${s.concluidaPorNome}` : ''}. O link do cliente mostra o que foi entregue, sem aceitar novos envios.`"
    />
    <UAlert
      v-if="s.status === 'cancelada'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-ban"
      title="Cancelada"
      :description="`Em ${formatarDataHora(s.canceladaEm)} por ${s.canceladaPorNome || '—'}: ${s.canceladaMotivo}`"
    />

    <div class="grid gap-6 lg:grid-cols-3">
      <!-- itens -->
      <div class="space-y-4 lg:col-span-2">
        <UCard>
          <div class="flex flex-wrap items-center gap-4">
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ s.empresa || s.destinatarioNome || s.destinatarioEmail }}</p>
              <p class="truncate text-sm text-muted">
                {{ s.empresa ? `${s.destinatarioNome || ''} · ` : '' }}{{ s.destinatarioEmail }}<template v-if="documentoFormatado"> · {{ documentoFormatado }}</template>
              </p>
              <NuxtLink :to="`/admin/clientes?email=${encodeURIComponent(s.destinatarioEmail)}`" class="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <UIcon name="i-lucide-history" class="size-3.5" />Linha do tempo do cliente
              </NuxtLink>
            </div>
            <div class="w-48">
              <div class="flex justify-between text-xs text-muted">
                <span>Obrigatórios entregues</span>
                <span class="tabular-nums">{{ s.obrigatoriosEntregues }}/{{ s.obrigatorios }}</span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-elevated">
                <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${pct}%` }" />
              </div>
            </div>
          </div>
        </UCard>

        <UCard v-for="item in s.itens" :key="item.id" :ui="{ body: 'space-y-3' }">
          <div class="flex flex-wrap items-start gap-3">
            <UIcon :name="ICONE_STATUS_ITEM[item.status]" class="mt-0.5 size-5 shrink-0" :class="COR_ICONE_ITEM[item.status]" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">
                <span class="text-muted">{{ item.ordem }}.</span> {{ item.titulo }}
                <UBadge v-if="!item.obrigatorio" color="neutral" variant="outline" size="sm" class="ml-1">opcional</UBadge>
              </p>
              <p class="text-xs text-muted">
                {{ descreverFamilias(item.tipos) }} · até {{ item.maxArquivos }} arquivo(s)<template v-if="item.modeloNome"> · com modelo</template>
                <template v-if="item.instrucao"> · {{ item.instrucao }}</template>
              </p>
            </div>
            <UBadge :color="COR_STATUS_ITEM[item.status]" variant="subtle">
              {{ item.status === 'nao_possui' && item.analisadoEm ? 'Não possui (aceito)' : ROTULO_STATUS_ITEM[item.status] }}
            </UBadge>
          </div>

          <!-- "não possuo" e recusa -->
          <blockquote v-if="item.status === 'nao_possui'" class="rounded-md border-l-4 border-warning bg-warning/10 px-3 py-2 text-sm">
            <span class="text-xs font-medium uppercase text-muted">O cliente diz que não possui</span>
            <p>{{ item.motivo || 'Sem justificativa (item opcional).' }}</p>
          </blockquote>
          <div v-if="item.status === 'recusado'" class="rounded-md border-l-4 border-error bg-error/10 px-3 py-2 text-sm">
            <span class="text-xs font-medium uppercase text-muted">Recusado por {{ item.analisadoPorNome }} em {{ formatarDataHora(item.analisadoEm) }}</span>
            <p>{{ item.motivo }}</p>
            <p class="mt-1 text-xs" :class="item.recusaAvisadaEm ? 'text-muted' : 'font-medium text-warning'">
              {{ item.recusaAvisadaEm ? `Cliente avisado em ${formatarDataHora(item.recusaAvisadaEm)}` : 'Cliente ainda não avisado' }}
            </p>
          </div>

          <!-- arquivos -->
          <ul v-if="item.arquivos.length" class="divide-y divide-default rounded-md border border-default">
            <li
              v-for="a in item.arquivos"
              :key="a.id"
              class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              :class="{ 'opacity-50': a.removidoEm }"
            >
              <UIcon :name="iconeDoArquivo(a.nome, TIPOS_SOLICITACAO)" class="size-5 shrink-0 text-primary" />
              <div class="min-w-0 flex-1">
                <a
                  v-if="!a.removidoEm && liberado(a)"
                  :href="arquivoUrl(a, abreNoNavegador(a.nome))"
                  target="_blank"
                  rel="noopener"
                  class="block truncate font-medium hover:text-primary"
                >{{ a.nome }}</a>
                <p v-else class="truncate" :class="{ 'line-through': a.removidoEm }">{{ a.nome }}</p>
                <p class="text-xs text-muted">
                  {{ tamanho(a.tamanho) }} · {{ formatarDataHora(a.enviadoEm) }}
                  <template v-if="a.removidoEm"> · removido em {{ formatarDataHora(a.removidoEm) }}</template>
                </p>
              </div>
              <UTooltip :text="a.antivirusMsg || AV[a.antivirus].rotulo">
                <UBadge :color="AV[a.antivirus].cor" variant="subtle" :icon="AV[a.antivirus].icone" size="sm">{{ AV[a.antivirus].rotulo }}</UBadge>
              </UTooltip>
              <UButton
                v-if="!a.removidoEm && liberado(a)"
                icon="i-lucide-download"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Baixar"
                :to="arquivoUrl(a)"
                external
              />
            </li>
          </ul>
          <p v-else-if="item.status === 'pendente'" class="text-sm text-muted">Nada enviado ainda.</p>

          <!-- ações -->
          <div v-if="!encerrada" class="flex flex-wrap justify-end gap-2">
            <template v-if="item.status === 'enviado' || (item.status === 'recusado' && item.arquivos.some(a => !a.removidoEm && liberado(a)))">
              <UButton label="Recusar" icon="i-lucide-x" color="error" variant="outline" size="sm" @click="abrirRecusa(item)" />
              <UButton label="Aprovar" icon="i-lucide-check" color="success" size="sm" :loading="ocupado === `aprovar-${item.id}`" @click="analisar(item, 'aprovar')" />
            </template>
            <template v-else-if="item.status === 'nao_possui' && !item.analisadoEm">
              <UButton label="Precisamos do documento" icon="i-lucide-x" color="error" variant="outline" size="sm" @click="abrirRecusa(item)" />
              <UButton label="Aceitar" icon="i-lucide-check" color="success" size="sm" :loading="ocupado === `aceitar-${item.id}`" @click="analisar(item, 'aceitar')" />
            </template>
            <UButton
              v-if="item.status === 'aprovado' || item.status === 'recusado' || (item.status === 'nao_possui' && item.analisadoEm)"
              label="Desfazer análise"
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="ocupado === `desfazer-${item.id}`"
              @click="analisar(item, 'desfazer')"
            />
          </div>
          <p v-if="item.analisadoPorNome && item.status !== 'recusado'" class="text-right text-xs text-muted">
            Analisado por {{ item.analisadoPorNome }} em {{ formatarDataHora(item.analisadoEm) }}
          </p>
        </UCard>

        <UButton
          v-if="s.status !== 'cancelada'"
          label="Pedir mais um documento"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          block
          @click="incluindo = [{ titulo: '', instrucao: null, obrigatorio: true, tipos: ['PDF', 'imagem'], maxArquivos: 5, modeloPath: null, modeloNome: null }]"
        />
      </div>

      <!-- lateral -->
      <div class="space-y-4">
        <UCard>
          <template #header><h2 class="font-semibold">Envio</h2></template>
          <dl class="space-y-3 text-sm">
            <div>
              <dt class="text-xs text-muted">Link do cliente</dt>
              <dd class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ s.link }}</span>
                <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copiar link" @click="copiarLink" />
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">E-mail do pedido</dt>
              <dd>{{ s.enviadoEm ? formatarDataHora(s.enviadoEm) : s.envioErro ? 'não saiu' : 'enviando…' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Cliente abriu o link</dt>
              <dd>{{ s.primeiroAcessoEm ? formatarDataHora(s.primeiroAcessoEm) : 'ainda não' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Última entrega</dt>
              <dd>{{ s.ultimaEntregaEm ? formatarDataHora(s.ultimaEntregaEm) : '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Canal · respostas para</dt>
              <dd>{{ s.contaNome || 'padrão' }} · {{ s.responderPara || 'o do canal' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Lembretes enviados</dt>
              <dd>{{ s.lembretesEnviados }}<template v-if="s.ultimoLembreteEm"> · último em {{ formatarDataHora(s.ultimoLembreteEm) }}</template></dd>
            </div>
            <div v-if="s.pasta">
              <dt class="text-xs text-muted">Pasta</dt>
              <dd class="break-all font-mono text-xs">{{ s.pasta }}</dd>
            </div>
          </dl>
          <template v-if="s.status !== 'cancelada'" #footer>
            <div class="flex flex-wrap gap-2">
              <UButton label="Reenviar pedido" icon="i-lucide-send" color="neutral" variant="outline" size="sm" @click="abrirReenvio" />
              <UButton v-if="faltaDoCliente" label="Enviar lembrete" icon="i-lucide-bell" color="neutral" variant="outline" size="sm" :loading="ocupado === 'lembrete'" @click="lembrar" />
              <UButton v-if="!encerrada && podeCancelar" label="Cancelar" icon="i-lucide-ban" color="error" variant="ghost" size="sm" @click="motivoCancelar = ''; modalCancelar = true" />
            </div>
          </template>
        </UCard>

        <UCard v-if="!encerrada">
          <template #header><h2 class="font-semibold">Ajustes</h2></template>
          <div class="space-y-4">
            <UFormField label="Prazo">
              <div class="flex gap-2">
                <UInput v-model="prazoEdit" type="date" class="flex-1" />
                <UButton
                  label="Salvar"
                  color="neutral"
                  variant="outline"
                  :disabled="(prazoEdit || null) === s.prazo"
                  :loading="ocupado === 'ajuste'"
                  @click="ajustar({ prazo: prazoEdit || null })"
                />
              </div>
            </UFormField>
            <USwitch :model-value="s.lembretes" label="Lembretes automáticos" @update:model-value="v => ajustar({ lembretes: v })" />
            <USwitch :model-value="s.avisarConclusao" label="Avisar o cliente ao concluir" @update:model-value="v => ajustar({ avisarConclusao: v })" />
          </div>
        </UCard>

        <UCard v-if="s.mensagem">
          <template #header><h2 class="font-semibold">Mensagem enviada</h2></template>
          <p class="whitespace-pre-line text-sm">{{ s.mensagem }}</p>
        </UCard>

        <UCard>
          <template #header><h2 class="font-semibold">Histórico</h2></template>
          <ol class="space-y-3">
            <li v-for="e in s.eventos" :key="e.id" class="flex gap-3 text-sm">
              <UIcon :name="ICONE_EVENTO_SOLIC[e.tipo] || 'i-lucide-dot'" class="mt-0.5 size-4 shrink-0 text-muted" />
              <div class="min-w-0">
                <p>{{ e.descricao }}</p>
                <p class="text-xs text-muted">
                  {{ formatarDataHora(e.criadoEm) }}<template v-if="e.porNome && e.porNome !== 'cliente'"> · {{ e.porNome }}</template><template v-if="e.ip"> · IP {{ e.ip }}</template>
                </p>
              </div>
            </li>
          </ol>
        </UCard>
      </div>
    </div>

    <!-- recusar -->
    <UModal :open="!!recusando" :title="`Recusar “${recusando?.titulo}”`" description="O motivo vai para o cliente no e-mail de pendências." @update:open="v => { if (!v) recusando = null }">
      <template #body>
        <div class="space-y-4">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="m in MOTIVOS_RAPIDOS"
              :key="m"
              :label="m"
              size="xs"
              color="neutral"
              :variant="motivoRecusa === m ? 'solid' : 'outline'"
              @click="motivoRecusa = m"
            />
          </div>
          <UFormField label="Motivo" required>
            <UTextarea v-model="motivoRecusa" :rows="3" autoresize class="w-full" placeholder="Ex.: A foto ficou tremida — dá para tirar de novo, com boa luz?" />
          </UFormField>
          <UCheckbox
            v-if="recusando?.arquivos.some(a => !a.removidoEm)"
            v-model="descartar"
            label="Descartar os arquivos recusados"
            description="Tira da pasta do cliente o que não serve. O registro do envio fica no histórico."
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="recusando = null" />
          <UButton label="Recusar" icon="i-lucide-x" color="error" :disabled="motivoRecusa.trim().length < 3" :loading="ocupado?.startsWith('recusar')" @click="confirmarRecusa" />
        </div>
      </template>
    </UModal>

    <!-- incluir documento -->
    <UModal
      :open="!!incluindo"
      title="Pedir mais um documento"
      description="O cliente vê o item novo no mesmo link. Para avisá-lo por e-mail, use “Enviar lembrete”."
      :ui="{ content: 'sm:max-w-2xl' }"
      @update:open="v => { if (!v) incluindo = null }"
    >
      <template #body>
        <EditorItensSolic v-if="incluindo" v-model="incluindo" />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="incluindo = null" />
          <UButton
            label="Incluir"
            icon="i-lucide-plus"
            :disabled="incluindo?.length !== 1 || !incluindo[0]?.titulo.trim()"
            :loading="ocupado === 'incluir'"
            @click="incluirItem"
          />
        </div>
      </template>
    </UModal>

    <!-- reenviar -->
    <UModal v-model:open="modalReenvio" title="Reenviar o pedido" description="O link continua o mesmo: o que o cliente já enviou segue valendo.">
      <template #body>
        <UFormField label="Para" help="Corrija o e-mail se o cliente informou outro. O antigo fica no histórico.">
          <UInput v-model="emailReenvio" type="email" class="w-full" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="modalReenvio = false" />
          <UButton label="Reenviar agora" icon="i-lucide-send" :loading="ocupado === 'reenviar'" @click="reenviar" />
        </div>
      </template>
    </UModal>

    <!-- concluir -->
    <UModal v-model:open="modalConcluir" title="Concluir a solicitação" description="Use quando o que faltava chegou por outro caminho ou não é mais necessário. O link deixa de aceitar envios.">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Observação (opcional)">
            <UTextarea v-model="obsConclusao" :rows="2" autoresize class="w-full" placeholder="Ex.: o comprovante chegou pelo WhatsApp" />
          </UFormField>
          <UCheckbox v-model="avisarNaConclusao" label="Mandar ao cliente o “recebemos tudo, obrigado”" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="modalConcluir = false" />
          <UButton label="Concluir" icon="i-lucide-badge-check" color="success" :loading="ocupado === 'concluir'" @click="concluir" />
        </div>
      </template>
    </UModal>

    <!-- cancelar -->
    <UModal v-model:open="modalCancelar" title="Cancelar a solicitação" description="O link do cliente passa a mostrar “solicitação encerrada”. O que já chegou fica na pasta.">
      <template #body>
        <UFormField label="Motivo" required>
          <UTextarea v-model="motivoCancelar" :rows="2" autoresize class="w-full" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="modalCancelar = false" />
          <UButton label="Cancelar solicitação" icon="i-lucide-ban" color="error" :disabled="motivoCancelar.trim().length < 3" :loading="ocupado === 'cancelar'" @click="cancelar" />
        </div>
      </template>
    </UModal>
  </div>
</template>
