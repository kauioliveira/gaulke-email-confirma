<script setup lang="ts">
/**
 * Página sempre clara, independente do tema do aparelho de quem recebe.
 *
 * Ela é a face da empresa para fora, e a marca tem cor fixa: a logo é escura
 * (azul #323983), então num tema escuro ela sumiria — foi o que antes obrigou
 * a colocá-la sobre uma placa branca, que aparecia como um quadrado. Fixar o
 * tema resolve a causa em vez do sintoma. O painel interno segue com os dois.
 */
definePageMeta({ layout: false, colorMode: "light" });

const route = useRoute();
const toast = useToast();
const token = String(route.params.token);

// o GET ja registra o evento de ACESSO no servidor
const { data, error } = await useFetch<RespostaLanding>(api(`/api/c/${token}`));

useHead({ title: "Documento disponível — Contábil Gaulke" });

const ciente = ref(false);
const confirmando = ref(false);
const baixando = ref(false);
const confirmado = computed(() => !!data.value?.confirmado);
const podeBaixar = computed(
  () =>
    !!data.value?.temArquivo &&
    (!data.value.exigirConfirmacao || confirmado.value),
);

async function confirmar() {
  if (!ciente.value || confirmando.value) return;
  confirmando.value = true;
  try {
    const r = await $fetch<{ confirmadoEm: string }>(
      api(`/api/c/${token}/confirmar`),
      { method: "POST" },
    );

    /**
     * TROCA O OBJETO INTEIRO, e nao a propriedade.
     *
     * O `data` do useFetch e um shallowRef: escrever `data.value.confirmado = true`
     * altera o objeto, mas nao avisa o Vue. O resultado era cruel — o servidor
     * registrava a confirmacao e o botao de download continuava bloqueado, so
     * liberando depois de um F5.
     *
     * Recarregar com refresh() tambem resolveria, mas o GET da landing registra
     * um evento de ACESSO: o relatorio ganharia um acesso falso a cada confirmacao.
     */
    if (data.value) {
      data.value = {
        ...data.value,
        confirmado: true,
        confirmadoEm: r.confirmadoEm,
      };
    }
    toast.add({
      title: "Leitura confirmada",
      icon: "i-lucide-badge-check",
      color: "success",
    });
  } catch {
    toast.add({ title: "Não foi possível confirmar", color: "error" });
  } finally {
    confirmando.value = false;
  }
}

function baixar() {
  baixando.value = true;
  // navegacao direta: o servidor registra o download e devolve o PDF
  window.location.href = api(`/api/c/${token}/arquivo`);
  setTimeout(() => {
    baixando.value = false;
    // mesmo motivo do confirmar(): shallowRef exige trocar o objeto
    if (data.value)
      data.value = { ...data.value, downloads: data.value.downloads + 1 };
  }, 2000);
}

/**
 * Atalho para o WhatsApp da empresa.
 *
 * A mensagem ja vai preenchida com o CODIGO da pessoa: quem atender sabe
 * na hora de qual envio se trata, sem precisar perguntar. O texto muda
 * conforme o que ela ainda nao fez, para a conversa comecar no ponto certo.
 */
const whatsapp = computed(() => {
  const numero = useRuntimeConfig().public.whatsapp;
  if (!numero || !data.value) return null;

  const codigo = data.value.codigo;
  const texto = !data.value.temArquivo
    ? `Ola! Recebi o comunicado de codigo ${codigo} e preciso de ajuda.`
    : !confirmado.value
      ? `Ola! Estou com dificuldade para acessar o documento do comunicado de codigo ${codigo}.`
      : `Ola! Confirmei a leitura do comunicado de codigo ${codigo}, mas nao consegui baixar o arquivo.`;

  return `https://api.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(texto)}`;
});
</script>

