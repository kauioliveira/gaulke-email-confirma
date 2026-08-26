#!/usr/bin/env bash
set -Eeuo pipefail

# Este script vive em shell/, mas o build acontece na RAIZ do repositorio: e la
# que estao Dockerfile, docker-compose.yml e .env.production. Sem este cd, rodar
# "bash shell/build-image-production.sh" de qualquer outro lugar falharia (ou,
# pior, buildaria o contexto errado).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

clear
rm -rf dist-docker*

APP_NAME="gaulke-email-confirma"

# exec.sh mora junto deste script, em shell/. Ele e copiado para o pacote e roda
# NO SERVIDOR, ao lado do .tar e do docker-compose.yml.
EXEC_SCRIPT="${SCRIPT_DIR}/exec.sh"
IMAGE_NAME="${APP_NAME}:latest"
TAR_NAME="${APP_NAME}__NEW.tar"

# ============================================================
# DESTINOS E PORTAS
# ============================================================
# Ficam em shell/deploy.conf para nao ser preciso editar este script quando
# mudar a porta ou o servidor. Os valores abaixo sao apenas o fallback de
# quem clonar o repositorio sem o arquivo.
HOMOLOG_USER="root"
HOMOLOG_HOST="192.168.0.10"
HOMOLOG_DIR="/homologa/${APP_NAME}"
HOMOLOG_PORT="8551"

PRODUCTION_USER="gaulke"
PRODUCTION_HOST="192.168.0.204"
PRODUCTION_DIR="/home/gaulke/${APP_NAME}-main"
PRODUCTION_PORT="8551"

DEPLOY_CONF="${SCRIPT_DIR}/deploy.conf"
if [[ -f "$DEPLOY_CONF" ]]; then
    # shellcheck source=/dev/null
    source "$DEPLOY_CONF"
fi

HOMOLOG_EXPORT_DIR="dist-docker-homolog"
PRODUCTION_EXPORT_DIR="dist-docker-production"

# Quando o envio e recusado, o pacote fica no disco para ser mandado a mao.
# Sem esta marca o `rm -rf dist-docker*` do fim apagaria justamente o que a
# mensagem acabou de prometer que estaria la.
MANTER_PACOTE="false"

confirm() {
    local message="$1"
    local response=""

    read -rp "${message} (s/N): " response
    [[ "$response" =~ ^[sS]$ ]]
}

require_file() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        echo "ERRO: arquivo '$file' não encontrado."
        exit 1
    fi
}

require_command() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "ERRO: comando '$command_name' não encontrado."
        exit 1
    fi
}

show_banner() {
    local environment="$1"
    local host="$2"
    local remote_dir="$3"

    echo
    echo "################################################################"
    echo "#                                                              #"
    printf "#  AMBIENTE: %-49s#\n" "$environment"
    printf "#  SERVIDOR: %-49s#\n" "$host"
    printf "#  DIRETÓRIO: %-48s#\n" "$remote_dir"
    echo "#                                                              #"
    echo "################################################################"
    echo
}

