<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Configurações gerais — só administradores (o servidor confere em cada rota).
 *
 * Contas de envio:
 * A regra que dá forma à tela: só salva se a conexão funcionar. O botão de
 * salvar fica bloqueado até o teste passar, e o servidor repete a checagem —
 * a trava da tela é conveniência, a do servidor é a que vale.
 */
definePageMeta({ layout: 'admin', middleware: 'admin', papel: 'admin' })
useHead({ title: 'Configurações — Gaulke Comunica' })

const toast = useToast()
const { data, refresh, pending } = await useFetch<RespostaContas>(api('/api/admin/contas'))

const aberto = ref(false)
const editandoId = ref<number | null>(null)
const salvando = ref(false)
const testando = ref(false)
const excluindoId = ref<number | null>(null)

/** Resultado do último teste do formulário; enquanto for null, salvar fica travado. */
const teste = ref<RespostaTesteConta | null>(null)

/**
 * O servidor é o mesmo para quase todos os canais: fica recolhido em
 * "Avançado" e o canal novo só pede usuário, senha e remetente.
 */
const mostrarAvancado = ref(false)

const form = reactive({
  nome: '',
  host: '',
  port: 587,
  secure: false,
  requireTls: true,
  rejectUnauthorized: true,
  usuario: '',
  senha: '',
  remetente: '',
  responderPara: '',
  padrao: false,
  // caixa de entrada (somente leitura) e chamados no painel
  monitorarCaixa: false,
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  criarTickets: false,
  diasSemConfirmacao: 3
})

/**
 * Qualquer alteração invalida o teste anterior: testar com uma senha e salvar
 * com outra seria pior do que não testar.
 */
watch(
  () => ({ ...form }),
  () => { teste.value = null },
  { deep: true }
)

const podeTestar = computed(() =>
  Boolean(form.host && form.usuario && form.remetente && (form.senha || editandoId.value))
)
const podeSalvar = computed(() => Boolean(form.nome && teste.value?.ok))

function abrirNova() {
  editandoId.value = null
  Object.assign(form, {
    nome: '',
    // o servidor costuma ser o mesmo para todos os canais: vem do padrão
    host: data.value?.sugestao.host || '',
    port: data.value?.sugestao.port || 587,
    secure: data.value?.sugestao.secure ?? false,
    requireTls: data.value?.sugestao.requireTls ?? true,
    rejectUnauthorized: data.value?.sugestao.rejectUnauthorized ?? true,
    usuario: '',
    senha: '',
    remetente: '',
    responderPara: '',
    padrao: (data.value?.contas.length ?? 0) === 0,
    monitorarCaixa: false,
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    criarTickets: false,
    diasSemConfirmacao: 3
  })
  teste.value = null
  // sem servidor padrão, não há o que esconder
  mostrarAvancado.value = !data.value?.sugestao.host
  aberto.value = true
}

function abrirEdicao(c: ContaEnvio) {
  editandoId.value = c.id
  Object.assign(form, {
    nome: c.nome,
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTls: c.requireTls,
    rejectUnauthorized: c.rejectUnauthorized,
    usuario: c.usuario,
    // vazio significa "manter a senha atual"; o servidor entende assim
    senha: '',
    remetente: c.remetente,
    responderPara: c.responderPara || '',
    padrao: c.padrao,
    monitorarCaixa: c.monitorarCaixa,
    imapHost: c.imapHost || '',
    imapPort: c.imapPort,
    imapSecure: c.imapSecure,
    criarTickets: c.criarTickets,
    diasSemConfirmacao: c.diasSemConfirmacao
  })
  teste.value = null
  testeImap.value = null
  // canal num servidor diferente do padrão: mostra o porquê
  mostrarAvancado.value = c.host !== data.value?.sugestao.host || c.port !== data.value?.sugestao.port
  aberto.value = true
}

function corpo() {
  return {
    ...form,
    port: Number(form.port),
    senha: form.senha || undefined,
    responderPara: form.responderPara || undefined,
    imapHost: form.imapHost || null,
    imapPort: Number(form.imapPort),
    diasSemConfirmacao: Number(form.diasSemConfirmacao)
  }
}