<template>
  <div class="flex min-h-screen flex-col bg-elevated/40">
    <!-- pb-24 reserva o espaço do botão flutuante do WhatsApp no celular -->
    <main class="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-10">
      <!-- Token invalido: mensagem neutra, nao revela se o link existiu -->
      <UCard v-if="error">
        <div class="space-y-3 py-6 text-center">
          <UIcon name="i-lucide-link-2-off" class="size-12 text-muted" />
          <h1 class="text-xl font-semibold">Link inválido ou expirado</h1>
          <p class="text-muted">
            Confira se o endereço foi copiado por completo. Em caso de dúvida,
            responda ao e-mail que você recebeu que nossa equipe reenvia o
            acesso.
          </p>
        </div>
      </UCard>

      <template v-else-if="data">
        <div class="mb-8 flex flex-col items-center gap-3 text-center">
          <!--
            Sem placa atrás: o PNG é transparente e a placa branca aparecia como
            um quadrado sobre o fundo cinza da página. A legibilidade vem de a
            página ser sempre clara (colorMode acima), e não de um fundo local.
          -->
          <img
            :src="api('/brand/logo.png')"
            alt="Contábil Gaulke"
            class="h-16 w-auto sm:h-20"
          />
          <h1 class="text-2xl font-semibold">
            Olá, {{ data.nome || "tudo bem" }}!
          </h1>
          <!--
            A empresa so aparece quando veio preenchida na planilha: o campo e
            opcional na importacao, e uma linha vazia aqui deixaria um buraco no
            meio da saudacao. Menor que o titulo, mas em negrito e na cor da
            marca — quem recebe documento de mais de um CNPJ precisa saber de
            qual deles e este antes de baixar.
          -->
          <p v-if="data.empresa" class="text-base font-semibold text-primary">
            {{ data.empresa }}
          </p>
          <p class="max-w-md text-muted">
            Disponibilizamos um documento para a sua análise. Confirme a leitura
            para liberar o download.
          </p>
        </div>

        <UCard>
          <div class="space-y-6">
            <!-- Codigo de referencia -->
            <div
              class="rounded-lg border border-default bg-elevated/50 p-4 text-center"
            >
              <p class="text-xs uppercase tracking-wide text-muted">
                Seu código de referência
              </p>
              <p class="mt-1 font-mono text-2xl font-bold tracking-widest">
                {{ data.codigo }}
              </p>
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
                <div
                  class="mb-4 flex items-center gap-3 rounded-lg border border-default p-3"
                >
                  <UIcon
                    name="i-lucide-file-text"
                    class="size-8 shrink-0 text-error"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                      {{ data.arquivoNome || "documento.pdf" }}
                    </p>
                    <p class="text-xs text-muted">
                      {{
                        data.downloads > 0
                          ? `Baixado ${data.downloads}x`
                          : "Ainda não baixado"
                      }}
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
                <p
                  v-if="!podeBaixar"
                  class="mt-2 text-center text-xs text-muted"
                >
                  Confirme a leitura acima para liberar o download.
                </p>
              </template>
            </div>
          </div>
        </UCard>

        <!-- Transparencia LGPD -->
        <div class="mt-6 rounded-lg border border-default bg-default/50 p-4">
          <div class="flex gap-3">
            <UIcon
              name="i-lucide-shield-check"
              class="size-5 shrink-0 text-muted"
            />
            <div class="space-y-1 text-xs leading-relaxed text-muted">
              <p class="font-medium text-default">Registro de acesso</p>
              <p>
                Para comprovar a entrega e a ciência deste comunicado,
                registramos a data, a hora e o endereço IP do seu acesso, da
                confirmação de leitura e do download.
              </p>
              <p>
                O tratamento segue a Lei 13.709/2018 (LGPD), limita-se a essa
                finalidade e os registros são mantidos por 24 meses. Este link é
                pessoal — evite compartilhá-lo.
              </p>
            </div>
          </div>
        </div>
      </template>
    </main>

    <footer class="border-t border-default py-6 text-center text-xs text-muted">
      Contábil Gaulke · Em caso de dúvida, fale conosco pelo WhatsApp ou
      responda ao e-mail recebido.
    </footer>

    <!--
      Botão flutuante do WhatsApp.
      O padding-bottom do <main> reserva o espaço dele no celular, senão ele
      cobriria o botão de download — que é justamente o que a pessoa veio fazer.
    -->
    <a
      v-if="whatsapp"
      :href="whatsapp"
      target="_blank"
      rel="noopener noreferrer"
      class="group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#25D366] p-3.5 text-white shadow-lg transition hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/40 sm:py-3 sm:pl-3 sm:pr-4"
      aria-label="Falar com a Contábil Gaulke pelo WhatsApp"
    >
      <!-- ícone oficial em SVG: não depende de nenhuma fonte de ícones externa -->
      <svg
        viewBox="0 0 24 24"
        class="size-6 shrink-0 fill-current"
        aria-hidden="true"
      >
        <path
          d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"
        />
        <path
          d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23z"
        />
      </svg>
      <!-- no celular fica só o ícone: o rótulo atropelava o rodapé -->
      <span class="hidden text-sm font-semibold sm:inline">Falar conosco</span>
    </a>
  </div>
</template>