# ============================================================
# URL_ACESSO É A CONFIGURAÇÃO MAIS PERIGOSA DESTE SISTEMA
# ============================================================
# Ela monta os links ABSOLUTOS que vão dentro do e-mail: o botão de acesso, o
# pixel de abertura e a logo. Um cliente de e-mail não tem "site atual", então
# não existe caminho relativo que funcione.
#
# O erro é silencioso: o disparo dá tudo certo, os contadores sobem, e o
# problema só aparece na caixa de entrada do cliente — logo quebrada e botão
# que não abre. Por isso as checagens abaixo abortam o deploy, em vez de avisar.
validate_url_acesso() {
    local env_file="$1"
    local environment_label="$2"

    local url
    url="$(grep -E '^URL_ACESSO=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')"

    if [[ -z "$url" ]]; then
        echo "ERRO: URL_ACESSO está vazia em ${env_file}."
        echo "      Sem ela, nenhum link do e-mail funciona."
        exit 1
    fi

    if [[ "$url" =~ localhost|127\.0\.0\.1 ]]; then
        echo "ERRO: URL_ACESSO de ${environment_label} aponta para '${url}'."
        echo "      Destinatários externos não alcançam esse endereço."
        exit 1
    fi

    # Um caminho no fim (…/notifica) exige NUXT_APP_BASE_URL no BUILD, e este
    # script builda sem ele. Deixar passar geraria um pacote em que todo link
    # do e-mail cai em 404.
    local caminho
    caminho="$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^/]+##; s#/+$##')"

    if [[ -n "$caminho" ]]; then
        echo "ERRO: URL_ACESSO de ${environment_label} tem o subcaminho '${caminho}'."
        echo "      Este build serve na raiz do domínio (sem NUXT_APP_BASE_URL)."
        echo "      Use um subdomínio dedicado, ou builde com:"
        echo "        NUXT_APP_BASE_URL=${caminho}/ npm run build"
        exit 1
    fi

    echo "==> URL_ACESSO de ${environment_label}: ${url}"
}

# Nunca subir para produção com a senha e o segredo do ambiente de
# desenvolvimento: o .env fica no repositório da máquina do dev e já circulou.
validate_secrets() {
    local env_file="$1"
    local environment_label="$2"

    local faltando=""

    for chave in ADMIN_PASSWORD SESSION_SECRET DATABASE_URL; do
        local valor
        valor="$(grep -E "^${chave}=" "$env_file" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')"

        if [[ -z "$valor" ]]; then
            faltando="${faltando} ${chave}"
        fi
    done

    if [[ -n "$faltando" ]]; then
        echo "ERRO: variáveis vazias em ${env_file}:${faltando}"
        exit 1
    fi

    if [[ -f .env ]]; then
        local senha_prod senha_dev
        senha_prod="$(grep -E '^ADMIN_PASSWORD=' "$env_file" | head -1 | cut -d= -f2-)"
        senha_dev="$(grep -E '^ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)"

        if [[ -n "$senha_dev" && "$senha_prod" == "$senha_dev" ]]; then
            echo
            echo "ATENÇÃO: o ADMIN_PASSWORD de ${environment_label} é o MESMO do .env de desenvolvimento."
            echo

            if ! confirm "Continuar mesmo assim"; then
                exit 1
            fi
        fi
    fi
}

# Gera o ambiente de homologação num arquivo TEMPORÁRIO e ecoa o caminho.
#
# Antes isto escrevia por cima do .env.production do repositório e restaurava
# depois com um trap. Bastava o script morrer na hora errada — ou alguém mexer
# no arquivo no meio — para o arquivo de produção ser perdido. Nada aqui toca
# mais no .env.production real.
prepare_homolog_env() {
    require_file ".env"

    local arquivo
    arquivo="$(mktemp)"
    chmod 600 "$arquivo"
    cp .env "$arquivo"

    # O .env de desenvolvimento aponta para a máquina do dev. Copiado como está,
    # homologação mandaria e-mails com links para uma estação de trabalho — e o
    # erro só apareceria quando alguém clicasse no botão do e-mail.
    #
    # A porta vem de shell/deploy.conf, e não do .env: é a porta do SERVIDOR de
    # homologação, que nada tem a ver com a que o dev usa na própria máquina.
    local url="http://${HOMOLOG_HOST}:${HOMOLOG_PORT}"

    if grep -q "^URL_ACESSO=" "$arquivo"; then
        sed -i "s|^URL_ACESSO=.*|URL_ACESSO=${url}|" "$arquivo"
    else
        printf '\nURL_ACESSO=%s\n' "$url" >> "$arquivo"
    fi

    # o caminho volta pelo stdout; os avisos vao para o stderr para não sujá-lo
    echo "==> Apontando URL_ACESSO para ${url}" >&2
    printf '%s' "$arquivo"
}

