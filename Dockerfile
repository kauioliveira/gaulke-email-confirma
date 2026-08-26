# Build
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# Subdominio proprio: o app roda na raiz, sem NUXT_APP_BASE_URL.
RUN npm run build

# Runtime
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app

COPY --from=build /app/.output ./.output
# o template inicial e lido do disco no primeiro boot (server/utils/seed.ts)
COPY --from=build /app/emails ./emails
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
