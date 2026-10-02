<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useHead({ title: 'Nova assinatura — Gaulke Comunica' })

/**
 * Enviar um PDF para assinatura em quatro passos: o documento, quem assina
 * (em paralelo ou em sequência), onde cada um assina no PDF e o envio (prazo,
 * selo da Gaulke, canal). Os campos são opcionais: sem campo, a assinatura
 * aparece só na folha de assinaturas anexada ao final.
 */
const toast = useToast()
const { sessao } = usePapel()

const PASSOS = [
  { titulo: 'Documento', icone: 'i-lucide-file-text' },
  { titulo: 'Quem assina', icone: 'i-lucide-users' },
  { titulo: 'Campos no PDF', icone: 'i-lucide-pen-line' },
  { titulo: 'Envio', icone: 'i-lucide-send' }
]
const passo = ref(0)

/* ---------- 1. documento ---------- */
type Enviado = { arquivoTmp: string; nome: string; tamanho: number; sha256: string; paginas: { largura: number; altura: number }[]; jaAssinado: boolean }
const enviado = ref<Enviado | null>(null)
const conteudo = shallowRef<ArrayBuffer | null>(null)
const enviando = ref(false)
const titulo = ref('')
const mensagem = ref('')
const clienteNome = ref('')
const clienteDocumento = ref('')

/* cliente: texto livre, com sugestões das empresas e clientes cadastrados (BuscaEmpresa) */
function escolherCliente(e: EmpresaEncontrada) {
  clienteDocumento.value = formatarDocumento(e.documento)
}

async function escolherPdf(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  enviando.value = true
  try {
    const fd = new FormData()
    fd.append('arquivo', f)
    enviado.value = await $fetch<Enviado>(api('/api/admin/assinaturas/pdf'), { method: 'POST', body: fd })
    conteudo.value = await f.arrayBuffer()
    campos.value = []
    if (!titulo.value) titulo.value = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  } catch (err: any) {
    toast.add({ title: 'Não foi possível usar este PDF', description: err?.data?.statusMessage || err?.statusMessage, color: 'error' })
  } finally {
    enviando.value = false
  }
}

/* ---------- 2. quem assina ---------- */
type Signatario = { nome: string; email: string; cpf: string; papel: string }
const signatarios = ref<Signatario[]>([{ nome: '', email: '', cpf: '', papel: '' }])
const ordem = ref<'paralela' | 'sequencial'>('paralela')
const RE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const valido = (s: Signatario) => s.nome.trim().length >= 3 && RE_EMAIL.test(s.email.trim()) && documentoValido(s.cpf)
// USelect não aceita valor vazio: "sem papel" tem um valor próprio
const SEM_PAPEL = '__sem__'
const OPCOES_PAPEL = [{ label: 'Sem papel', value: SEM_PAPEL }, ...PAPEIS_ASSINATURA.map(p => ({ label: p, value: p }))]
const testemunhas = computed(() => signatarios.value.filter(s => s.papel === 'Testemunha').length)
const signatariosOk = computed(() => {
  const emails = signatarios.value.map(s => s.email.trim().toLowerCase())
  return signatarios.value.length > 0 && signatarios.value.every(valido) && new Set(emails).size === emails.length
})
function mover(i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= signatarios.value.length) return
  const l = [...signatarios.value]
  ;[l[i], l[j]] = [l[j]!, l[i]!]
  signatarios.value = l
  // os campos seguem a pessoa, não a posição
  campos.value = campos.value.map(c => ({ ...c, signatario: c.signatario === i ? j : c.signatario === j ? i : c.signatario }))
}
function removerSignatario(i: number) {
  signatarios.value.splice(i, 1)
  campos.value = campos.value.filter(c => c.signatario !== i).map(c => ({ ...c, signatario: c.signatario > i ? c.signatario - 1 : c.signatario }))
  if (!signatarios.value.length) signatarios.value.push({ nome: '', email: '', cpf: '', papel: '' })
}
function incluirEu() {
  const u = sessao.value?.usuario
  if (!u?.email) return
  if (signatarios.value.some(s => s.email.trim().toLowerCase() === u.email!.toLowerCase())) return
  const vazio = signatarios.value.findIndex(s => !s.nome && !s.email)
  const eu = { nome: u.nome, email: u.email, cpf: '', papel: 'Contábil Gaulke' }
  if (vazio >= 0) signatarios.value[vazio] = eu
  else signatarios.value.push(eu)
}

