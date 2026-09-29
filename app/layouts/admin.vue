<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { sessao, papel, pode } = usePapel()

/** Cada link pode exigir um papel minimo; os demais servem a todo usuario ativo. */
// `mais`: fica no menu "Mais" no computador (a barra nao comporta todos em 1440px)
const TODOS_LINKS: { label: string; icon: string; to: string; papel?: PapelOperador; mais?: boolean }[] = [
  { label: 'Início', icon: 'i-lucide-house', to: '/admin' },
  { label: 'Lotes', icon: 'i-lucide-layers', to: '/admin/lotes' },
  { label: 'Novo envio', icon: 'i-lucide-plus-circle', to: '/admin/lotes/novo' },
  { label: 'Solicitações', icon: 'i-lucide-folder-input', to: '/admin/solicitacoes' },
  { label: 'Assinaturas', icon: 'i-lucide-signature', to: '/admin/assinaturas' },
  { label: 'Templates', icon: 'i-lucide-file-code-2', to: '/admin/templates' },
  { label: 'Clientes', icon: 'i-lucide-contact', to: '/admin/clientes', mais: true },
  { label: 'Listas', icon: 'i-lucide-list', to: '/admin/listas', mais: true },
  { label: 'Relatório', icon: 'i-lucide-chart-no-axes-column', to: '/admin/relatorio', mais: true },
  { label: 'Caixa', icon: 'i-lucide-inbox', to: '/admin/caixa', mais: true },
  { label: 'Auditoria', icon: 'i-lucide-scroll-text', to: '/admin/auditoria', papel: 'supervisor', mais: true },
  { label: 'Lixeira', icon: 'i-lucide-trash', to: '/admin/lixeira', papel: 'admin', mais: true },
  { label: 'Configurações', icon: 'i-lucide-settings', to: '/admin/configuracoes', papel: 'admin', mais: true }
]
const links = computed(() => TODOS_LINKS.filter(l => !l.papel || pode(l.papel)))
const principais = computed(() => links.value.filter(l => !l.mais))
const secundarios = computed(() => links.value.filter(l => l.mais))

/**
 * Link aceso: o mais especifico que contem a pagina atual. Assim
 * /admin/solicitacoes/12 acende "Solicitacoes", e /admin/lotes/novo acende
 * "Novo envio" e nao "Lotes". "Inicio" so acende nele mesmo.
 */