# A porta do AMBIENTE sempre vence o que estiver escrito no .env.production.
# Sem isso, um arquivo copiado de outro servidor levaria a porta errada e o
# proxy reverso bateria num lugar onde nao ha nada escutando.
aplicar_porta() {
    local arquivo="$1"
    local porta="$2"

    if grep -q "^APP_HOST_PORT=" "$arquivo"; then
        sed -i "s|^APP_HOST_PORT=.*|APP_HOST_PORT=${porta}|" "$arquivo"
    else
        printf '\nAPP_HOST_PORT=%s\n' "$porta" >> "$arquivo"
    fi

    echo "==> Porta publicada no host: ${porta}"
}

# Avisa se a porta ja esta ocupada no servidor ANTES de mandar o pacote —
# descobrir isso depois do rsync custa uma rodada inteira de deploy.
conferir_porta_livre() {
    local remote="$1"
    local porta="$2"
    local environment_label="$3"

    local em_uso
    em_uso="$(ssh -o ConnectTimeout=8 "$remote" \
        "ss -ltn 2>/dev/null | grep -E '[:.]${porta}[[:space:]]' || true" 2>/dev/null || true)"

    if [[ -z "$em_uso" ]]; then
        echo "==> Porta ${porta} livre em ${environment_label}"
        return 0
    fi

    # O proprio app, ja rodando, ocupa a porta — isso e esperado num redeploy.
    local nosso
    nosso="$(ssh -o ConnectTimeout=8 "$remote" \
        "docker ps --filter name=${APP_NAME} --format '{{.Ports}}' 2>/dev/null | grep -c ':${porta}->' || true" 2>/dev/null || echo 0)"
    nosso="$(printf '%s' "$nosso" | tr -d '[:space:]')"

    if [[ "${nosso:-0}" != "0" ]]; then
        echo "==> Porta ${porta} esta com o proprio ${APP_NAME} (redeploy normal)"
        return 0
    fi

    echo
    echo "ATENÇÃO: a porta ${porta} ja esta em uso em ${environment_label} por outro processo:"
    printf '%s\n' "$em_uso" | sed 's/^/           /'
    echo "         Ajuste a porta em shell/deploy.conf (opcao 3 lista o que esta ocupado)."
    echo

    confirm "Continuar mesmo assim"
}

prepare_package() {
    local export_dir="$1"
    local environment_label="$2"
    local env_file="$3"

    echo "==> Preparando pacote de ${environment_label}"
    rm -rf "$export_dir"
    mkdir -p "$export_dir"

    docker save -o "${export_dir}/${TAR_NAME}" "$IMAGE_NAME"

    cp docker-compose.yml "$export_dir/"
    cp "$EXEC_SCRIPT" "$export_dir/"
    cp "$env_file" "${export_dir}/.env.production"
    chmod 600 "${export_dir}/.env.production"
}

