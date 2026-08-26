<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const toast = useToast()
const token = String(route.params.token)

// o GET ja registra o evento de ACESSO no servidor
const { data, error } = await useFetch<RespostaLanding>(api(`/api/c/${token}`))

useHead({ title: 'Documento disponível — Gaulke Contábil' })

const ciente = ref(false)
const confirmando = ref(false)
const baixando = ref(false)
const confirmado = computed(() => !!data.value?.confirmado)
const podeBaixar = computed(
  () => !!data.value?.temArquivo && (!data.value.exigirConfirmacao || confirmado.value)
)

async function confirmar() {
  if (!ciente.value || confirmando.value) return
  confirmando.value = true
  try {
    const r = await $fetch<{ confirmadoEm: string }>(api(`/api/c/${token}/confirmar`), { method: 'POST' })
    if (data.value) {
      data.value.confirmado = true
      data.value.confirmadoEm = r.confirmadoEm
    }
    toast.add({ title: 'Leitura confirmada', icon: 'i-lucide-badge-check', color: 'success' })
  } catch {
    toast.add({ title: 'Não foi possível confirmar', color: 'error' })
  } finally {
    confirmando.value = false
  }
}

function baixar() {
  baixando.value = true
  // navegacao direta: o servidor registra o download e devolve o PDF
  window.location.href = api(`/api/c/${token}/arquivo`)
  setTimeout(() => {
    baixando.value = false
    if (data.value) data.value.downloads += 1
  }, 2000)
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-elevated/40">
    <main class="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <!-- Token invalido: mensagem neutra, nao revela se o link existiu -->
      <UCard v-if="error">
        <div class="space-y-3 py-6 text-center">
          <UIcon name="i-lucide-link-2-off" class="size-12 text-muted" />
          <h1 class="text-xl font-semibold">Link inválido ou expirado</h1>
          <p class="text-muted">
            Confira se o endereço foi copiado por completo. Em caso de dúvida, responda ao e-mail
            que você recebeu que nossa equipe reenvia o acesso.
          </p>
        </div>
      </UCard>

      <template v-else-if="data">
        <div class="mb-8 flex flex-col items-center gap-3 text-center">
          <!--
            A logo tem cores proprias (azul + laranja), entao no tema escuro
            ela vai sobre uma placa clara em vez de uma versao recolorida.
          -->
          <div class="rounded-xl bg-white px-5 py-3 dark:shadow-lg">
            <img :src="api('/brand/logo.png')" alt="Gaulke Contábil" class="h-12 w-auto" >
          </div>
          <h1 class="text-2xl font-semibold">Olá, {{ data.nome || 'tudo bem' }}!</h1>
          <p class="max-w-md text-muted">
            Disponibilizamos um documento para a sua análise. Confirme a leitura para liberar o download.
          </p>
        </div>

        <UCard>
          <div class="space-y-6">
            <!-- Codigo de referencia -->
            <div class="rounded-lg border border-default bg-elevated/50 p-4 text-center">
              <p class="text-xs uppercase tracking-wide text-muted">Seu código de referência</p>
              <p class="mt-1 font-mono text-2xl font-bold tracking-widest">{{ data.codigo }}</p>
              <p v-if="data.empresa" class="mt-2 text-sm text-muted">{{ data.empresa }}</p>
            </div>

            <!-- Passo 1: ciencia -->
            <div>
              <p class="mb-3 text-sm font-medium">1. Confirmação de leitura</p>

              <UAlert
                v-if="confirmado"
                color="success"
                variant="subtle"
                icon="i-lucide-badge-check"
                title="Leitura confirmada"
                :description="`Registrado em ${new Date(data.confirmadoEm!).toLocaleString('pt-BR')}.`"
              />

              <div v-else class="space-y-4">
                <UCheckbox
                  v-model="ciente"
                  label="Li e estou ciente do conteúdo deste comunicado."
                  help="Sua confirmação é registrada com data, hora e endereço IP."
                />
                <UButton
                  label="Confirmar leitura"
                  icon="i-lucide-check"
                  size="lg"
                  block
                  :disabled="!ciente"
                  :loading="confirmando"
                  @click="confirmar"
                />
              </div>
            </div>

            <USeparator />

            <!-- Passo 2: download -->
            <div>
              <p class="mb-3 text-sm font-medium">2. Documento</p>

              <UAlert
                v-if="!data.temArquivo"
                color="neutral"
                variant="subtle"
                icon="i-lucide-file-x"
                title="Nenhum arquivo anexo"
                description="Este comunicado não possui documento para download."
              />

              <template v-else>
                <div class="mb-4 flex items-center gap-3 rounded-lg border border-default p-3">
                  <UIcon name="i-lucide-file-text" class="size-8 shrink-0 text-error" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{{ data.arquivoNome || 'documento.pdf' }}</p>
                    <p class="text-xs text-muted">
                      {{ data.downloads > 0 ? `Baixado ${data.downloads}x` : 'Ainda não baixado' }}
                    </p>
                  </div>
                </div>

                <UButton
                  label="Baixar documento"
                  icon="i-lucide-download"
                  size="lg"
                  color="primary"
                  block
                  :disabled="!podeBaixar"
                  :loading="baixando"
                  @click="baixar"
                />
                <p v-if="!podeBaixar" class="mt-2 text-center text-xs text-muted">
                  Confirme a leitura acima para liberar o download.
                </p>
              </template>
            </div>
          </div>
        </UCard>

        <!-- Transparencia LGPD -->
        <div class="mt-6 rounded-lg border border-default bg-default/50 p-4">
          <div class="flex gap-3">
            <UIcon name="i-lucide-shield-check" class="size-5 shrink-0 text-muted" />
            <div class="space-y-1 text-xs leading-relaxed text-muted">
              <p class="font-medium text-default">Registro de acesso</p>
              <p>
                Para comprovar a entrega e a ciência deste comunicado, registramos a data, a hora e
                o endereço IP do seu acesso, da confirmação de leitura e do download.
              </p>
              <p>
                O tratamento segue a Lei 13.709/2018 (LGPD), limita-se a essa finalidade e os
                registros são mantidos por 24 meses. Este link é pessoal — evite compartilhá-lo.
              </p>
            </div>
          </div>
        </div>
      </template>
    </main>

    <footer class="border-t border-default py-6 text-center text-xs text-muted">
      Gaulke Contábil · Em caso de dúvida, responda ao e-mail recebido.
    </footer>
  </div>
</template>
