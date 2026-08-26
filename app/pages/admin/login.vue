<script setup lang="ts">
definePageMeta({ layout: false });
useHead({ title: "Entrar — Gaulke Envios" });

const route = useRoute();
const painelUrl = useRuntimeConfig().public.painelUrl;
const toast = useToast();
const senha = ref("");
const carregando = ref(false);

const destino = computed(() => String(route.query.redirect || "/admin/lotes"));

/**
 * Quem já está logado no painel não precisa digitar senha: o cookie de sessão
 * vale para todo *.contabilgaulke.com.br e este app consegue validá-lo no
 * banco. A senha do .env fica como reserva — para o acesso por IP, ou quando
 * o painel está fora do ar.
 */
const { data: sessao, refresh } = await useFetch<RespostaSessao>(
  api("/api/admin/sessao"),
  {
    headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    default: () =>
      ({
        autenticado: false,
        origem: "nenhuma",
        usuario: null,
      }) as RespostaSessao,
  },
);

const origem = computed(() => sessao.value?.origem ?? "nenhuma");
const semPermissao = computed(() => origem.value === "painel-sem-permissao");

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
            <p class="font-semibold">Gaulke · Envios</p>
            <p class="text-sm text-muted">Área administrativa</p>
          </div>
        </div>
      </template>

      <!-- sessão do painel reconhecida, mas o disparo é restrito -->
      <div v-if="semPermissao" class="space-y-4">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="Sem permissão para disparar"
          :description="`${sessao?.usuario?.nome}, o envio de comunicados está liberado apenas para administradores e supervisores. Peça acesso a quem administra o painel.`"
        />
        <UButton
          v-if="painelUrl"
          label="Voltar ao painel"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="outline"
          block
          :to="painelUrl"
          external
        />
      </div>

      <div v-else class="space-y-4">
        <UAlert
          v-if="origem === 'painel-invalido'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-clock-alert"
          title="Sua sessão do painel expirou"
          description="Entre novamente no painel para acessar sem senha, ou use a senha de acesso abaixo."
        />

        <form class="space-y-4" @submit.prevent="entrar">
          <UFormField label="Senha de acesso" name="senha">
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
            block
            :loading="carregando"
            :disabled="!senha"
          />
        </form>

        <UButton
          label="Já entrei no Painel Gaulke — tentar de novo"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          block
          @click="refresh()"
        />
      </div>

      <template #footer>
        <p class="text-xs text-center text-muted">Acesso Restrito!</p>
      </template>
    </UCard>
  </div>
</template>
