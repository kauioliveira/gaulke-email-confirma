<script setup lang="ts">
/**
 * Validação pública de um documento assinado: pelo código da folha de
 * assinaturas ou pelo próprio PDF. O PDF NÃO sai do computador de quem valida:
 * o SHA-256 é calculado aqui no navegador e só o hash vai ao servidor.
 */
definePageMeta({ layout: false, colorMode: 'light' })
useHead({ title: 'Validar documento — Contábil Gaulke' })

const route = useRoute()
const codigo = ref(String(route.query.c || ''))
const resultado = ref<ValidacaoAssinatura | null>(null)
const naoEncontrado = ref(false)
const carregando = ref(false)
const arquivoNome = ref<string | null>(null)
const erro = ref<string | null>(null)
const calculando = ref(false)

async function consultar(q: { c?: string; hash?: string }) {
  carregando.value = true
  resultado.value = null
  naoEncontrado.value = false
  erro.value = null
  try {
    resultado.value = await $fetch<ValidacaoAssinatura>(api('/api/validar'), { query: q })
  } catch (e: any) {
    // 404 = nada com esse codigo/PDF; o resto (rede, limite) e problema, e nao "nao encontrado"
    if (e?.statusCode === 404 || e?.response?.status === 404) naoEncontrado.value = true
    else erro.value = e?.statusCode === 429 ? 'Muitas consultas seguidas. Aguarde um minuto e tente de novo.' : 'Não foi possível consultar agora. Tente de novo em instantes.'
  } finally {
    carregando.value = false
  }
}
function porCodigo() {
  arquivoNome.value = null
  if (codigo.value.trim()) consultar({ c: codigo.value.trim() })
}
async function porArquivo(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  arquivoNome.value = f.name
  resultado.value = null
  naoEncontrado.value = false
  erro.value = null
  calculando.value = true
  try {
    // sha256Hex funciona tambem fora de HTTPS (acesso pelo IP interno)
    const hash = await sha256Hex(await f.arrayBuffer())
    await consultar({ hash })
  } catch {
    erro.value = 'Não foi possível ler este arquivo.'
  } finally {
    calculando.value = false
  }
}
onMounted(() => { if (codigo.value) porCodigo() })
</script>

<template>
  <div class="flex min-h-screen flex-col bg-elevated/40">
    <main class="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-10">
      <div class="mb-8 flex flex-col items-center gap-3 text-center">
        <img :src="api('/brand/logo.png')" alt="Contábil Gaulke" class="h-14 w-auto" />
        <h1 class="text-2xl font-semibold">Validar documento assinado</h1>
        <p class="max-w-md text-muted">Informe o código da folha de assinaturas ou envie o PDF para conferir se ele é autêntico e não foi alterado.</p>
      </div>

      <UCard>
        <div class="space-y-5">
          <form class="flex gap-2" @submit.prevent="porCodigo">
            <UInput v-model="codigo" placeholder="Código de verificação" size="lg" class="flex-1 font-mono uppercase" />
            <UButton type="submit" label="Validar" size="lg" :loading="carregando && !arquivoNome" />
          </form>
          <USeparator label="ou" />
          <label class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-default p-6 text-center transition hover:border-primary">
            <input type="file" accept="application/pdf,.pdf" class="sr-only" @change="porArquivo" />
            <UIcon name="i-lucide-file-search" class="size-8 text-primary" />
            <span class="font-medium">{{ calculando || (carregando && arquivoNome) ? 'Conferindo…' : arquivoNome ? `Conferido: ${arquivoNome} — escolher outro` : 'Escolher o PDF' }}</span>
            <span class="text-xs text-muted">O arquivo não sai do seu computador: só a impressão digital (SHA-256) é conferida.</span>
          </label>
        </div>
      </UCard>

      <UCard v-if="resultado" class="mt-6">
        <div class="space-y-4">
          <UAlert
            v-if="resultado.conferido === 'pdf_original'"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-warning"
            title="Este é o PDF ORIGINAL, antes das assinaturas"
            description="O arquivo confere com o documento enviado para assinatura, mas não é a versão assinada."
          />
          <UAlert
            v-else-if="resultado.status === 'concluido'"
            color="success"
            variant="subtle"
            icon="i-lucide-shield-check"
            :title="resultado.conferido === 'pdf_final' ? 'Documento autêntico e sem alterações' : 'Documento encontrado'"
            :description="resultado.conferido === 'pdf_final' ? 'Este PDF é exatamente o documento assinado por todos.' : 'Para conferir se um PDF não foi alterado, envie o arquivo acima.'"
          />
          <UAlert v-else color="warning" variant="subtle" icon="i-lucide-hourglass" :title="ROTULO_STATUS_ASSIN[resultado.status]" />
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-muted">Documento</dt>
            <dd class="font-medium">{{ resultado.titulo }}</dd>
            <dt class="text-muted">Código</dt>
            <dd class="font-mono">{{ resultado.codigo }}</dd>
            <dt class="text-muted">Enviado em</dt>
            <dd>{{ formatarDataHora(resultado.enviadoEm) }}</dd>
            <template v-if="resultado.concluidoEm">
              <dt class="text-muted">Concluído em</dt>
              <dd>{{ formatarDataHora(resultado.concluidoEm) }} (Brasília)</dd>
            </template>
            <dt v-if="resultado.selado" class="text-muted">Selo</dt>
            <dd v-if="resultado.selado">Selado com o certificado digital da Contábil Gaulke (PAdES)</dd>
          </dl>
          <div>
            <p class="mb-2 text-sm font-medium">Assinaturas</p>
            <ul class="space-y-1.5 text-sm">
              <li v-for="(s, i) in resultado.signatarios" :key="i" class="flex flex-wrap items-center gap-2">
                <UIcon :name="s.status === 'assinado' ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" :class="s.status === 'assinado' ? 'text-success' : 'text-muted'" class="size-4" />
                <span class="font-medium">{{ s.nome }}</span>
                <span class="text-muted">{{ s.email }}</span>
                <span class="text-xs text-muted">{{ s.assinadoEm ? formatarDataHora(s.assinadoEm) : ROTULO_SIGNATARIO[s.status].toLowerCase() }}</span>
              </li>
            </ul>
          </div>
          <p v-if="resultado.finalSha256" class="break-all font-mono text-[11px] text-muted">SHA-256 do documento assinado: {{ resultado.finalSha256 }}</p>
        </div>
      </UCard>

      <UAlert v-if="erro" class="mt-6" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="erro" />

      <UCard v-if="naoEncontrado" class="mt-6">
        <div class="flex gap-3">
          <UIcon name="i-lucide-shield-x" class="size-6 shrink-0 text-error" />
          <div class="text-sm">
            <p class="font-medium">Nenhum documento encontrado</p>
            <p class="text-muted">
              {{ arquivoNome ? 'Este PDF não corresponde a nenhum documento assinado aqui — ele pode ter sido alterado depois da assinatura.' : 'Confira o código na folha de assinaturas (letras e números).' }}
            </p>
          </div>
        </div>
      </UCard>
    </main>
    <footer class="border-t border-default py-6 text-center text-xs text-muted">Contábil Gaulke · Validação de documentos assinados</footer>
  </div>
</template>
