<script setup lang="ts">
/**
 * Certificado digital A1 da Gaulke (só admin). Usado no selo "Assinar como
 * Gaulke" das assinaturas.
 *
 * O .pfx é aberto no servidor com a senha, a chave privada fica CIFRADA no
 * banco e a senha é descartada na hora: não há arquivo no disco nem senha
 * guardada. "Testar a senha" confere sem gravar nada.
 */
const toast = useToast()
const { data: certs, refresh } = await useFetch<CertificadoCadastrado[]>(api('/api/admin/certificados'), { default: () => [] })

const aberto = ref(false)
const arquivo = ref<File | null>(null)
const senha = ref('')
const nome = ref('')
const verSenha = ref(false)
const testando = ref(false)
const salvando = ref(false)
const conferido = ref<ResumoCertificado | null>(null)
const erro = ref<string | null>(null)

function abrir() {
  arquivo.value = null
  senha.value = ''
  nome.value = ''
  conferido.value = null
  erro.value = null
  aberto.value = true
}
function escolher(e: Event) {
  arquivo.value = (e.target as HTMLInputElement).files?.[0] ?? null
  conferido.value = null
  erro.value = null
}
watch(senha, () => { conferido.value = null; erro.value = null })

function formulario() {
  const fd = new FormData()
  fd.append('arquivo', arquivo.value!)
  fd.append('senha', senha.value)
  if (nome.value.trim()) fd.append('nome', nome.value.trim())
  return fd
}

async function testarSenha() {
  testando.value = true
  erro.value = null
  try {
    const r = await $fetch<{ certificado: ResumoCertificado }>(api('/api/admin/certificados/testar'), { method: 'POST', body: formulario() })
    conferido.value = r.certificado
    if (!nome.value.trim()) nome.value = `A1 ${r.certificado.titular.split(' ').slice(0, 2).join(' ')} ${r.certificado.validoAte.slice(0, 4)}`
  } catch (e: any) {
    conferido.value = null
    erro.value = e?.data?.statusMessage || e?.statusMessage || 'Não foi possível abrir o certificado'
  } finally {
    testando.value = false
  }
}

async function salvar() {
  salvando.value = true
  try {
    await $fetch(api('/api/admin/certificados'), { method: 'POST', body: formulario() })
    senha.value = ''
    aberto.value = false
    toast.add({ title: 'Certificado cadastrado', description: 'A senha foi descartada; a chave ficou cifrada.', color: 'success', icon: 'i-lucide-shield-check' })
    await refresh()
  } catch (e: any) {
    erro.value = e?.data?.statusMessage || e?.statusMessage || 'Não foi possível cadastrar'
  } finally {
    salvando.value = false
  }
}

