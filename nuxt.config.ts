/**
 * Hosts que o servidor de DESENVOLVIMENTO aceita no cabecalho Host.
 *
 * O Vite recusa requisicoes de dominios que nao conhece ("Blocked request.
 * This host is not allowed") como protecao contra DNS rebinding. Isso aparece
 * assim que o dev roda atras de um proxy ou de um dominio real.
 *
 * O host sai do proprio URL_ACESSO para nao ficar hardcoded e nao divergir:
 * se um dia o dominio mudar no .env, ele passa a valer aqui tambem.
 * DEV_HOSTS aceita nomes extras separados por virgula.
 *
 * Nada disso vale em producao: o build do Nitro nao tem essa checagem.
 */
function hostsDeDesenvolvimento() {
  const hosts = new Set<string>()

  const bruto = (process.env.URL_ACESSO || '').trim().replace(/^['"]|['"]$/g, '')
  if (bruto) {
    try {
      hosts.add(new URL(bruto).hostname)
    } catch {
      // URL_ACESSO invalida ja e reportada no boot por server/utils/urls.ts
    }
  }

  for (const extra of (process.env.DEV_HOSTS || '').split(',')) {
    const h = extra.trim()
    if (h) hosts.add(h)
  }

  return [...hosts]
}

export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],

  vite: {
    server: {
      allowedHosts: hostsDeDesenvolvimento(),
    },
  },

  // As variaveis sem prefixo NUXT_ (DATABASE_URL, URL_ACESSO, ADMIN_PASSWORD...)
  // nao sao mapeadas automaticamente pelo Nuxt, por isso a ligacao e explicita.
  // As NUXT_SMTP_* abaixo continuam sendo mapeadas sozinhas.
  runtimeConfig: {
    // Acesso a area administrativa
    adminPassword: process.env.ADMIN_PASSWORD || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    // Diretorio privado onde ficam os PDFs dos lotes
    storageDir: process.env.STORAGE_DIR || "./storage/files",
    // Conexao Postgres (DATABASE_URL)
    databaseUrl: process.env.DATABASE_URL || "",
    // SMTP da empresa -> mapeado de NUXT_SMTP_*
    smtp: {
      enabled: "true",
      host: "",
      port: "587",
      secure: "false",
      requireTls: "true",
      rejectUnauthorized: "true",
      user: "",
      pass: "",
      from: "",
      replyTo: "",
    },
    public: {
      // URL_ACESSO: base publica usada em TODOS os links do e-mail
      urlAcesso: process.env.URL_ACESSO || "",
    },
  },

  nitro: {
    // IP real quando atras de Nginx/proxy
    routeRules: {
      "/admin/**": { ssr: true },
    },
  },

  app: {
    // Suporta rodar sob subcaminho (ex.: URL_ACESSO=.../notifica/).
    // Em runtime pode ser sobrescrito por NUXT_APP_BASE_URL.
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      htmlAttrs: { lang: "pt-BR" },
      title: "Gaulke — Envio e Confirmação",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ],
      link: [
        {
          rel: "icon",
          type: "image/x-icon",
          href: `${(process.env.NUXT_APP_BASE_URL || "/").replace(/\/$/, "")}/favicon.ico`,
        },
      ],
    },
  },
});
