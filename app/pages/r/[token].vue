<script setup lang="ts">
import { acceptDe, tiposDoItem, tipoPelaExtensao, descreverFamilias, iconeDoArquivo, TIPOS_SOLICITACAO } from '~~/shared/types/tipos-arquivo'

/**
 * Página do CLIENTE para enviar os documentos pedidos. Sempre clara (a marca
 * tem cor fixa), pensada primeiro para o celular: um cartão por documento,
 * botão de câmera, e cada arquivo sobe sozinho com a sua barra de progresso.
 */
definePageMeta({ layout: false, colorMode: 'light' })

const route = useRoute()
const toast = useToast()
const token = String(route.params.token)

const { data, error, refresh } = await useFetch<LandingSolicitacao>(api(`/api/r/${token}`))
useHead({ title: () => (data.value ? `${data.value.titulo} — Contábil Gaulke` : 'Envio de documentos — Contábil Gaulke') })

type Item = LandingSolicitacao['itens'][number]
const encerrada = computed(() => data.value?.status === 'concluida' || data.value?.status === 'cancelada')
const obrigatorios = computed(() => data.value?.itens.filter(i => i.obrigatorio) ?? [])
const entregue = (i: Item) => i.status === 'enviado' || i.status === 'aprovado' || i.status === 'nao_possui'
const feitos = computed(() => obrigatorios.value.filter(entregue).length)
const pct = computed(() => (obrigatorios.value.length ? Math.round((feitos.value / obrigatorios.value.length) * 100) : 100))
const tudoEntregue = computed(() => obrigatorios.value.length > 0 && feitos.value === obrigatorios.value.length)
const recusados = computed(() => data.value?.itens.filter(i => i.status === 'recusado').length ?? 0)
const atrasada = computed(() => !!data.value && solicitacaoAtrasada(data.value))

const aceitaFoto = (i: Item) => !i.tipos.length || i.tipos.includes('imagem')
const podeMexer = (i: Item) => !encerrada.value && i.status !== 'aprovado'
const ativos = (i: Item) => i.arquivos.length

/* ---------- envio de arquivos ---------- */
type Subindo = { chave: string; itemId: number; nome: string; progresso: number; erro: string | null }
const subindo = ref<Subindo[]>([])
const LIMITE = 25 * 1024 * 1024

function enviarUm(itemId: number, arquivo: File, marca: Subindo): Promise<void> {
  // XHR e não fetch: só ele informa o progresso do upload
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', api(`/api/r/${token}/itens/${itemId}/arquivos`))
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) marca.progresso = Math.round((e.loaded / e.total) * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        marca.progresso = 100
      } else {
        let msg = 'Não foi possível enviar este arquivo.'
        try {
          const r = JSON.parse(xhr.responseText)
          msg = r.statusMessage || r.message || msg
        } catch {}
        if (xhr.status === 413) msg = 'O arquivo é grande demais (máximo de 25 MB).'
        if (xhr.status === 429) msg = 'Muitos envios seguidos. Aguarde um minuto e tente de novo.'
        marca.erro = msg
      }
      resolve()
    }
    xhr.onerror = () => {
      marca.erro = 'A conexão caiu durante o envio. Tente de novo.'
      resolve()
    }
    const fd = new FormData()
    fd.append('arquivo', arquivo)
    xhr.send(fd)
  })
}