async function testar() {
  testando.value = true
  try {
    teste.value = await $fetch<RespostaTesteConta>(api('/api/admin/contas/testar'), {
      method: 'POST',
      body: { ...corpo(), id: editandoId.value ?? undefined }
    })
  } catch (e: any) {
    teste.value = { ok: false, mensagem: e?.statusMessage || 'Falha ao testar' }
  } finally {
    testando.value = false
  }
}

async function salvar() {
  salvando.value = true
  try {
    if (editandoId.value) {
      await $fetch(api(`/api/admin/contas/${editandoId.value}`), { method: 'PUT', body: corpo() })
    } else {
      await $fetch(api('/api/admin/contas'), { method: 'POST', body: corpo() })
    }
    toast.add({ title: 'Canal salvo', color: 'success' })
    aberto.value = false
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível salvar', description: e?.statusMessage, color: 'error' })
  } finally {
    salvando.value = false
  }
}

async function alternarAtiva(c: ContaEnvio) {
  try {
    await $fetch(api(`/api/admin/contas/${c.id}/ativa`), {
      method: 'PATCH',
      body: { ativa: !c.ativa }
    })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível alterar', description: e?.statusMessage, color: 'error' })
  }
}

async function excluir(c: ContaEnvio) {
  if (!confirm(`Excluir o canal "${c.nome}"?\n\nOs lotes já enviados por ele continuam no relatório.`)) return
  excluindoId.value = c.id
  try {
    await $fetch(api(`/api/admin/contas/${c.id}`), { method: 'DELETE' })
    toast.add({ title: 'Canal excluído', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.statusMessage, color: 'error' })
  } finally {
    excluindoId.value = null
  }
}

/* ---------- caixa de entrada (IMAP) ---------- */
const testeImap = ref<{ ok: boolean; mensagem: string } | null>(null)
const testandoImap = ref(false)
async function testarLeitura() {
  testandoImap.value = true
  try {
    testeImap.value = await $fetch<{ ok: boolean; mensagem: string }>(api('/api/admin/contas/testar-imap'), {
      method: 'POST',
      body: { ...corpo(), id: editandoId.value ?? undefined }
    })
  } catch (e: any) {
    testeImap.value = { ok: false, mensagem: e?.statusMessage || 'Falha ao testar a leitura' }
  } finally {
    testandoImap.value = false
  }
}

const lendoId = ref<number | null>(null)
async function lerAgora(c: ContaEnvio) {
  lendoId.value = c.id
  try {
    const r = await $fetch<ResultadoLeituraCaixa>(api(`/api/admin/contas/${c.id}/ler-caixa`), { method: 'POST' })
    toast.add({
      title: r.ok ? 'Caixa lida' : 'A leitura falhou',
      description: r.mensagem,
      color: r.ok ? 'success' : 'error',
      icon: 'i-lucide-inbox'
    })
    await refresh()
  } finally {
    lendoId.value = null
  }
}