/* ---------- 3. campos ---------- */
// cores por pessoa, fixas pela posição na lista (nunca geradas)
const CORES = ['#2a78d6', '#eb6834', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#475569']
const cor = (i: number) => CORES[i % CORES.length]!
type CampoTela = { id: number; signatario: number; tipo: TipoCampoAssinatura; pagina: number; x: number; topo: number; largura: number; altura: number }
const campos = ref<CampoTela[]>([])
const quem = ref(0)
const tipoCampo = ref<TipoCampoAssinatura>('assinatura')
const TAMANHO: Record<TipoCampoAssinatura, [number, number]> = { assinatura: [170, 50], rubrica: [60, 36], data: [90, 18], nome: [170, 18] }
const TIPOS: { valor: TipoCampoAssinatura; rotulo: string; icone: string }[] = [
  { valor: 'assinatura', rotulo: 'Assinatura', icone: 'i-lucide-signature' },
  { valor: 'rubrica', rotulo: 'Rubrica', icone: 'i-lucide-pen-tool' },
  { valor: 'data', rotulo: 'Data', icone: 'i-lucide-calendar' },
  { valor: 'nome', rotulo: 'Nome', icone: 'i-lucide-type' }
]
let proximoId = 1

function adicionarCampo(e: MouseEvent, numero: number, largura: number, altura: number, escala: number) {
  if ((e.target as HTMLElement).closest('[data-campo]')) return
  const caixa = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const [w, h] = TAMANHO[tipoCampo.value]
  const x = Math.min(Math.max(0, (e.clientX - caixa.left) / escala - w / 2), largura - w)
  const topo = Math.min(Math.max(0, (e.clientY - caixa.top) / escala - h / 2), altura - h)
  campos.value.push({ id: proximoId++, signatario: quem.value, tipo: tipoCampo.value, pagina: numero, x, topo, largura: w, altura: h })
}
function removerCampo(id: number) {
  campos.value = campos.value.filter(c => c.id !== id)
}

// arrastar e redimensionar (em pontos do PDF)
let arraste: { id: number; modo: 'mover' | 'tamanho'; x0: number; y0: number; orig: CampoTela; escala: number; limite: { largura: number; altura: number } } | null = null
function iniciarArraste(e: PointerEvent, c: CampoTela, modo: 'mover' | 'tamanho', escala: number, largura: number, altura: number) {
  e.preventDefault()
  e.stopPropagation()
  arraste = { id: c.id, modo, x0: e.clientX, y0: e.clientY, orig: { ...c }, escala, limite: { largura, altura } }
  window.addEventListener('pointermove', aoMover)
  window.addEventListener('pointerup', aoSoltar, { once: true })
}
function aoMover(e: PointerEvent) {
  if (!arraste) return
  const a = arraste
  const dx = (e.clientX - a.x0) / a.escala
  const dy = (e.clientY - a.y0) / a.escala
  campos.value = campos.value.map(c => {
    if (c.id !== a.id) return c
    if (a.modo === 'mover') {
      return { ...c, x: Math.min(Math.max(0, a.orig.x + dx), a.limite.largura - c.largura), topo: Math.min(Math.max(0, a.orig.topo + dy), a.limite.altura - c.altura) }
    }
    return {
      ...c,
      largura: Math.min(Math.max(20, a.orig.largura + dx), a.limite.largura - c.x),
      altura: Math.min(Math.max(12, a.orig.altura + dy), a.limite.altura - c.topo)
    }
  })
}
function aoSoltar() {
  arraste = null
  window.removeEventListener('pointermove', aoMover)
}
onBeforeUnmount(() => window.removeEventListener('pointermove', aoMover))

const semAssinatura = computed(() =>
  signatarios.value.map((s, i) => ({ s, i })).filter(({ i }) => !campos.value.some(c => c.signatario === i && c.tipo === 'assinatura'))
)

/* ---------- 4. envio ---------- */
const prazo = ref('')
const selo = ref(false)
const { data: opcoes } = await useFetch<{ certificados: { id: number; nome: string; titular: string; documento: string | null; validoAte: string; padrao: boolean }[] }>(api('/api/admin/assinaturas/opcoes'), { default: () => ({ certificados: [] }) })
const certificadoId = ref<number | undefined>(undefined)
watch(() => opcoes.value.certificados, cs => { if (!certificadoId.value) certificadoId.value = cs[0]?.id }, { immediate: true })

const { data: contasData } = await useFetch<RespostaContas>(api('/api/admin/contas'), { lazy: true, server: false })
const contasAtivas = computed(() => (contasData.value?.contas ?? []).filter(c => c.ativa))
const contaId = ref(0)
watch(contasAtivas, cs => { if (!contaId.value) contaId.value = cs.find(c => c.padrao)?.id ?? cs[0]?.id ?? 0 }, { immediate: true })
const itensConta = computed(() => contasAtivas.value.map(c => ({ label: c.padrao ? `${c.nome} (padrão)` : c.nome, value: c.id })))
const meuEmail = computed(() => sessao.value?.usuario?.email ?? null)
const respostasParaMim = ref(true)

const podeAvancar = computed(() => [!!enviado.value && titulo.value.trim().length >= 3, signatariosOk.value, true, !prazo.value || prazo.value >= dataSP()][passo.value])
const alcancavel = (n: number) => n === 0 || (!!enviado.value && titulo.value.trim().length >= 3 && (n === 1 || signatariosOk.value))

const confirmando = ref(false)
const conferi = ref(false)
const criando = ref(false)
async function enviar() {
  if (!enviado.value) return
  criando.value = true
  try {
    const r = await $fetch<{ id: number }>(api('/api/admin/assinaturas'), {
      method: 'POST',
      body: {
        arquivoTmp: enviado.value.arquivoTmp,
        arquivoNome: enviado.value.nome,
        titulo: titulo.value,
        mensagem: mensagem.value || null,
        ordem: ordem.value,
        assinarComoGaulke: selo.value,
        certificadoId: selo.value ? certificadoId.value ?? null : null,
        prazo: prazo.value || null,
        clienteNome: clienteNome.value || null,
        clienteDocumento: clienteDocumento.value || null,
        contaId: contaId.value || null,
        responderPara: respostasParaMim.value ? meuEmail.value : null,
        signatarios: signatarios.value.map(s => ({ nome: s.nome.trim(), email: s.email.trim(), cpf: s.cpf || null, papel: s.papel.trim() || null })),
        campos: campos.value.map(c => {
          const pg = enviado.value!.paginas[c.pagina - 1]!
          // a tela mede do topo; o PDF, da base
          return { signatario: c.signatario, tipo: c.tipo, pagina: c.pagina, x: c.x, y: pg.altura - c.topo - c.altura, largura: c.largura, altura: c.altura }
        })
      }
    })
    toast.add({ title: 'Documento enviado para assinatura', color: 'success', icon: 'i-lucide-send' })
    await navigateTo(`/admin/assinaturas/${r.id}`)
  } catch (e: any) {
    toast.add({ title: 'Não foi possível enviar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    criando.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Nova assinatura</h1>
        <p class="text-sm text-muted">Cada pessoa recebe um link, confirma com um código enviado ao e-mail e assina. Ninguém precisa de certificado.</p>
      </div>
      <UButton to="/admin/assinaturas" label="Voltar" icon="i-lucide-arrow-left" color="neutral" variant="ghost" />
    </div>

    <ol class="grid grid-cols-4 gap-2">
      <li v-for="(p, n) in PASSOS" :key="p.titulo">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="n === passo ? 'border-primary bg-primary/10 text-primary' : 'border-default bg-default hover:bg-elevated'"
          :disabled="!alcancavel(n)"
          @click="passo = n"
        >
          <UIcon :name="n < passo ? 'i-lucide-circle-check' : p.icone" class="size-4 shrink-0" />
          <span class="hidden truncate sm:inline">{{ p.titulo }}</span>
          <span class="sm:hidden">{{ n + 1 }}</span>
        </button>
      </li>
    </ol>

    <!-- 1. documento -->
    <section v-if="passo === 0" class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4">
        <label class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-default bg-default p-8 text-center transition hover:border-primary">
          <input type="file" accept="application/pdf,.pdf" class="sr-only" @change="escolherPdf" />
          <UIcon :name="enviando ? 'i-lucide-loader-circle' : 'i-lucide-file-up'" class="size-10 text-primary" :class="{ 'animate-spin': enviando }" />
          <span class="font-medium">{{ enviado ? 'Trocar o PDF' : 'Escolher o PDF' }}</span>
          <span class="text-xs text-muted">Só PDF, sem senha, até 25 MB</span>
        </label>
        <div v-if="enviado" class="rounded-lg border border-default bg-default p-4 text-sm">
          <p class="font-medium">{{ enviado.nome }}</p>
          <p class="text-muted">{{ enviado.paginas.length }} página(s) · {{ tamanho(enviado.tamanho) }}</p>
          <p class="mt-1 break-all font-mono text-[11px] text-muted">SHA-256 {{ enviado.sha256 }}</p>
          <UAlert v-if="enviado.jaAssinado" class="mt-3" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Este PDF já tem assinatura digital" description="Ao desenhar as novas assinaturas nele, a assinatura digital anterior deixa de ser válida. Se ela importa, envie o PDF sem ela." />
        </div>
      </div>
      <div class="space-y-4">
        <UFormField label="Título" required help="Aparece no e-mail, na página de quem assina e na folha de assinaturas.">
          <UInput v-model="titulo" placeholder="Ex.: Contrato de prestação de serviços contábeis" class="w-full" />
        </UFormField>
        <UFormField label="Mensagem (opcional)">
          <UTextarea v-model="mensagem" :rows="3" autoresize class="w-full" placeholder="Vazio usa um texto padrão." />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Cliente / empresa (opcional)" help="Digite para buscar nos clientes da Gaulke, ou escreva livremente. Organiza a pasta.">
            <BuscaEmpresa v-model="clienteNome" @escolher="escolherCliente" />
          </UFormField>
          <UFormField label="CPF/CNPJ do cliente" :error="clienteDocumento && !documentoValido(clienteDocumento) ? 'CPF tem 11 dígitos; CNPJ, 14' : undefined">
            <UInput
              :model-value="clienteDocumento"
              placeholder="00.000.000/0000-00"
              inputmode="numeric"
              class="w-full"
              @update:model-value="v => (clienteDocumento = mascaraDocumento(String(v ?? '')))"
            />
          </UFormField>
        </div>
      </div>
    </section>

    <!-- 2. quem assina -->
    <section v-else-if="passo === 1" class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <UFieldGroup>
          <UButton :color="ordem === 'paralela' ? 'primary' : 'neutral'" :variant="ordem === 'paralela' ? 'soft' : 'outline'" label="Todos ao mesmo tempo" @click="ordem = 'paralela'" />
          <UButton :color="ordem === 'sequencial' ? 'primary' : 'neutral'" :variant="ordem === 'sequencial' ? 'soft' : 'outline'" label="Um depois do outro" @click="ordem = 'sequencial'" />
        </UFieldGroup>
        <p class="text-sm text-muted">{{ ordem === 'sequencial' ? 'Cada pessoa só recebe o convite depois que a anterior assinar.' : 'Todos recebem o convite agora.' }}</p>
        <UButton v-if="sessao?.usuario?.email" label="Incluir eu mesmo" icon="i-lucide-user-plus" color="neutral" variant="ghost" size="sm" class="ml-auto" @click="incluirEu" />
      </div>
      <div class="space-y-2">
        <div v-for="(s, i) in signatarios" :key="i" class="grid items-start gap-2 rounded-lg border border-default bg-default p-3 sm:grid-cols-[auto_1fr_1fr_11rem_12rem_auto]">
          <span class="mt-2 flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white" :style="{ background: cor(i) }">{{ i + 1 }}</span>
          <UInput v-model="s.nome" placeholder="Nome completo" :color="s.nome && s.nome.trim().length < 3 ? 'error' : undefined" />
          <UInput v-model="s.email" type="email" placeholder="email@exemplo.com.br" :color="s.email && !RE_EMAIL.test(s.email.trim()) ? 'error' : undefined" />
          <UInput
            :model-value="s.cpf"
            placeholder="CPF ou CNPJ (opcional)"
            inputmode="numeric"
            :color="!documentoValido(s.cpf) ? 'error' : undefined"
            @update:model-value="v => (s.cpf = mascaraDocumento(String(v ?? '')))"
          />
          <USelect
            :model-value="s.papel || SEM_PAPEL"
            :items="OPCOES_PAPEL"
            :class="!s.papel && 'text-muted'"
            @update:model-value="v => (s.papel = v === SEM_PAPEL ? '' : String(v))"
          />
          <div class="flex items-center">
            <template v-if="ordem === 'sequencial'">
              <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" :disabled="i === 0" aria-label="Subir" @click="mover(i, -1)" />
              <UButton icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="sm" :disabled="i === signatarios.length - 1" aria-label="Descer" @click="mover(i, 1)" />
            </template>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Tirar" @click="removerSignatario(i)" />
          </div>
        </div>
      </div>
      <UButton label="Adicionar pessoa" icon="i-lucide-plus" color="neutral" variant="outline" @click="signatarios.push({ nome: '', email: '', cpf: '', papel: '' })" />
      <p class="text-xs text-muted">
        Quem assina pode ser pessoa física (CPF) ou empresa (CNPJ). O papel é como a pessoa aparece na folha de assinaturas;
        na folha o CPF sai mascarado e o CNPJ sai inteiro.
      </p>
      <UAlert
        v-if="testemunhas === 1"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        description="Há uma testemunha. Para o contrato valer como título executivo, a lei pede duas (CPC, art. 784, III). Se não for o caso, pode seguir."
      />
    </section>

    <!-- 3. campos -->
    <section v-else-if="passo === 2" class="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside class="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase text-muted">Quem</p>
          <div class="space-y-1">
            <button
              v-for="(s, i) in signatarios"
              :key="i"
              type="button"
              class="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm"
              :class="quem === i ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'"
              @click="quem = i"
            >
              <span class="size-3 shrink-0 rounded-full" :style="{ background: cor(i) }" />
              <span class="min-w-0 flex-1 truncate">{{ s.nome }}</span>
              <span class="text-xs text-muted">{{ campos.filter(c => c.signatario === i).length }}</span>
            </button>
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs font-semibold uppercase text-muted">Tipo de campo</p>
          <div class="grid grid-cols-2 gap-1">
            <UButton
              v-for="t in TIPOS"
              :key="t.valor"
              :label="t.rotulo"
              :icon="t.icone"
              size="sm"
              :color="tipoCampo === t.valor ? 'primary' : 'neutral'"
              :variant="tipoCampo === t.valor ? 'soft' : 'outline'"
              @click="tipoCampo = t.valor"
            />
          </div>
        </div>
        <p class="text-xs text-muted">Clique no PDF para colocar o campo. Arraste para mover; o canto inferior direito muda o tamanho.</p>
        <UAlert
          v-if="semAssinatura.length"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :description="`Sem campo de assinatura: ${semAssinatura.map(x => x.s.nome).join(', ')}. Tudo bem — a assinatura aparece na folha de assinaturas, no final do PDF.`"
        />
      </aside>
      <div class="rounded-xl bg-elevated/60 p-4">
        <VisualizadorPdf v-if="conteudo" :fonte="conteudo" :largura-max="820">
          <template #pagina="{ numero, largura, altura, escala }">
            <div class="absolute inset-0 cursor-crosshair" @click="adicionarCampo($event, numero, largura, altura, escala)">
              <div
                v-for="c in campos.filter(c => c.pagina === numero)"
                :key="c.id"
                data-campo
                class="group absolute cursor-move touch-none select-none rounded-sm border-2 text-[10px] font-medium leading-tight"
                :style="{
                  left: `${c.x * escala}px`,
                  top: `${c.topo * escala}px`,
                  width: `${c.largura * escala}px`,
                  height: `${c.altura * escala}px`,
                  borderColor: cor(c.signatario),
                  background: `${cor(c.signatario)}22`,
                  color: cor(c.signatario)
                }"
                @pointerdown="iniciarArraste($event, c, 'mover', escala, largura, altura)"
              >
                <span class="block truncate px-1 pt-0.5">{{ TIPOS.find(t => t.valor === c.tipo)?.rotulo }} · {{ signatarios[c.signatario]?.nome.split(' ')[0] }}</span>
                <button
                  type="button"
                  class="absolute -right-2 -top-2 hidden size-4 items-center justify-center rounded-full bg-error text-white group-hover:flex"
                  aria-label="Remover campo"
                  @pointerdown.stop
                  @click.stop="removerCampo(c.id)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
                <span
                  class="absolute bottom-0 right-0 size-2.5 cursor-se-resize"
                  :style="{ background: cor(c.signatario) }"
                  @pointerdown="iniciarArraste($event, c, 'tamanho', escala, largura, altura)"
                />
              </div>
            </div>
          </template>
        </VisualizadorPdf>
      </div>
    </section>

    <!-- 4. envio -->
    <section v-else class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4">
        <UFormField label="Prazo (opcional)" help="Lembretes a cada 3 dias úteis a quem está com a vez, até 3.">
          <UInput v-model="prazo" type="date" :min="dataSP()" class="w-full" />
        </UFormField>
        <div class="rounded-lg border border-default bg-default p-4">
          <USwitch v-model="selo" :disabled="!opcoes.certificados.length" label="Assinar como Gaulke (selo digital)" :description="opcoes.certificados.length ? 'Depois que todos assinarem, o PDF final recebe o selo PAdES com o certificado A1 da Gaulke.' : 'Nenhum certificado válido cadastrado (Configurações → Certificado digital).'" />
          <USelect
            v-if="selo && opcoes.certificados.length > 1"
            v-model="certificadoId"
            :items="opcoes.certificados.map(c => ({ label: `${c.nome} — vence ${formatarData(c.validoAte)}`, value: c.id }))"
            class="mt-3 w-full"
          />
        </div>
      </div>
      <div class="space-y-4">
        <UFormField label="Sai por (canal)">
          <USelect v-if="itensConta.length" v-model="contaId" :items="itensConta" class="w-full" />
        </UFormField>
        <USwitch v-if="meuEmail" v-model="respostasParaMim" :label="`Respostas para mim (${meuEmail})`" description="Desligado: vão para o endereço do canal." />
      </div>
    </section>

    <div v-if="passo >= 0" class="flex items-center justify-between border-t border-default pt-4">
      <UButton v-if="passo > 0" label="Voltar" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="passo--" />
      <span v-else />
      <UButton v-if="passo < 3" label="Continuar" trailing-icon="i-lucide-arrow-right" :disabled="!podeAvancar" @click="passo++" />
      <UButton v-else label="Revisar e enviar" icon="i-lucide-send" :disabled="!podeAvancar" @click="conferi = false; confirmando = true" />
    </div>

    <UModal v-model:open="confirmando" title="Conferir antes de enviar" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt class="text-muted">Documento</dt>
          <dd><strong>{{ titulo }}</strong> <span class="text-muted">· {{ enviado?.nome }} · {{ enviado?.paginas.length }} pág.</span></dd>
          <dt class="text-muted">Quem assina</dt>
          <dd>
            <ol class="list-decimal pl-4">
              <li v-for="(s, i) in signatarios" :key="i">{{ s.nome }} <span class="text-muted">· {{ s.email }}</span></li>
            </ol>
          </dd>
          <dt class="text-muted">Ordem</dt>
          <dd>{{ ordem === 'sequencial' ? 'Um depois do outro' : 'Todos ao mesmo tempo' }}</dd>
          <dt class="text-muted">Campos no PDF</dt>
          <dd>{{ campos.length || 'nenhum (só a folha de assinaturas)' }}</dd>
          <dt class="text-muted">Selo da Gaulke</dt>
          <dd>{{ selo ? opcoes.certificados.find(c => c.id === certificadoId)?.nome : 'não' }}</dd>
          <dt class="text-muted">Prazo</dt>
          <dd>{{ prazo ? formatarPrazo(prazo) : 'sem prazo' }}</dd>
        </dl>
        <UCheckbox v-model="conferi" class="mt-6" label="Conferi o documento, as pessoas e os e-mails." />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Voltar" color="neutral" variant="ghost" @click="confirmando = false" />
          <UButton label="Enviar para assinatura" icon="i-lucide-send" :disabled="!conferi" :loading="criando" @click="enviar" />
        </div>
      </template>
    </UModal>
  </div>
</template>
