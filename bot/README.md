# AZUKA Bot — Deployment Guide

## Quick Start (5 minutes on a $5/mo VPS)

### 1. Get a VPS
Any provider works. Recommended cheap options:
- **Hetzner** — $4.50/mo (CX22, 2 vCPU, 4GB RAM)
- **DigitalOcean** — $6/mo (Basic, 1 vCPU, 1GB RAM)
- **Vultr** — $5/mo (Cloud Compute, 1 vCPU, 1GB RAM)

Choose **Ubuntu 22.04** or **Debian 12**.

### 2. SSH into your VPS and run the setup
```bash
ssh root@your-server-ip
curl -O https://raw.githubusercontent.com/user/ironshield/main/bot/setup.sh
chmod +x setup.sh
sudo bash setup.sh
```

Or if you have the repo cloned:
```bash
cd bot/
sudo bash setup.sh
```

### 3. Add your API keys
```bash
nano /opt/ironclaw/.env
```

Replace these two placeholders:
- `GEMINI_API_KEY` — Get free from https://aistudio.google.com/apikey
- `NEARAI_API_KEY` — Get from https://app.near.ai (login with ironshield.near)

### 4. Start the bot
```bash
systemctl start ironclaw
```

### 5. Verify
```bash
# Check status
systemctl status ironclaw

# Watch live logs
journalctl -u ironclaw -f
```

Then message @heyAzuka_bot on Telegram — it should respond!

## Architecture

```
Telegram → @heyAzuka_bot
              ↓ (polling)
         IronClaw Runtime (Rust)
              ↓
         Google Gemini (2M token context)
              ↓
         PostgreSQL (memory + vector search)
```

## Configuration Files

| File | Purpose |
|------|---------|
| `/opt/ironclaw/.env` | API keys, database, bot token |
| `/root/.ironclaw/channels/telegram.capabilities.json` | Telegram channel config |
| `/root/.ironclaw/identity/identity.md` | Bot personality and instructions |
| `/etc/systemd/system/ironclaw.service` | Systemd service definition |

## Useful Commands

```bash
# Start/stop/restart
systemctl start ironclaw
systemctl stop ironclaw
systemctl restart ironclaw

# View logs
journalctl -u ironclaw -f

# Edit bot personality
nano /root/.ironclaw/identity/identity.md

# Edit environment
nano /opt/ironclaw/.env
# After editing: systemctl restart ironclaw

# Update IronClaw
cd /opt/ironclaw/ironclaw-src
git pull
cargo build --release
cp target/release/ironclaw /usr/local/bin/ironclaw
systemctl restart ironclaw
```

## Switching to Webhook Mode (optional, for instant responses)

If you want sub-second message delivery instead of polling:

```bash
# Install cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
apt install cloudflared

# Create tunnel
cloudflared tunnel --url http://localhost:8080
# Copy the tunnel URL, then:

nano /opt/ironclaw/.env
# Change: TELEGRAM_DELIVERY=webhook
# Add:    TUNNEL_URL=https://your-tunnel-url.trycloudflare.com

systemctl restart ironclaw
```