/** Testa uma conta já salva, sem abrir o formulário. */
const testandoId = ref<number | null>(null)
async function testarSalva(c: ContaEnvio) {
  testandoId.value = c.id
  try {
    const r = await $fetch<RespostaTesteConta>(api('/api/admin/contas/testar'), {
      method: 'POST',
      body: {
        id: c.id,
        nome: c.nome,
        host: c.host,
        port: c.port,
        secure: c.secure,
        requireTls: c.requireTls,
        rejectUnauthorized: c.rejectUnauthorized,
        usuario: c.usuario,
        remetente: c.remetente,
        responderPara: c.responderPara || undefined,
        padrao: c.padrao,
        monitorarCaixa: c.monitorarCaixa,
        imapHost: c.imapHost,
        imapPort: c.imapPort,
        imapSecure: c.imapSecure,
        criarTickets: c.criarTickets,
        diasSemConfirmacao: c.diasSemConfirmacao
      }
    })
    toast.add({
      title: r.ok ? 'Conexão OK' : 'Conexão falhou',
      description: r.mensagem + (r.dns?.avisos.length ? ` · DNS: ${r.dns.avisos.length} aviso(s) — abra o canal e teste para ver.` : ''),
      color: r.ok ? (r.dns?.avisos.length ? 'warning' : 'success') : 'error'
    })
  } finally {
    testandoId.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Configurações</h1>
        <p class="text-sm text-muted">Canais de saída (caixas de e-mail usadas nos envios) e acesso. Somente administradores.</p>
      </div>
      <UButton
        label="Novo canal"
        icon="i-lucide-plus"
        :disabled="!data?.chave.configurada"
        @click="abrirNova"
      />
    </div>

    <!-- sem a chave no .env não há onde guardar senha com segurança -->
    <UAlert
      v-if="data && !data.chave.configurada"
      color="warning"
      variant="subtle"
      icon="i-lucide-key-round"
      title="Falta a chave que protege as senhas"
    >
      <template #description>
        <p>
          As senhas dos canais são guardadas cifradas, e a chave fica no
          <code>.env</code>. Sem ela não é possível cadastrar nenhum canal —
          enquanto isso, os envios continuam usando o SMTP do <code>.env</code>.
        </p>
        <p class="mt-2">Gere uma e reinicie a aplicação:</p>
        <pre class="mt-1 overflow-x-auto rounded bg-elevated p-2 text-xs">SMTP_CRYPTO_KEY=$(openssl rand -hex 32)</pre>
      </template>
    </UAlert>

    <UCard v-else-if="!data?.contas.length && !pending">
      <div class="space-y-3 py-10 text-center">
        <UIcon name="i-lucide-mail-plus" class="mx-auto size-10 text-muted" />
        <p class="font-medium">Nenhum canal de saída cadastrado</p>
        <p class="text-sm text-muted">
          Os envios estão usando o SMTP do <code>.env</code>. Cadastre os canais
          aqui para poder escolher, a cada lote, de qual caixa o e-mail sai.
        </p>
        <UButton label="Cadastrar o primeiro canal" icon="i-lucide-plus" @click="abrirNova" />
      </div>
    </UCard>

    <div v-else class="grid gap-4">
      <UCard v-for="c in data?.contas" :key="c.id">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{{ c.nome }}</p>
              <UBadge v-if="c.padrao" color="primary" variant="subtle" label="padrão" />
              <UBadge v-if="!c.ativa" color="neutral" variant="subtle" label="desativado" />
              <UBadge
                v-if="c.ultimoTesteOk === false"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                label="último teste falhou"
              />
            </div>
            <p class="mt-1 truncate text-sm text-muted">{{ c.remetente }}</p>
            <p class="mt-1 text-xs text-muted">
              {{ c.host }}:{{ c.port }} · usuário {{ c.usuario }}
              <template v-if="c.responderPara"> · responder para {{ c.responderPara }}</template>
            </p>
            <p v-if="c.ultimoTesteEm" class="mt-1 text-xs text-muted">
              Último teste em {{ dataHora(c.ultimoTesteEm) }} —
              <span :class="c.ultimoTesteOk ? 'text-success' : 'text-error'">{{ c.ultimoTesteMsg }}</span>
            </p>
            <div v-if="c.monitorarCaixa || c.criarTickets" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <UBadge v-if="c.monitorarCaixa" color="info" variant="subtle" size="sm" icon="i-lucide-inbox" label="lê a caixa" />
              <UBadge v-if="c.criarTickets" color="primary" variant="subtle" size="sm" icon="i-lucide-ticket" :label="`chamados no painel · ${c.diasSemConfirmacao} dia(s)`" />
              <span v-if="c.monitorarCaixa && c.imapUltimaLeituraEm && !c.imapUltimoErro" class="text-muted">
                Última leitura em {{ dataHora(c.imapUltimaLeituraEm) }}
              </span>
              <span v-if="c.imapUltimoErro" class="text-error">
                Leitura falhou em {{ dataHora(c.imapUltimoErroEm) }}: {{ c.imapUltimoErro }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <UButton
              label="Testar"
              icon="i-lucide-plug-zap"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="testandoId === c.id"
              @click="testarSalva(c)"
            />
            <UButton
              v-if="c.monitorarCaixa"
              label="Ler agora"
              icon="i-lucide-inbox"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="lendoId === c.id"
              @click="lerAgora(c)"
            />
            <UButton
              label="Editar"
              icon="i-lucide-pencil"
              color="neutral"
              variant="outline"
              size="sm"
              @click="abrirEdicao(c)"
            />
            <UButton
              :label="c.ativa ? 'Desativar' : 'Ativar'"
              :icon="c.ativa ? 'i-lucide-power-off' : 'i-lucide-power'"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="alternarAtiva(c)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              :loading="excluindoId === c.id"
              @click="excluir(c)"
            />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Formulário -->
    <UModal v-model:open="aberto" :title="editandoId ? 'Editar canal de saída' : 'Novo canal de saída'">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nome" required help="Como este canal aparece para quem envia (ex.: Notifica, Fiscal, DP).">
            <UInput v-model="form.nome" placeholder="Financeiro" class="w-full" />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Usuário" required>
              <UInput v-model="form.usuario" autocomplete="off" class="w-full" />
            </UFormField>
            <UFormField
              label="Senha"
              :required="!editandoId"
              :help="editandoId ? 'Deixe em branco para manter a senha atual.' : undefined"
            >
              <UInput
                v-model="form.senha"
                type="password"
                autocomplete="new-password"
                :placeholder="editandoId ? '••••••••' : ''"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Remetente" required help="Formato: Nome <email@dominio.com.br>">
            <UInput v-model="form.remetente" class="w-full" />
          </UFormField>

          <UFormField label="Responder para (sugerido)" help="Opcional. Vazio usa o próprio remetente. Quem envia pode escolher outro endereço a cada lote.">
            <UInput v-model="form.responderPara" class="w-full" />
          </UFormField>

          <UCheckbox v-model="form.padrao" label="Usar como canal padrão nos envios" />

          <!-- Caixa de entrada: devoluções, recibos e respostas voltam para cá -->
          <div class="space-y-3 rounded-lg border border-default p-3">
            <USwitch
              v-model="form.monitorarCaixa"
              label="Monitorar a caixa de entrada"
              description="Lê a caixa deste canal a cada 2 minutos para detectar devoluções, recibos de leitura e respostas de clientes. Só lê: não marca como lida, não move e não apaga nada."
            />
            <template v-if="form.monitorarCaixa">
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="Servidor IMAP" class="sm:col-span-2" help="Vazio = o mesmo servidor do SMTP.">
                  <UInput v-model="form.imapHost" :placeholder="form.host" class="w-full" />
                </UFormField>
                <UFormField label="Porta">
                  <UInput v-model.number="form.imapPort" type="number" class="w-full" />
                </UFormField>
              </div>
              <UCheckbox v-model="form.imapSecure" label="Conexão SSL direta (porta 993)" help="Desmarque para a porta 143 com STARTTLS." />
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  label="Testar leitura"
                  icon="i-lucide-inbox"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :loading="testandoImap"
                  :disabled="!podeTestar"
                  @click="testarLeitura"
                />
                <span v-if="testeImap" class="text-xs" :class="testeImap.ok ? 'text-success' : 'text-error'">{{ testeImap.mensagem }}</span>
              </div>
              <p class="text-xs text-muted">Usa o mesmo usuário e senha do canal.</p>
            </template>

            <USeparator />

            <USwitch
              v-model="form.criarTickets"
              label="Abrir chamados no painel"
              description="Quando um cliente responder a um envio, e quando alguém não confirmar a leitura em N dias, abre um chamado no painel em nome de quem criou o envio. Quem envia pode desligar por lote."
            />
            <UFormField v-if="form.criarTickets" label="Dias sem confirmação para abrir chamado" class="w-72">
              <UInput v-model.number="form.diasSemConfirmacao" type="number" min="1" max="60" class="w-full" />
            </UFormField>
            <UAlert
              v-if="form.criarTickets && !form.monitorarCaixa"
              color="warning"
              variant="subtle"
              icon="i-lucide-info"
              description="Sem monitorar a caixa, só o chamado de “sem confirmação” funciona: as respostas dos clientes não são lidas."
            />
          </div>

          <!-- Servidor: quase sempre o padrão, então fica recolhido -->
          <div class="rounded-lg border border-default">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
              @click="mostrarAvancado = !mostrarAvancado"
            >
              <span>
                <span class="font-medium">Servidor</span>
                <span class="text-muted"> · {{ form.host || 'não definido' }}:{{ form.port }}</span>
                <UBadge
                  v-if="form.host === data?.sugestao.host && form.port === data?.sugestao.port"
                  class="ml-1"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  label="padrão"
                />
              </span>
              <UIcon :name="mostrarAvancado ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4" />
            </button>
            <div v-if="mostrarAvancado" class="space-y-3 border-t border-default p-3">
              <div class="grid gap-4 sm:grid-cols-3">
                <UFormField label="Servidor SMTP" required class="sm:col-span-2">
                  <UInput v-model="form.host" class="w-full" />
                </UFormField>
                <UFormField label="Porta" required>
                  <UInput v-model.number="form.port" type="number" class="w-full" />
                </UFormField>
              </div>
              <UCheckbox v-model="form.secure" label="Conexão SSL direta (porta 465)" />
              <UCheckbox v-model="form.requireTls" label="Exigir STARTTLS (porta 587)" />
              <UCheckbox
                v-model="form.rejectUnauthorized"
                label="Validar o certificado do servidor"
                help="Desmarque só para servidor interno com certificado próprio."
              />
            </div>
          </div>

          <UAlert
            v-if="teste"
            :color="teste.ok ? 'success' : 'error'"
            variant="subtle"
            :icon="teste.ok ? 'i-lucide-check' : 'i-lucide-x'"
            :title="teste.ok ? 'Conexão bem-sucedida' : 'A conexão falhou'"
            :description="teste.mensagem"
          />
          <!-- DNS do domínio: só aviso, mas é o que decide cair no spam -->
          <div v-if="teste?.dns" class="space-y-2 rounded-lg border border-default p-3 text-sm">
            <p class="font-medium">Entregabilidade de {{ teste.dns.dominio }}</p>
            <div class="flex flex-wrap gap-2">
              <UBadge :color="teste.dns.spf.ok ? 'success' : 'warning'" variant="subtle" :icon="teste.dns.spf.ok ? 'i-lucide-check' : 'i-lucide-alert-triangle'" label="SPF" />
              <UBadge :color="teste.dns.dkim.ok ? 'success' : 'neutral'" variant="subtle" :icon="teste.dns.dkim.ok ? 'i-lucide-check' : 'i-lucide-help-circle'" :label="teste.dns.dkim.ok ? `DKIM (${teste.dns.dkim.seletor})` : 'DKIM ?'" />
              <UBadge :color="teste.dns.dmarc.ok ? 'success' : 'warning'" variant="subtle" :icon="teste.dns.dmarc.ok ? 'i-lucide-check' : 'i-lucide-alert-triangle'" label="DMARC" />
            </div>
            <ul v-if="teste.dns.avisos.length" class="list-disc space-y-1 pl-5 text-xs text-muted">
              <li v-for="a in teste.dns.avisos" :key="a">{{ a }}</li>
            </ul>
          </div>
          <p v-if="!teste" class="text-xs text-muted">
            Teste a conexão para liberar o salvamento — um canal que não autentica
            transformaria o próximo envio numa fila de falhas.
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="aberto = false" />
          <UButton
            label="Testar conexão"
            icon="i-lucide-plug-zap"
            color="neutral"
            variant="outline"
            :loading="testando"
            :disabled="!podeTestar"
            @click="testar"
          />
          <UButton
            label="Salvar"
            icon="i-lucide-save"
            :loading="salvando"
            :disabled="!podeSalvar"
            @click="salvar"
          />
        </div>
      </template>
    </UModal>

    <ConfigServidorSmtp @salvo="refresh()" />
    <ConfigCertificados />
    <ConfigPainel />
    <ConfigWebhooks />
    <ConfigRetencao />
    <ConfigAcesso />
  </div>
</template>
