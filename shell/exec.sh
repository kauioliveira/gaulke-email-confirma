#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gaulke-email-confirma"
TAR_FILE="${APP_NAME}.tar"
TAR_FILE_NEW="${APP_NAME}__NEW.tar"
TAR_FILE_OLD="${APP_NAME}__OLD.tar"
IMAGE_NAME="${APP_NAME}:latest"

# --env-file: o compose interpola ${...} a partir do ambiente do shell ou de um
# arquivo chamado exatamente `.env` na pasta do compose — o `env_file:` de dentro
# do docker-compose.yml NÃO alimenta essa substituição. Aqui o arquivo se chama
# .env.production, então sem esta flag a porta ${APP_HOST_PORT} viria vazia e
# cairia no padrão, abrindo uma porta diferente da que o proxy reverso consulta.
#
# Precisa valer no `up` E no `down`: com valores diferentes entre os dois, o
# compose não reconhece os contêineres que ele mesmo subiu.
ENV_FILE=".env.production"

usage() {
    echo
    echo "Uso:"
    echo "  $0 up        # carrega a imagem e sobe (as migrations correm no boot)"
    echo "  $0 stop      # derruba os contêineres"
    echo "  $0 migrate   # aplica as migrations SEM subir a aplicação"
    echo "  $0 logs      # acompanha o log da aplicação"
    echo
    exit 1
}

require_env_file() {
    # Sem o arquivo de ambiente o compose aborta com uma mensagem sua, bem menos
    # clara que esta — e o deploy pararia depois de já ter carregado a imagem.
    if [ ! -f "$ENV_FILE" ]; then
        echo "ERRO: arquivo $ENV_FILE não encontrado nesta pasta."
        exit 1
    fi
}

# A APLICAÇÃO JÁ APLICA AS MIGRATIONS SOZINHA NO BOOT, em qualquer ambiente
# (server/plugins/retomar-lotes.ts). Este comando existe só para o caso de
# você querer aplicá-las SEM subir nada — conferir um schema, por exemplo.
#
# Roda num contêiner descartável, nunca no que está servindo. São idempotentes,
# um advisory lock serializa execuções concorrentes, e qualquer DROP/TRUNCATE é
# recusado: este banco é compartilhado com os outros sistemas da empresa.
run_migrations() {
    echo "==> Aplicando migrations (sys_mail_*)"
    docker run --rm --env-file "$ENV_FILE" "$IMAGE_NAME" node scripts/migrate.mjs
}

[ $# -eq 1 ] || usage

case "$1" in

    stop)
        require_env_file
        echo "==> Parando containers"
        docker compose --env-file "$ENV_FILE" down
        ;;

    migrate)
        require_env_file
        run_migrations
        ;;

    logs)
        require_env_file
        docker compose --env-file "$ENV_FILE" logs -f --tail=200
        ;;

    up)
        if [ ! -f "$TAR_FILE_NEW" ]; then
            echo "ERRO: arquivo $TAR_FILE_NEW não encontrado."
            exit 1
        fi

        require_env_file

        echo "==> Mover um pelo outro (BACKUP)"
        rm -rf $TAR_FILE_OLD
        cp -v $TAR_FILE_NEW $TAR_FILE_OLD
        mv -v $TAR_FILE_NEW $TAR_FILE

        echo "==> Carregando imagem Docker"
        docker load -i "$TAR_FILE"

        # Sem passo de migration aqui: a aplicação aplica no próprio boot.
        # Se algo falhar, o log diz, e o /api/admin/status mostra o erro.
        echo
        echo "==> Subindo containers"
        docker compose --env-file "$ENV_FILE" up -d --force-recreate

        # O disparo é retomável: um lote interrompido pelo --force-recreate volta
        # sozinho no boot, sem reenviar quem já recebeu (server/plugins/retomar-lotes.ts).
        echo
        echo "Ambiente iniciado com sucesso."
        echo "Acompanhe o boot com:  bash exec.sh logs"
        ;;

    *)
        usage
        ;;
esac