deploy_environment() {
    local environment_label="$1"
    local remote_user="$2"
    local remote_host="$3"
    local remote_dir="$4"
    local export_dir="$5"
    local porta="$6"
    local env_file="$7"

    local remote="${remote_user}@${remote_host}"

    show_banner "$environment_label" "$remote_host" "$remote_dir"

    require_file "docker-compose.yml"
    require_file "$EXEC_SCRIPT"
    require_file "$env_file"

    # LEITURA APENAS: o arquivo de origem nunca é modificado. A porta é
    # aplicada mais adiante, na CÓPIA que vai dentro do pacote.
    validate_url_acesso "$env_file" "$environment_label"
    validate_secrets "$env_file" "$environment_label"

    echo "==> Limpando artefatos locais anteriores"
    rm -rf .output dist

    # SEM NUXT_APP_BASE_URL: o app serve na raiz do domínio (subdomínio próprio).
    # Se um dia for para subpasta, o prefixo tem que entrar AQUI, no build —
    # os caminhos dos assets são gravados dentro do bundle, não resolvidos em
    # tempo de execução.
    echo "==> Buildando imagem Docker para ${environment_label}: ${IMAGE_NAME}"
    docker build -t "$IMAGE_NAME" .

    prepare_package "$export_dir" "$environment_label" "$env_file"
    aplicar_porta "${export_dir}/.env.production" "$porta"

    echo
    echo "Build de ${environment_label} concluído."
    echo "Pacote local: ${export_dir}/"
    echo "Imagem:        ${export_dir}/${TAR_NAME}"
    echo "Destino:       ${remote}:${remote_dir}/"

    if ! confirm "Enviar os arquivos para ${environment_label}"; then
        MANTER_PACOTE="true"
        echo
        echo "Deploy de ${environment_label} não executado."
        echo "O pacote permanece disponível em: ${export_dir}/"
        echo "Para enviar depois:"
        echo "  rsync -avh --progress ${export_dir}/ ${remote}:${remote_dir}/"
        return
    fi

    require_command "rsync"
    require_command "ssh"

    # A pasta pode não existir no primeiro deploy: o rsync falharia com
    # "No such file or directory" depois de já ter compactado o pacote.
    conferir_porta_livre "$remote" "$porta" "$environment_label" || {
        echo "Deploy cancelado."
        return
    }

    ssh "$remote" "mkdir -p '$remote_dir'"

    show_banner "ENVIANDO PARA ${environment_label}" "$remote_host" "$remote_dir"
    rsync -avh --progress "${export_dir}/" "${remote}:${remote_dir}/"

    if confirm "Aplicar agora em ${environment_label} executando 'bash exec.sh up'"; then
        show_banner "APLICANDO EM ${environment_label}" "$remote_host" "$remote_dir"

        # O exec.sh já roda as migrations antes de subir: são idempotentes e
        # tocam apenas tabelas sys_mail_*.
        ssh -t "$remote" \
            "cd '$remote_dir' && chmod 600 .env.production && bash exec.sh up"

        echo
        echo "Deploy aplicado com sucesso em ${environment_label}."
        echo
        echo "Confira o SMTP e a URL pública na barra do admin, ou por linha de comando:"
        echo "  ssh -t ${remote} \"cd '${remote_dir}' && bash exec.sh logs\""
    else
        echo
        echo "Arquivos enviados, mas a aplicação de ${environment_label} não foi atualizada."
        echo "Para aplicar depois:"
        echo "  ssh -t ${remote} \"cd '${remote_dir}' && bash exec.sh up\""
    fi

    if confirm "Abrir um terminal SSH em ${environment_label}"; then
        ssh -t "$remote" "cd '$remote_dir' && exec bash"
    fi
}

build_homolog() {
    show_banner "HOMOLOGAÇÃO" "$HOMOLOG_HOST" "$HOMOLOG_DIR"
    echo "Usuário remoto:       ${HOMOLOG_USER}"
    echo "Origem do ambiente:   .env (cópia temporária, o arquivo não é alterado)"
    echo "Arquivo enviado:      .env.production (gerado no pacote)"
    echo "URL_ACESSO vira:      http://${HOMOLOG_HOST}:${HOMOLOG_PORT}"
    echo

    local env_homolog
    env_homolog="$(prepare_homolog_env)"

    # o temporário some ao fim, dê certo ou não
    trap 'rm -f "$env_homolog"' EXIT INT TERM

    deploy_environment \
        "HOMOLOGAÇÃO" \
        "$HOMOLOG_USER" \
        "$HOMOLOG_HOST" \
        "$HOMOLOG_DIR" \
        "$HOMOLOG_EXPORT_DIR" \
        "$HOMOLOG_PORT" \
        "$env_homolog"

    rm -f "$env_homolog"
    trap - EXIT INT TERM
}

build_production() {
    show_banner "PRODUÇÃO" "$PRODUCTION_HOST" "$PRODUCTION_DIR"
    echo "Usuário remoto:       ${PRODUCTION_USER}"
    echo "Origem do ambiente:   .env.production"
    echo

    if [[ ! -f .env.production ]]; then
        echo "ERRO: .env.production não existe."
        echo "      Crie a partir do modelo:  cp .env.production.example .env.production"
        exit 1
    fi

    deploy_environment \
        "PRODUÇÃO" \
        "$PRODUCTION_USER" \
        "$PRODUCTION_HOST" \
        "$PRODUCTION_DIR" \
        "$PRODUCTION_EXPORT_DIR" \
        "$PRODUCTION_PORT" \
        ".env.production"
}

