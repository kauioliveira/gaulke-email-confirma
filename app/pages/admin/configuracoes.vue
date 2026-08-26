<script setup lang="ts">
import { dataHora } from '~/utils/formato'

/**
 * Contas de envio.
 *
 * A regra que dá forma à tela: só salva se a conexão funcionar. O botão de
 * salvar fica bloqueado até o teste passar, e o servidor repete a checagem —
 * a trava da tela é conveniência, a do servidor é a que vale.
 */
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Configurações — Gaulke Envios' })

const toast = useToast()
const { data, refresh, pending } = await useFetch<RespostaContas>(api('/api/admin/contas'))

const aberto = ref(false)
const editandoId = ref<number | null>(null)
const salvando = ref(false)
const testando = ref(false)
const excluindoId = ref<number | null>(null)

/** Resultado do último teste do formulário; enquanto for null, salvar fica travado. */
const teste = ref<{ ok: boolean; mensagem: string } | null>(null)

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
  padrao: false
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
    // o servidor costuma ser o mesmo para todas as contas, então já vem preenchido
    host: data.value?.sugestao.host || '',
    port: data.value?.sugestao.port || 587,
    secure: data.value?.sugestao.secure ?? false,
    requireTls: data.value?.sugestao.requireTls ?? true,
    rejectUnauthorized: true,
    usuario: '',
    senha: '',
    remetente: '',
    responderPara: '',
    padrao: (data.value?.contas.length ?? 0) === 0
  })
  teste.value = null
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
    padrao: c.padrao
  })
  teste.value = null
  aberto.value = true
}

function corpo() {
  return {
    ...form,
    port: Number(form.port),
    senha: form.senha || undefined,
    responderPara: form.responderPara || undefined
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
    toast.add({ title: 'Conta salva', color: 'success' })
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
  if (!confirm(`Excluir a conta "${c.nome}"?\n\nOs lotes já enviados por ela continuam no relatório.`)) return
  excluindoId.value = c.id
  try {
    await $fetch(api(`/api/admin/contas/${c.id}`), { method: 'DELETE' })
    toast.add({ title: 'Conta excluída', color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível excluir', description: e?.statusMessage, color: 'error' })
  } finally {
    excluindoId.value = null
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
        padrao: c.padrao
      }
    })
    toast.add({
      title: r.ok ? 'Conexão OK' : 'Conexão falhou',
      description: r.mensagem,
      color: r.ok ? 'success' : 'error'
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
        <p class="text-sm text-muted">Contas de e-mail usadas nos disparos.</p>
      </div>
      <UButton
        label="Nova conta"
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
          As senhas das contas são guardadas cifradas, e a chave fica no
          <code>.env</code>. Sem ela não é possível cadastrar nenhuma conta —
          enquanto isso, os envios continuam usando o SMTP do <code>.env</code>.
        </p>
        <p class="mt-2">Gere uma e reinicie a aplicação:</p>
        <pre class="mt-1 overflow-x-auto rounded bg-elevated p-2 text-xs">SMTP_CRYPTO_KEY=$(openssl rand -hex 32)</pre>
      </template>
    </UAlert>

    <UCard v-else-if="!data?.contas.length && !pending">
      <div class="space-y-3 py-10 text-center">
        <UIcon name="i-lucide-mail-plus" class="mx-auto size-10 text-muted" />
        <p class="font-medium">Nenhuma conta cadastrada</p>
        <p class="text-sm text-muted">
          Os envios estão usando o SMTP do <code>.env</code>. Cadastre as contas
          aqui para poder escolher, a cada lote, de qual caixa o e-mail sai.
        </p>
        <UButton label="Cadastrar a primeira conta" icon="i-lucide-plus" @click="abrirNova" />
      </div>
    </UCard>

    <div v-else class="grid gap-4">
      <UCard v-for="c in data?.contas" :key="c.id">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{{ c.nome }}</p>
              <UBadge v-if="c.padrao" color="primary" variant="subtle" label="padrão" />
              <UBadge v-if="!c.ativa" color="neutral" variant="subtle" label="desativada" />
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
    <UModal v-model:open="aberto" :title="editandoId ? 'Editar conta' : 'Nova conta de envio'">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nome" required help="Como esta conta aparece na hora de disparar.">
            <UInput v-model="form.nome" placeholder="Financeiro" class="w-full" />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField label="Servidor SMTP" required class="sm:col-span-2">
              <UInput v-model="form.host" class="w-full" />
            </UFormField>
            <UFormField label="Porta" required>
              <UInput v-model.number="form.port" type="number" class="w-full" />
            </UFormField>
          </div>

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

          <UFormField label="Responder para" help="Opcional. Vazio usa o próprio remetente.">
            <UInput v-model="form.responderPara" class="w-full" />
          </UFormField>

          <div class="space-y-2 rounded-lg border border-default p-3">
            <UCheckbox v-model="form.secure" label="Conexão SSL direta (porta 465)" />
            <UCheckbox v-model="form.requireTls" label="Exigir STARTTLS (porta 587)" />
            <UCheckbox
              v-model="form.rejectUnauthorized"
              label="Validar o certificado do servidor"
              help="Desmarque só para servidor interno com certificado próprio."
            />
            <UCheckbox v-model="form.padrao" label="Usar como conta padrão nos disparos" />
          </div>

          <UAlert
            v-if="teste"
            :color="teste.ok ? 'success' : 'error'"
            variant="subtle"
            :icon="teste.ok ? 'i-lucide-check' : 'i-lucide-x'"
            :title="teste.ok ? 'Conexão bem-sucedida' : 'A conexão falhou'"
            :description="teste.mensagem"
          />
          <p v-else class="text-xs text-muted">
            Teste a conexão para liberar o salvamento — uma conta que não autentica
            transformaria o próximo disparo numa fila de falhas.
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
  </div>
</template>