async function escolher(item: Item, e: Event) {
  const input = e.target as HTMLInputElement
  const arquivos = [...(input.files ?? [])]
  input.value = ''
  if (!arquivos.length) return
  const vagas = item.maxArquivos - ativos(item)
  if (arquivos.length > vagas) {
    toast.add({
      title: vagas > 0 ? `Este item aceita mais ${vagas} arquivo(s)` : 'Este item já está com o máximo de arquivos',
      description: vagas > 0 ? `Vamos enviar os ${vagas} primeiros.` : 'Remova um para enviar outro.',
      color: 'warning'
    })
  }
  const tipos = tiposDoItem(item.tipos)
  const fila: { arquivo: File; marca: Subindo }[] = []
  for (const arquivo of arquivos.slice(0, Math.max(0, vagas))) {
    const marca = reactive<Subindo>({ chave: `${item.id}-${arquivo.name}-${Math.random()}`, itemId: item.id, nome: arquivo.name, progresso: 0, erro: null })
    if (!tipoPelaExtensao(arquivo.name, tipos)) marca.erro = `Formato não aceito aqui. Envie ${descreverFamilias(item.tipos)}.`
    else if (arquivo.size > LIMITE) marca.erro = 'O arquivo passa de 25 MB. Envie uma versão menor.'
    subindo.value.push(marca)
    if (!marca.erro) fila.push({ arquivo, marca })
  }
  // um de cada vez: o celular em 4G agradece, e o progresso fica legível
  for (const f of fila) await enviarUm(item.id, f.arquivo, f.marca)
  await refresh()
  // os que deram certo já aparecem na lista do item; ficam só os erros
  subindo.value = subindo.value.filter(s => s.erro || !fila.some(f => f.marca === s))
  const ok = fila.filter(f => !f.marca.erro).length
  if (ok) toast.add({ title: ok === 1 ? 'Arquivo enviado' : `${ok} arquivos enviados`, icon: 'i-lucide-check', color: 'success' })
}
const subindoDo = (item: Item) => subindo.value.filter(s => s.itemId === item.id)
function dispensar(chave: string) {
  subindo.value = subindo.value.filter(s => s.chave !== chave)
}

/* ---------- remover ---------- */
const removendo = ref<{ item: Item; arquivo: Item['arquivos'][number] } | null>(null)
const ocupado = ref(false)
async function confirmarRemocao() {
  if (!removendo.value) return
  ocupado.value = true
  try {
    await $fetch(api(`/api/r/${token}/arquivos/${removendo.value.arquivo.id}`), { method: 'DELETE' })
    removendo.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível remover', description: e?.data?.statusMessage, color: 'error' })
  } finally {
    ocupado.value = false
  }
}

