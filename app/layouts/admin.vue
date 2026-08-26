<script setup lang="ts">
const route = useRoute()
const links = [
  { label: 'Lotes', icon: 'i-lucide-layers', to: '/admin/lotes' },
  { label: 'Novo envio', icon: 'i-lucide-plus-circle', to: '/admin/lotes/novo' },
  { label: 'Templates', icon: 'i-lucide-file-code-2', to: '/admin/templates' },
  { label: 'Relatório', icon: 'i-lucide-chart-no-axes-column', to: '/admin/relatorio' }
]

const { data: status } = await useFetch<RespostaStatus>(api('/api/admin/status'), { lazy: true, server: false })

async function sair() {
  await $fetch(api('/api/admin/logout'), { method: 'POST' })
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="min-h-screen bg-elevated/40">
    <header class="sticky top-0 z-40 border-b border-default bg-default/85 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <NuxtLink to="/admin/lotes" class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-mail-check" class="size-6 text-primary" />
          <span class="hidden sm:inline">Gaulke · Envios</span>
        </NuxtLink>

        <nav class="ml-4 hidden items-center gap-1 md:flex">
          <UButton
            v-for="l in links"
            :key="l.to"
            :to="l.to"
            :icon="l.icon"
            :label="l.label"
            :color="route.path === l.to ? 'primary' : 'neutral'"
            :variant="route.path === l.to ? 'soft' : 'ghost'"
            size="sm"
          />
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <UTooltip
            v-if="status"
            :text="status.smtp.ok ? `SMTP ${status.smtp.mensagem}` : `SMTP indisponível: ${status.smtp.mensagem}`"
          >
            <UBadge
              :color="status.smtp.ok ? 'success' : 'error'"
              variant="subtle"
              :icon="status.smtp.ok ? 'i-lucide-plug-zap' : 'i-lucide-unplug'"
              label="SMTP"
            />
          </UTooltip>
          <UTooltip v-if="status?.urlAcesso.aviso" :text="status.urlAcesso.aviso">
            <UBadge color="warning" variant="subtle" icon="i-lucide-link-2-off" label="URL_ACESSO" />
          </UTooltip>
          <!--
            URL_ACESSO resolvendo para IP interno: o sistema funciona pela
            metade e sem esse aviso ninguem descobre — os links abrem de dentro
            da rede, mas a logo e o pixel do e-mail nunca carregam.
          -->
          <UTooltip v-else-if="status?.urlAcesso.alcance" :text="status.urlAcesso.alcance">
            <UBadge color="warning" variant="subtle" icon="i-lucide-globe-lock" label="rede interna" />
          </UTooltip>
          <UColorModeButton />
          <UButton icon="i-lucide-log-out" color="neutral" variant="ghost" size="sm" @click="sair" />
        </div>
      </div>

      <nav class="flex gap-1 overflow-x-auto border-t border-default px-4 py-2 md:hidden">
        <UButton
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          :icon="l.icon"
          :label="l.label"
          :color="route.path === l.to ? 'primary' : 'neutral'"
          :variant="route.path === l.to ? 'soft' : 'ghost'"
          size="xs"
        />
      </nav>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
