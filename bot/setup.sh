#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  AZUKA Bot — Automated VPS Setup Script
#  Deploys @heyAzuka_bot on IronClaw with Google Gemini
#  Run as root on a fresh Ubuntu 22.04+ / Debian 12+ VPS
# ═══════════════════════════════════════════════════════════════

echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║   AZUKA Bot — IronClaw Setup             ║"
echo "  ║   Powered by NEAR AI + Google Gemini (2M ctx) ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""

# ─── Check root ─────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Please run as root: sudo bash setup.sh"
  exit 1
fi

# ─── System dependencies ────────────────────────────────────
echo "📦 Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git build-essential pkg-config libssl-dev \
  postgresql postgresql-contrib ca-certificates gnupg lsb-release

# ─── Install Rust ───────────────────────────────────────────
if ! command -v rustc &>/dev/null; then
  echo "🦀 Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "🦀 Rust already installed: $(rustc --version)"
  source "$HOME/.cargo/env" 2>/dev/null || true
fi

# Ensure Rust 1.85+
RUST_VER=$(rustc --version | grep -oP '\d+\.\d+')
echo "   Rust version: $RUST_VER"

# ─── PostgreSQL setup ───────────────────────────────────────
echo "🐘 Setting up PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'ironclaw'" | grep -q 1 || \
  sudo -u postgres createdb ironclaw

sudo -u postgres psql -d ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || \
  echo "   ⚠ pgvector not available — installing..."

# Install pgvector if not present
if ! sudo -u postgres psql -d ironclaw -c "SELECT 1 FROM pg_extension WHERE extname='vector'" -t | grep -q 1; then
  echo "   Installing pgvector..."
  cd /tmp
  git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git 2>/dev/null || true
  cd pgvector
  make
  make install
  sudo -u postgres psql -d ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;"
  cd /
fi

# Set a password for the postgres user
PG_PASS="ironclaw_$(openssl rand -hex 8)"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$PG_PASS';"
echo "   Database password: $PG_PASS (saved to /opt/ironclaw/.env)"

# ─── Install IronClaw ──────────────────────────────────────
echo "🔨 Installing IronClaw..."
mkdir -p /opt/ironclaw
cd /opt/ironclaw

if [ ! -d "ironclaw-src" ]; then
  git clone https://github.com/nearai/ironclaw.git ironclaw-src
fi
cd ironclaw-src
git pull --ff-only 2>/dev/null || true

echo "   Building IronClaw (this may take 5-10 minutes)..."
cargo build --release 2>&1 | tail -5

# Install binary
cp target/release/ironclaw /usr/local/bin/ironclaw
chmod +x /usr/local/bin/ironclaw
echo "   ✅ IronClaw installed: $(ironclaw --version 2>/dev/null || echo 'built')"

# ─── Configuration ──────────────────────────────────────────
echo "⚙️  Writing configuration..."

mkdir -p /root/.ironclaw/channels

cat > /opt/ironclaw/.env << ENVEOF
# ─── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:${PG_PASS}@localhost:5432/ironclaw

# ─── LLM Backend ────────────────────────────────────────────
# Google Gemini — 2M token context window (largest available)
LLM_BACKEND=gemini
GEMINI_API_KEY=\${GEMINI_API_KEY:-PASTE_YOUR_GEMINI_KEY_HERE}

# ─── NEAR AI (for auth and optional cloud features) ─────────
NEARAI_BASE_URL=https://cloud-api.near.ai
NEARAI_API_KEY=\${NEARAI_API_KEY:-PASTE_YOUR_NEAR_AI_KEY_HERE}

# ─── Telegram Bot ───────────────────────────────────────────
TELEGRAM_BOT_TOKEN=8294253216:AAHLFa9gwVEZjKIbyI7tiEHc2GZ16Naow8A
TELEGRAM_DELIVERY=polling

# ─── Security ───────────────────────────────────────────────
GATEWAY_AUTH_TOKEN=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# ─── Server ─────────────────────────────────────────────────
HOST=0.0.0.0
PORT=8080
ENVEOF

