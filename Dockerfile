# Build
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# Subdominio proprio: o app roda na raiz, sem NUXT_APP_BASE_URL.
RUN npm run build

# TRAVA: nenhum import pode apontar para /app/node_modules.
#
# O estagio de runtime copia so o .output — um import com caminho absoluto para
# node_modules compila sem reclamar e so quebra no cliente, em producao, com um
# "Server Error" mudo. Foi o que aconteceu com o xlsx (dist/cpexcel.js): o build
# CommonJS dele vira um import absoluto e derrubava toda importacao de lista.
#
# Falhar aqui e barato; descobrir no ar custa um envio.
RUN if grep -rl "/app/node_modules/" .output/server > /tmp/vazamentos.txt 2>/dev/null && [ -s /tmp/vazamentos.txt ]; then \
      echo "ERRO: o bundle importa /app/node_modules, que nao existe na imagem final:"; \
      cat /tmp/vazamentos.txt; \
      grep -rn "/app/node_modules/" .output/server | head -20; \
      echo "Use o entrypoint ESM do pacote (ex.: 'xlsx/xlsx.mjs') ou copie a dependencia no estagio de runtime."; \
      exit 1; \
    fi

# Runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app

COPY --from=build /app/.output ./.output
# migrations + script, para rodar `npm run db:migrate` dentro do container
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules/postgres ./node_modules/postgres

# PDFs dos lotes: precisa ser volume, senao somem a cada deploy
RUN mkdir -p /app/storage/files && chown -R app:app /app/storage
VOLUME ["/app/storage/files"]

USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
