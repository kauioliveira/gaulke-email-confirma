<script setup lang="ts">
definePageMeta({ layout: false });
useHead({ title: "Entrar — Gaulke Comunica" });

const route = useRoute();
const painelUrl = useRuntimeConfig().public.painelUrl;
const toast = useToast();
const senha = ref("");
const carregando = ref(false);
const mostrarSenha = ref(false);

const destino = computed(() => String(route.query.redirect || "/admin"));

/**
 * A entrada normal é a sessão do painel: o cookie vale para todo
 * *.contabilgaulke.com.br e este app o valida no banco, sabendo QUEM entrou.
 * Todo usuário ativo do painel tem acesso.
 *
 * A senha local fica só como acesso de emergência (painel fora do ar, acesso
 * por IP) e some da tela quando o admin a desliga.
 */
const { data: sessao, refresh } = await useFetch<RespostaSessao>(
  api("/api/admin/sessao"),
  {
    headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    default: () =>
      ({
        autenticado: false,
        origem: "nenhuma",
        senhaLocal: false,
        usuario: null,
      }) as RespostaSessao,
  },
);

const origem = computed(() => sessao.value?.origem ?? "nenhuma");
const senhaLocal = computed(() => sessao.value?.senhaLocal ?? false);

// já autenticado (pelo painel ou por senha ainda válida): entra direto
watchEffect(() => {
  if (sessao.value?.autenticado) navigateTo(destino.value);
});

async function entrar() {
  if (!senha.value) return;
  carregando.value = true;
  try {
    await $fetch(api("/api/admin/login"), {
      method: "POST",
      body: { senha: senha.value },
    });
    await navigateTo(destino.value);
  } catch (e: any) {
    toast.add({
      title: "Não foi possível entrar",
      description: e?.statusMessage || "Verifique a senha e tente novamente.",
      color: "error",
    });
    senha.value = "";
  } finally {
    carregando.value = false;
  }
}
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-elevated/40 px-4"
  >
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-mail-check" class="size-8 text-primary" />
          <div>
            <p class="font-semibold">Gaulke · Comunica</p>
            <p class="text-sm text-muted">Comunicação com clientes</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <UAlert
          v-if="origem === 'painel-invalido'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-clock-alert"
          title="Sua sessão do painel expirou"
          description="Entre novamente no Painel Gaulke e volte para esta página."
        />
        <p v-else class="text-sm text-muted">
          O acesso é feito pela sua conta do <strong>Painel Gaulke</strong>.
          Entre no painel e volte para esta página.
        </p>

        <UButton
          v-if="painelUrl"
          label="Abrir o Painel Gaulke"
          icon="i-lucide-external-link"
          block
          :to="painelUrl"
          external
        />
        <UButton
          label="Já entrei no painel — tentar de novo"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          block
          @click="refresh()"
        />

        <template v-if="senhaLocal">
          <USeparator />
          <UButton
            v-if="!mostrarSenha"
            label="Acesso de emergência (senha local)"
            icon="i-lucide-key-round"
            color="neutral"
            variant="ghost"
            size="xs"
            block
            @click="mostrarSenha = true"
          />
          <form v-else class="space-y-3" @submit.prevent="entrar">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-shield-alert"
              description="Use só se o painel estiver fora do ar. Este acesso não identifica você e fica registrado na auditoria."
            />
            <UFormField label="Senha local" name="senha">
              <UInput
                v-model="senha"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
                autofocus
                class="w-full"
              />
            </UFormField>
            <UButton
              type="submit"
              label="Entrar"
              icon="i-lucide-log-in"
              color="neutral"
              block
              :loading="carregando"
              :disabled="!senha"
            />
          </form>
        </template>
      </div>

      <template #footer>
        <p class="text-xs text-center text-muted">
          Todas as ações ficam registradas com o seu nome.
        </p>
      </template>
    </UCard>
  </div>
</template>