const linkAtivo = computed(() =>
  links.value
    .filter(l => route.path === l.to || (l.to !== '/admin' && route.path.startsWith(`${l.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to
)

const { data: status } = await useFetch<RespostaStatus>(api('/api/admin/status'), { lazy: true, server: false })

const peloPainel = computed(() => sessao.value?.origem === 'painel')

// o middleware manda para cá quem tentou abrir uma página sem o papel exigido
onMounted(() => {
  const negado = route.query.semPermissao
  if (!negado) return
  toast.add({
    title: 'Sem permissão para essa página',
    description: `Seu perfil (${ROTULO_PAPEL[papel.value]}) não tem acesso a ${negado}.`,
    color: 'warning',
    icon: 'i-lucide-shield-alert'
  })
  const { semPermissao: _, ...resto } = route.query
  router.replace({ query: resto })
})

/**
 * Sair so faz sentido para quem entrou pela senha. Com a sessao do painel nao
 * ha nada nosso para encerrar: apagar o cookie daqui deslogaria a pessoa do
 * painel inteiro, e o login voltaria a reconhece-la em seguida.
 */
async function sair() {
  await $fetch(api('/api/admin/logout'), { method: 'POST' })
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="min-h-screen bg-elevated/40">
    <header class="sticky top-0 z-40 border-b border-default bg-default/85 backdrop-blur">
      <!-- largura cheia (com respiro nas bordas), e não uma caixa centralizada:
           com o menu crescendo, a caixa de 1280px espremia e quebrava o nome -->
      <div class="mx-auto flex h-16 w-full max-w-[1920px] items-center gap-4 px-4 lg:px-8">
        <NuxtLink to="/admin" class="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold">
          <UIcon name="i-lucide-mail-check" class="size-6 shrink-0 text-primary" />
          <!-- entre 1280 e 1535px o menu completo divide a barra com os selos:
               o nome sai (fica o ícone) para nada se sobrepor -->
          <span class="hidden sm:inline xl:hidden 2xl:inline">Gaulke · Comunica</span>
        </NuxtLink>

        <nav class="ml-4 hidden min-w-0 items-center gap-1 xl:flex">
          <UButton
            v-for="l in principais"
            :key="l.to"
            :to="l.to"
            :icon="l.icon"
            :label="l.label"
            :color="linkAtivo === l.to ? 'primary' : 'neutral'"
            :variant="linkAtivo === l.to ? 'soft' : 'ghost'"
            size="sm"
          />
          <UDropdownMenu
            v-if="secundarios.length"
            :items="secundarios.map(l => ({ label: l.label, icon: l.icon, to: l.to }))"
            :content="{ align: 'end' }"
          >
            <UButton
              label="Mais"
              trailing-icon="i-lucide-chevron-down"
              :icon="secundarios.find(l => l.to === linkAtivo)?.icon ?? 'i-lucide-ellipsis'"
              :color="secundarios.some(l => l.to === linkAtivo) ? 'primary' : 'neutral'"
              :variant="secundarios.some(l => l.to === linkAtivo) ? 'soft' : 'ghost'"
              size="sm"
            />
          </UDropdownMenu>
        </nav>

        <div class="ml-auto flex shrink-0 items-center gap-2">
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
          <!-- monitor da caixa parado: devoluções e respostas deixam de aparecer -->
          <UTooltip
            v-if="status?.caixa?.some(c => c.erro)"
            :text="status.caixa.filter(c => c.erro).map(c => `${c.conta}: ${c.erro}`).join(' · ')"
          >
            <UBadge color="error" variant="subtle" icon="i-lucide-inbox" label="caixa" />
          </UTooltip>
          <UTooltip
            v-if="status?.chamados?.erros"
            :text="`${status.chamados.erros} chamado(s) não chegaram ao painel. Veja em Configurações → Integração com o painel.`"
          >
            <UBadge color="warning" variant="subtle" icon="i-lucide-ticket" label="chamados" />
          </UTooltip>
          <UTooltip
            v-if="status?.antivirus?.configurado && !status.antivirus.ok"
            :text="`Antivírus fora do ar: ${status.antivirus.mensagem}. ${status.antivirus.quarentena} arquivo(s) de clientes aguardando na quarentena.`"
          >
            <UBadge color="warning" variant="subtle" icon="i-lucide-shield-alert" label="antivírus" />
          </UTooltip>
          <UTooltip v-if="status?.painel.aviso" :text="status.painel.aviso">
            <UBadge color="warning" variant="subtle" icon="i-lucide-key-round" label="painel" />
          </UTooltip>
          <UColorModeButton />
          <UTooltip
            v-if="peloPainel"
            :text="`Conectado pela sua sessão do painel${sessao?.usuario?.email ? ` (${sessao.usuario.email})` : ''} · perfil: ${ROTULO_PAPEL[papel]}`"
          >
            <UBadge color="neutral" variant="subtle" icon="i-lucide-user-check">
              <span class="max-w-[10rem] truncate">{{ sessao?.usuario?.nome }}</span>
              <span class="hidden text-muted lg:inline">· {{ ROTULO_PAPEL[papel] }}</span>
            </UBadge>
          </UTooltip>
          <template v-else>
            <!-- a senha local nao identifica a pessoa: o aviso fica visivel o tempo todo -->
            <UTooltip text="Acesso de emergência pela senha local: suas ações ficam registradas sem identificação pessoal. Prefira entrar pelo painel.">
              <UBadge color="warning" variant="subtle" icon="i-lucide-key-round" label="Acesso de emergência" />
            </UTooltip>
            <UButton
              icon="i-lucide-log-out"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Sair"
              @click="sair"
            />
          </template>
        </div>
      </div>

      <nav class="flex gap-1 overflow-x-auto border-t border-default px-4 py-2 xl:hidden">
        <UButton
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          :icon="l.icon"
          :label="l.label"
          :color="linkAtivo === l.to ? 'primary' : 'neutral'"
          :variant="linkAtivo === l.to ? 'soft' : 'ghost'"
          size="xs"
        />
      </nav>
    </header>

    <main class="mx-auto w-full max-w-[1920px] px-4 py-6 lg:px-8">
      <slot />
    </main>
  </div>
</template>