/* ---------- não possuo ---------- */
const naoPossuoAberto = ref<number | null>(null)
const justificativa = ref('')
async function marcarNaoPossuo(item: Item) {
  ocupado.value = true
  try {
    await $fetch(api(`/api/r/${token}/itens/${item.id}/nao-possuo`), { method: 'POST', body: { justificativa: justificativa.value } })
    naoPossuoAberto.value = null
    justificativa.value = ''
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível registrar', description: e?.data?.statusMessage, color: 'error' })
  } finally {
    ocupado.value = false
  }
}
async function desfazer(item: Item) {
  ocupado.value = true
  try {
    await $fetch(api(`/api/r/${token}/itens/${item.id}/desfazer`), { method: 'POST' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível desfazer', description: e?.data?.statusMessage, color: 'error' })
  } finally {
    ocupado.value = false
  }
}

/* ---------- apresentação ---------- */
const ROTULO_CLIENTE: Record<StatusItemSolicitacao, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  aprovado: 'Conferido',
  recusado: 'Precisa enviar de novo',
  nao_possui: 'Você não possui'
}
const COR_CARTAO: Record<StatusItemSolicitacao, string> = {
  pendente: 'border-default',
  enviado: 'border-info/40',
  aprovado: 'border-success/40',
  recusado: 'border-error ring-1 ring-error/30',
  nao_possui: 'border-warning/40'
}

const textoWhatsapp = computed(() =>
  data.value ? `Ola! Tenho uma duvida sobre a solicitacao de documentos ${data.value.codigo} (${data.value.titulo}).` : 'Ola!'
)
</script>

<template>
  <div class="flex min-h-screen flex-col bg-elevated/40">
    <main class="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-8 sm:pt-10">
      <UCard v-if="error">
        <div class="space-y-3 py-6 text-center">
          <UIcon name="i-lucide-link-2-off" class="size-12 text-muted" />
          <h1 class="text-xl font-semibold">Link inválido ou expirado</h1>
          <p class="text-muted">Confira se o endereço foi copiado por completo. Em caso de dúvida, responda ao e-mail que você recebeu.</p>
        </div>
      </UCard>

      <template v-else-if="data">
        <div class="mb-6 flex flex-col items-center gap-3 text-center">
          <img :src="api('/brand/logo.png')" alt="Contábil Gaulke" class="h-14 w-auto sm:h-16" />
          <h1 class="text-2xl font-semibold">Olá, {{ data.nome || 'tudo bem' }}!</h1>
          <p v-if="data.empresa" class="text-base font-semibold text-primary">{{ data.empresa }}</p>
        </div>

        <!-- cancelada -->
        <UCard v-if="data.status === 'cancelada'">
          <div class="space-y-3 py-6 text-center">
            <UIcon name="i-lucide-circle-slash" class="size-12 text-muted" />
            <h2 class="text-lg font-semibold">Esta solicitação foi encerrada</h2>
            <p class="text-muted">Não é preciso enviar mais nada por aqui. Em caso de dúvida, fale com a nossa equipe.</p>
          </div>
        </UCard>

        <template v-else>
          <UCard class="mb-4">
            <p class="text-xs uppercase tracking-wide text-muted">Solicitação {{ data.codigo }}</p>
            <h2 class="mt-1 text-lg font-semibold">{{ data.titulo }}</h2>
            <p v-if="data.mensagem" class="mt-2 whitespace-pre-line text-sm text-default">{{ data.mensagem }}</p>
            <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span v-if="data.prazo" :class="atrasada ? 'font-medium text-error' : 'text-muted'">
                <UIcon name="i-lucide-calendar-clock" class="mr-1 size-4 align-[-3px]" />Prazo: {{ formatarPrazo(data.prazo) }}{{ atrasada ? ' (vencido)' : '' }}
              </span>
              <span class="text-muted">
                <UIcon name="i-lucide-list-checks" class="mr-1 size-4 align-[-3px]" />{{ feitos }} de {{ obrigatorios.length }} obrigatório(s)
              </span>
            </div>
            <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-elevated" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
              <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: `${pct}%` }" />
            </div>
          </UCard>

          <UAlert
            v-if="data.status === 'concluida'"
            class="mb-4"
            color="success"
            variant="subtle"
            icon="i-lucide-badge-check"
            title="Recebemos tudo, obrigado!"
            description="A nossa equipe conferiu os documentos. Não é preciso enviar mais nada."
          />
          <UAlert
            v-else-if="recusados"
            class="mb-4"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="recusados === 1 ? 'Um documento precisa ser enviado de novo' : `${recusados} documentos precisam ser enviados de novo`"
            description="O motivo está no próprio item, logo abaixo."
          />
          <UAlert
            v-else-if="tudoEntregue"
            class="mb-4"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Pronto! Você enviou tudo o que era obrigatório."
            description="A nossa equipe vai conferir e avisa por e-mail se precisar de algo. Você ainda pode mandar os opcionais."
          />

          <div class="space-y-3">
            <section
              v-for="(item, n) in data.itens"
              :key="item.id"
              class="rounded-xl border bg-default p-4 shadow-xs"
              :class="COR_CARTAO[item.status]"
            >
              <div class="flex items-start gap-3">
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  :class="entregue(item) ? 'bg-success/15 text-success' : item.status === 'recusado' ? 'bg-error/15 text-error' : 'bg-elevated text-muted'"
                >
                  <UIcon v-if="entregue(item)" name="i-lucide-check" class="size-4" />
                  <template v-else>{{ n + 1 }}</template>
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium leading-snug">
                    {{ item.titulo }}
                    <span v-if="!item.obrigatorio" class="text-xs font-normal text-muted">(opcional)</span>
                  </h3>
                  <p v-if="item.instrucao" class="mt-0.5 text-sm text-muted">{{ item.instrucao }}</p>
                  <p class="mt-0.5 text-xs text-muted">{{ descreverFamilias(item.tipos) }} · até {{ item.maxArquivos }} arquivo(s)</p>
                </div>
                <UBadge
                  v-if="item.status !== 'pendente'"
                  :color="COR_STATUS_ITEM[item.status]"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                >{{ ROTULO_CLIENTE[item.status] }}</UBadge>
              </div>

              <div v-if="item.status === 'recusado' && item.motivo" class="mt-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                <strong>O que precisa mudar:</strong> {{ item.motivo }}
              </div>
              <div v-if="item.status === 'nao_possui'" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
                <span>Você informou que não possui{{ item.motivo ? `: “${item.motivo}”` : '.' }}<template v-if="item.analisado"> A equipe já conferiu.</template></span>
                <UButton v-if="!encerrada && !item.analisado" label="Desfazer" size="xs" color="neutral" variant="ghost" :loading="ocupado" @click="desfazer(item)" />
              </div>

              <!-- arquivo modelo -->
              <a
                v-if="item.modeloNome && podeMexer(item) && item.status !== 'nao_possui'"
                :href="api(`/api/r/${token}/itens/${item.id}/modelo`)"
                class="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-sm text-primary hover:bg-primary/5"
              >
                <UIcon name="i-lucide-file-down" class="size-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate">Baixe o modelo, preencha e envie de volta: {{ item.modeloNome }}</span>
              </a>

              <!-- arquivos já enviados -->
              <ul v-if="item.arquivos.length" class="mt-3 space-y-1.5">
                <li v-for="a in item.arquivos" :key="a.id" class="flex items-center gap-2 rounded-lg bg-elevated/60 px-3 py-2 text-sm">
                  <UIcon :name="iconeDoArquivo(a.nome, TIPOS_SOLICITACAO)" class="size-4 shrink-0 text-primary" />
                  <span class="min-w-0 flex-1 truncate">{{ a.nome }}</span>
                  <span v-if="a.antivirus === 'pendente' || a.antivirus === 'erro'" class="shrink-0 text-xs text-muted">verificando…</span>
                  <span v-else class="shrink-0 text-xs text-muted">{{ tamanho(a.tamanho) }}</span>
                  <UButton
                    v-if="podeMexer(item)"
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Remover ${a.nome}`"
                    @click="removendo = { item, arquivo: a }"
                  />
                </li>
              </ul>

              <!-- subindo agora / erros -->
              <ul v-if="subindoDo(item).length" class="mt-3 space-y-1.5">
                <li v-for="s in subindoDo(item)" :key="s.chave" class="rounded-lg border px-3 py-2 text-sm" :class="s.erro ? 'border-error/40 bg-error/5' : 'border-default'">
                  <div class="flex items-center gap-2">
                    <UIcon :name="s.erro ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'" class="size-4 shrink-0" :class="s.erro ? 'text-error' : 'animate-spin text-primary'" />
                    <span class="min-w-0 flex-1 truncate">{{ s.nome }}</span>
                    <span v-if="!s.erro" class="shrink-0 text-xs tabular-nums text-muted">{{ s.progresso }}%</span>
                    <UButton v-else icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Dispensar" @click="dispensar(s.chave)" />
                  </div>
                  <p v-if="s.erro" class="mt-1 text-xs text-error">{{ s.erro }}</p>
                  <div v-else class="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
                    <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${s.progresso}%` }" />
                  </div>
                </li>
              </ul>

              <!-- ações -->
              <div v-if="podeMexer(item) && item.status !== 'nao_possui'" class="mt-3">
                <div v-if="naoPossuoAberto === item.id" class="space-y-2 rounded-lg border border-default p-3">
                  <p class="text-sm font-medium">Não tem este documento?</p>
                  <UTextarea
                    v-model="justificativa"
                    :rows="2"
                    autoresize
                    class="w-full"
                    :placeholder="'Se quiser, conte o motivo'"
                  />
                  <div class="flex justify-end gap-2">
                    <UButton label="Voltar" size="sm" color="neutral" variant="ghost" @click="naoPossuoAberto = null" />
                    <UButton
                      label="Confirmar"
                      size="sm"
                      color="warning"
                      :disabled="item.obrigatorio"
                      :loading="ocupado"
                      @click="marcarNaoPossuo(item)"
                    />
                  </div>
                </div>
                <div v-else-if="ativos(item) < item.maxArquivos" class="flex flex-wrap gap-2">
                  <!-- no celular o botão principal ocupa a linha; câmera e "não possuo" vão embaixo -->
                  <label class="w-full min-w-0 sm:w-auto sm:flex-1">
                    <input
                      type="file"
                      class="sr-only"
                      multiple
                      :accept="acceptDe(tiposDoItem(item.tipos))"
                      @change="escolher(item, $event)"
                    />
                    <UButton
                      as="span"
                      :label="ativos(item) ? 'Enviar mais' : 'Escolher arquivo'"
                      icon="i-lucide-upload"
                      block
                      class="cursor-pointer"
                      :variant="ativos(item) ? 'outline' : 'solid'"
                    />
                  </label>
                  <!-- câmera: no celular abre direto a traseira -->
                  <label v-if="aceitaFoto(item)" class="sm:hidden">
                    <input type="file" class="sr-only" accept="image/*" capture="environment" @change="escolher(item, $event)" />
                    <UButton as="span" icon="i-lucide-camera" label="Foto" color="neutral" variant="outline" class="cursor-pointer" />
                  </label>
                  <!-- só no opcional: se é obrigatório, "não tenho" não é resposta -->
                  <UButton
                    v-if="!ativos(item) && !item.obrigatorio"
                    label="Não possuo"
                    color="neutral"
                    variant="ghost"
                    @click="naoPossuoAberto = item.id; justificativa = ''"
                  />
                </div>
                <p v-else class="text-xs text-muted">Limite de {{ item.maxArquivos }} arquivo(s) atingido. Remova um para enviar outro.</p>
              </div>
            </section>
          </div>

          <div class="mt-6 rounded-lg border border-default bg-default/50 p-4">
            <div class="flex gap-3">
              <UIcon name="i-lucide-shield-check" class="size-5 shrink-0 text-muted" />
              <div class="space-y-1 text-xs leading-relaxed text-muted">
                <p class="font-medium text-default">Seus documentos em segurança</p>
                <p>
                  Os arquivos passam por um antivírus e ficam guardados pela Contábil Gaulke, usados somente para esta finalidade.
                  Registramos a data, a hora e o endereço IP de cada envio, conforme a Lei 13.709/2018 (LGPD).
                  Você pode enviar aos poucos: este link guarda o que já foi enviado. Ele é pessoal — evite compartilhá-lo.
                </p>
              </div>
            </div>
          </div>
        </template>
      </template>
    </main>

    <!-- pb maior no celular: o botão flutuante do WhatsApp não cobre o texto -->
    <footer class="border-t border-default px-4 pb-24 pt-6 text-center text-xs text-muted sm:pb-6">
      Contábil Gaulke · Em caso de dúvida, fale conosco pelo WhatsApp ou responda ao e-mail recebido.
    </footer>

    <BotaoWhatsapp :texto="textoWhatsapp" />

    <UModal :open="!!removendo" title="Remover este arquivo?" :description="removendo?.arquivo.nome" @update:open="v => { if (!v) removendo = null }">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Manter" color="neutral" variant="ghost" @click="removendo = null" />
          <UButton label="Remover" icon="i-lucide-trash-2" color="error" :loading="ocupado" @click="confirmarRemocao" />
        </div>
      </template>
    </UModal>
  </div>
</template>