# Mostra o que ja escuta em cada servidor, para escolher uma porta livre sem
# precisar abrir um SSH a parte.
listar_portas() {
    require_command "ssh"

    for destino in \
        "HOMOLOGAÇÃO|${HOMOLOG_USER}@${HOMOLOG_HOST}|${HOMOLOG_PORT}" \
        "PRODUÇÃO|${PRODUCTION_USER}@${PRODUCTION_HOST}|${PRODUCTION_PORT}"
    do
        local rotulo="${destino%%|*}"
        local resto="${destino#*|}"
        local remote="${resto%%|*}"
        local porta="${resto##*|}"

        show_banner "PORTAS — ${rotulo}" "${remote#*@}" "porta configurada: ${porta}"

        if ! ssh -o ConnectTimeout=8 "$remote" "true" 2>/dev/null; then
            echo "  Não foi possível conectar em ${remote}."
            continue
        fi

        echo "  Portas TCP em escuta:"
        ssh -o ConnectTimeout=8 "$remote" \
            "ss -ltnH 2>/dev/null | awk '{print \$4}' | sed 's/.*[:.]//' | sort -n -u | tr '\n' ' '" \
            2>/dev/null | sed 's/^/    /'
        echo

        echo "  Containers Docker publicando portas:"
        ssh -o ConnectTimeout=8 "$remote" \
            "docker ps --format '{{.Names}}  {{.Ports}}' 2>/dev/null || echo '(docker indisponivel)'" \
            2>/dev/null | sed 's/^/    /'
        echo

        if ssh -o ConnectTimeout=8 "$remote" \
            "ss -ltn 2>/dev/null | grep -qE '[:.]${porta}[[:space:]]'" 2>/dev/null; then
            echo "  >> A porta ${porta} JA ESTA EM USO neste servidor."
        else
            echo "  >> A porta ${porta} esta livre."
        fi
        echo
    done

    echo "Para trocar, edite shell/deploy.conf."
}

main() {
    local option=""

    require_command "docker"
    require_file "Dockerfile"

    echo "============================================================"
    echo " BUILD E DEPLOY - ${APP_NAME}"
    echo "============================================================"
    echo
    echo "Este script NÃO executa o ambiente de desenvolvimento local."
    echo
    echo "  1) HOMOLOGAÇÃO"
    echo "     ${HOMOLOG_USER}@${HOMOLOG_HOST}:${HOMOLOG_DIR}"
    echo "     porta ${HOMOLOG_PORT}"
    echo
    echo "  2) PRODUÇÃO"
    echo "     ${PRODUCTION_USER}@${PRODUCTION_HOST}:${PRODUCTION_DIR}"
    echo "     porta ${PRODUCTION_PORT}"
    echo
    echo "  Portas e destinos ficam em shell/deploy.conf"
    echo
    echo "  3) Conferir portas em uso nos servidores"
    echo
    echo "  0) Sair"
    echo

    read -rp "Escolha o ambiente: " option

    case "$option" in
        1)
            build_homolog
            ;;
        2)
            build_production
            ;;
        3)
            listar_portas
            ;;
        0)
            echo "Operação cancelada."
            exit 0
            ;;
        *)
            echo "ERRO: opção inválida."
            exit 1
            ;;
    esac

    echo
    echo "Processo concluído."

    # O .tar tem centenas de MB: nao fica para tras sem motivo. A excecao e o
    # envio recusado, em que o pacote e o unico resultado util da execucao.
    if [[ "$MANTER_PACOTE" == "true" ]]; then
        echo "Pacote mantido no disco (envio recusado)."
    else
        rm -rf dist-docker*
    fi
}

main "$@"
