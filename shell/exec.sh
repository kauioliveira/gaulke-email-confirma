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
    echo "  $0 up        # carrega a imagem, aplica migrations e sobe"
    echo "  $0 stop      # derruba os contêineres"
    echo "  $0 migrate   # só as migrations, sem mexer no que está no ar"
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

# As migrations rodam num contêiner DESCARTÁVEL, e não no que está servindo.
#
# São idempotentes (CREATE TABLE IF NOT EXISTS, controle em sys_mail_migrations)
# e o scripts/migrate.mjs recusa qualquer arquivo com DROP/TRUNCATE — este banco
# é compartilhado com os outros sistemas da empresa.
#
# Roda ANTES do `up` de propósito: subindo com as tabelas faltando, a aplicação
# entra no ar quebrada e o erro só aparece quando alguém abre o relatório.
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

        echo
        run_migrations

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