const assinandoTeste = ref<number | null>(null)
async function pdfDeTeste(c: CertificadoCadastrado) {
  assinandoTeste.value = c.id
  try {
    const blob = await $fetch<Blob>(api(`/api/admin/certificados/${c.id}/testar`), { method: 'POST', responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `teste-assinatura-${dataSP()}.pdf`
    a.click()
    URL.revokeObjectURL(url)
    toast.add({ title: 'PDF de teste assinado', description: 'Abra no Adobe Reader ou em validar.iti.gov.br.', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Falha ao assinar', description: e?.data?.statusMessage || e?.statusMessage, color: 'error' })
  } finally {
    assinandoTeste.value = null
    await refresh()
  }
}

async function tornarPadrao(c: CertificadoCadastrado) {
  await $fetch(api(`/api/admin/certificados/${c.id}`), { method: 'PATCH', body: { padrao: true } })
  await refresh()
}

const removendo = ref<CertificadoCadastrado | null>(null)
const confirmaRemocao = ref('')
async function remover() {
  if (!removendo.value) return
  try {
    await $fetch(api(`/api/admin/certificados/${removendo.value.id}`), { method: 'DELETE' })
    toast.add({ title: 'Certificado removido', description: 'A chave privada foi apagada.', color: 'success' })
    removendo.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Não foi possível remover', description: e?.data?.statusMessage, color: 'error' })
  }
}

function documento(c: ResumoCertificado) {
  const d = c.documento || ''
  if (d.length === 14) return `CNPJ ${d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}`
  if (d.length === 11) return `CPF ${d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}`
  return 'documento não identificado'
}
function corValidade(dias: number) {
  return dias < 0 ? 'error' : dias <= 30 ? 'warning' : 'success'
}
function textoValidade(c: ResumoCertificado) {
  if (c.diasParaVencer < 0) return `Venceu em ${formatarData(c.validoAte)}`
  if (c.diasParaVencer === 0) return 'Vence hoje'
  return `Vence em ${formatarData(c.validoAte)} (${c.diasParaVencer} dia${c.diasParaVencer === 1 ? '' : 's'})`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="font-semibold">Certificado digital (A1)</h2>
          <p class="text-sm text-muted">Usado no selo “Assinar como Gaulke” dos documentos assinados.</p>
        </div>
        <UButton label="Cadastrar certificado" icon="i-lucide-shield-plus" @click="abrir" />
      </div>
    </template>

    <div v-if="!certs.length" class="py-6 text-center text-sm text-muted">
      Nenhum certificado cadastrado. Sem ele, as assinaturas funcionam, mas sem o selo da Gaulke.
    </div>
    <ul v-else class="divide-y divide-default">
      <li v-for="c in certs" :key="c.id" class="flex flex-wrap items-start gap-4 py-4 first:pt-0 last:pb-0">
        <UIcon name="i-lucide-badge-check" class="mt-0.5 size-6 shrink-0" :class="c.diasParaVencer < 0 ? 'text-error' : 'text-primary'" />
        <div class="min-w-0 flex-1 space-y-1">
          <p class="font-medium">
            {{ c.nome }}
            <UBadge v-if="c.padrao" color="primary" variant="subtle" size="sm" class="ml-1">padrão</UBadge>
          </p>
          <p class="text-sm">{{ c.titular }} · {{ documento(c) }}</p>
          <p v-if="c.responsavel" class="text-xs text-muted">Responsável: {{ c.responsavel }}</p>
          <p class="text-xs text-muted">Emitido por {{ c.emissor || '—' }} · série {{ c.serial }}</p>
          <div class="flex flex-wrap gap-2 pt-1">
            <UBadge :color="corValidade(c.diasParaVencer)" variant="subtle" icon="i-lucide-calendar-clock">{{ textoValidade(c) }}</UBadge>
            <UBadge :color="c.icpBrasil ? 'success' : 'warning'" variant="subtle" :icon="c.icpBrasil ? 'i-lucide-link' : 'i-lucide-unlink'">
              {{ c.icpBrasil ? 'Cadeia ICP-Brasil' : 'Cadeia fora da ICP-Brasil' }}
            </UBadge>
            <UBadge v-if="c.ultimoTesteEm" :color="c.ultimoTesteOk ? 'success' : 'error'" variant="outline">
              Último teste {{ c.ultimoTesteOk ? 'ok' : 'falhou' }} em {{ formatarDataHora(c.ultimoTesteEm) }}
            </UBadge>
          </div>
          <p class="pt-1 text-xs text-muted">Cadastrado por {{ c.criadoPorNome || '—' }} em {{ formatarDataHora(c.criadoEm) }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton label="Assinar PDF de teste" icon="i-lucide-file-signature" color="neutral" variant="outline" size="sm" :loading="assinandoTeste === c.id" @click="pdfDeTeste(c)" />
          <UButton v-if="!c.padrao" label="Tornar padrão" color="neutral" variant="ghost" size="sm" @click="tornarPadrao(c)" />
          <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="sm" aria-label="Remover" @click="removendo = c; confirmaRemocao = ''" />
        </div>
      </li>
    </ul>

    <!-- cadastro -->
    <UModal v-model:open="aberto" title="Cadastrar certificado A1" description="Arquivo .pfx ou .p12 e a senha. A senha só é usada para abrir o arquivo agora e é descartada." :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Arquivo do certificado" required>
            <input type="file" accept=".pfx,.p12,application/x-pkcs12" class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary" @change="escolher" />
          </UFormField>
          <UFormField label="Senha do certificado" required>
            <UInput v-model="senha" :type="verSenha ? 'text' : 'password'" autocomplete="off" class="w-full" @keydown.enter="arquivo && senha && testarSenha()">
              <template #trailing>
                <UButton :icon="verSenha ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="link" size="sm" :aria-label="verSenha ? 'Esconder' : 'Mostrar'" @click="verSenha = !verSenha" />
              </template>
            </UInput>
          </UFormField>
          <UButton label="Testar a senha" icon="i-lucide-key-round" color="neutral" variant="outline" :disabled="!arquivo || !senha" :loading="testando" @click="testarSenha" />

          <UAlert v-if="erro" color="error" variant="subtle" icon="i-lucide-circle-x" :title="erro" />
          <div v-if="conferido" class="space-y-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
            <p class="flex items-center gap-2 font-medium text-success"><UIcon name="i-lucide-circle-check" class="size-5" />A senha confere</p>
            <p><strong>{{ conferido.titular }}</strong> · {{ documento(conferido) }}</p>
            <p v-if="conferido.responsavel" class="text-muted">Responsável: {{ conferido.responsavel }}</p>
            <p class="text-muted">Emissor: {{ conferido.emissor }}</p>
            <div class="flex flex-wrap gap-2">
              <UBadge :color="corValidade(conferido.diasParaVencer)" variant="subtle">{{ textoValidade(conferido) }}</UBadge>
              <UBadge :color="conferido.icpBrasil ? 'success' : 'warning'" variant="subtle">{{ conferido.icpBrasil ? 'Cadeia ICP-Brasil' : 'Cadeia fora da ICP-Brasil' }}</UBadge>
            </div>
            <details class="text-xs text-muted">
              <summary class="cursor-pointer">Cadeia de certificação ({{ conferido.cadeia.length }})</summary>
              <ol class="mt-1 list-decimal space-y-0.5 pl-5">
                <li v-for="(n, i) in conferido.cadeia" :key="i">{{ n.assunto }} <span class="opacity-70">— emitido por {{ n.emissor }}</span></li>
              </ol>
            </details>
            <UFormField label="Nome para identificar" class="pt-2">
              <UInput v-model="nome" class="w-full" />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="aberto = false" />
          <UButton
            label="Cadastrar"
            icon="i-lucide-shield-check"
            :disabled="!conferido || conferido.diasParaVencer < 0"
            :loading="salvando"
            @click="salvar"
          />
        </div>
      </template>
    </UModal>

    <!-- remoção -->
    <UModal :open="!!removendo" title="Remover o certificado?" @update:open="v => { if (!v) removendo = null }">
      <template #body>
        <div class="space-y-3 text-sm">
          <p>A chave privada de <strong>{{ removendo?.nome }}</strong> será apagada do sistema. Documentos já selados continuam válidos; novos não poderão usar este certificado.</p>
          <UFormField label="Digite REMOVER para confirmar">
            <UInput v-model="confirmaRemocao" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="removendo = null" />
          <UButton label="Remover" icon="i-lucide-trash-2" color="error" :disabled="confirmaRemocao !== 'REMOVER'" @click="remover" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