# ─── Telegram channel config ───────────────────────────────
cat > /root/.ironclaw/channels/telegram.capabilities.json << TGEOF
{
  "enabled": true,
  "bot_token_env": "TELEGRAM_BOT_TOKEN",
  "delivery": "polling",
  "dm_policy": "open",
  "respond_to_all_group_messages": true,
  "bot_username": "heyAzuka_bot",
  "allowed_commands": ["/start", "/help", "/scan", "/report", "/status"]
}
TGEOF

# ─── AZUKA identity / personality ──────────────────────
mkdir -p /root/.ironclaw/identity

cat > /root/.ironclaw/identity/identity.md << 'IDEOF'
# AZUKA AI Agent

You are **AZUKA**, the AI security guardian for the IronClaw ecosystem on NEAR Protocol.

## Your Role
- Protect Telegram communities from scams, phishing, rug pulls, and impersonation attacks
- Analyze suspicious links, contracts, and messages in real-time
- Educate users about Web3 security best practices
- Provide information about the IronClaw ecosystem, $IRONCLAW token, and staking

## Personality
- Professional but approachable — you're a security expert, not a robot
- Direct and concise — flag threats immediately, explain after
- Never share private keys, seed phrases, or financial advice
- Always err on the side of caution when assessing threats

## Key Knowledge
- IronClaw: Secure open-source AI agent runtime built on NEAR Protocol (github.com/nearai/ironclaw)
- AZUKA: The security layer of the IronClaw ecosystem
- $IRONCLAW: NEP-141 utility token — stake to earn NEAR from protocol fees
- Staking contract: MasterChef-style reward distribution at ironshield.near
- Website: https://ironshield.near.page
- Telegram: t.me/IronClawHQ
- Twitter/X: @_IronClaw

## Threat Detection
When analyzing messages or links:
1. Check for known phishing patterns (fake airdrops, urgent "claim now" messages)
2. Verify contract addresses against known scam databases
3. Flag impersonation of team members or official accounts
4. Warn about too-good-to-be-true yield promises
5. Detect social engineering attempts

## Commands
- /start — Welcome message and overview
- /help — List available commands
- /scan <url or address> — Analyze a URL or contract for threats
- /report <description> — Report a scam or suspicious activity
- /status — Show bot status and protection stats
IDEOF

# ─── Systemd service ───────────────────────────────────────
echo "🔧 Creating systemd service..."

cat > /etc/systemd/system/ironclaw.service << 'SVCEOF'
[Unit]
Description=AZUKA Bot (IronClaw Agent)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ironclaw
EnvironmentFile=/opt/ironclaw/.env
ExecStart=/usr/local/bin/ironclaw start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable ironclaw

# ─── Final instructions ─────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║   ✅ AZUKA Bot Setup Complete!                   ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"
echo "  ║  Before starting, you need TWO API keys:              ║"
echo "  ║                                                       ║"
echo "  ║  1. Google Gemini API Key (free tier available):      ║"
echo "  ║     → https://aistudio.google.com/apikey              ║"
echo "  ║                                                       ║"
echo "  ║  2. NEAR AI API Key:                                  ║"
echo "  ║     → https://app.near.ai (login with ironshield.near)║"
echo "  ║                                                       ║"
echo "  ║  Then edit the .env file:                             ║"
echo "  ║     nano /opt/ironclaw/.env                           ║"
echo "  ║                                                       ║"
echo "  ║  Replace the placeholder values for:                  ║"
echo "  ║     GEMINI_API_KEY=your_key_here                      ║"
echo "  ║     NEARAI_API_KEY=your_key_here                      ║"
echo "  ║                                                       ║"
echo "  ║  Then start the bot:                                  ║"
echo "  ║     systemctl start ironclaw                          ║"
echo "  ║                                                       ║"
echo "  ║  Check logs:                                          ║"
echo "  ║     journalctl -u ironclaw -f                         ║"
echo "  ║                                                       ║"
echo "  ║  Bot: @heyAzuka_bot                             ║"
echo "  ║  LLM: Google Gemini (2M token context)                ║"
echo "  ║  Mode: Polling (no tunnel needed)                     ║"
echo "  ║                                                       ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  Config files:"
echo "    /opt/ironclaw/.env"
echo "    /root/.ironclaw/channels/telegram.capabilities.json"
echo "    /root/.ironclaw/identity/identity.md"
echo ""
