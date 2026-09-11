#!/usr/bin/env bash
# Deploy do Calenday. Rode a partir da pasta do projeto, na SUA máquina.
#
#   ./deploy.sh usuario@servidor [caminho-remoto]
#
# O que ele faz: envia os arquivos, instala dependências, e reinicia o serviço.
# Não toca no .env nem no banco de dados do servidor.

set -euo pipefail

HOST="${1:?Uso: ./deploy.sh usuario@servidor [caminho-remoto]}"
REMOTE_DIR="${2:-/var/www/calenday}"
SERVICE="${SERVICE:-calenday}"

echo "==> Enviando arquivos para $HOST:$REMOTE_DIR"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'db/*.db*' \
  --exclude 'uploads/*' \
  --exclude '.git' \
  --exclude 'deploy.sh' \
  ./ "$HOST:$REMOTE_DIR/"

echo "==> Instalando dependências e reiniciando"
ssh "$HOST" bash -s << REMOTE
set -euo pipefail
cd "$REMOTE_DIR"

if [ ! -f .env ]; then
  echo "ERRO: .env não existe em $REMOTE_DIR."
  echo "Crie a partir do .env.example antes do primeiro deploy."
  exit 1
fi

npm install --omit=dev --no-audit --no-fund

mkdir -p uploads db
# ajusta o dono só se o serviço rodar como www-data
if id www-data >/dev/null 2>&1; then
  sudo chown -R www-data:www-data uploads db || true
fi

if systemctl list-unit-files | grep -q "^$SERVICE.service"; then
  sudo systemctl restart "$SERVICE"
  sleep 2
  systemctl is-active --quiet "$SERVICE" && echo "OK: serviço ativo" || {
    echo "FALHOU. Últimas linhas do log:"; journalctl -u "$SERVICE" -n 30 --no-pager; exit 1; }
else
  echo "AVISO: serviço $SERVICE não existe ainda. Veja o README para criá-lo."
fi
REMOTE

echo "==> Deploy concluído"
