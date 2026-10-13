#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu server (e.g. Oracle Cloud Always Free).
# Usage on the server:
#   git clone https://github.com/<you>/social-media-agent.git && cd social-media-agent
#   bash deploy/setup.sh your-name.duckdns.org
set -euo pipefail

DOMAIN="${1:?Usage: bash deploy/setup.sh <your-domain, e.g. postpilot-api.duckdns.org>}"
cd "$(dirname "$0")"

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Opening ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images ship iptables rules that block everything except SSH.
if command -v iptables >/dev/null; then
  for port in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi
fi

echo "DOMAIN=$DOMAIN" > .env

if [ ! -f ../server/.env ]; then
  cp ../server/.env.example ../server/.env
  # Fresh encryption key for this server.
  KEY="$(openssl rand -base64 32)"
  sed -i "s#^TOKEN_ENCRYPTION_KEY=.*#TOKEN_ENCRYPTION_KEY=$KEY#" ../server/.env
  echo
  echo "Created server/.env with a new TOKEN_ENCRYPTION_KEY."
  echo "Now edit it (nano server/.env) to add your API keys and set:"
  echo "  SERVER_URL=https://<your-app>.vercel.app"
  echo "  CLIENT_URL=https://<your-app>.vercel.app"
  echo "Then run:  cd deploy && sudo docker compose up -d --build"
  exit 0
fi

echo "==> Building and starting Postpilot"
sudo docker compose up -d --build
echo
echo "Done. Check https://$DOMAIN/api/auth/me — it should reply {\"error\":\"Not logged in\"}."
