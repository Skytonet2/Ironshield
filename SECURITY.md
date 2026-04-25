# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in IronShield, please **do not file a public GitHub issue**. Instead, email:

**olarewajuoluwaseyifavour@gmail.com**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (PoC code or transaction hashes welcome)
- The affected component (smart contract, backend, frontend, agent runtime, Telegram bot)
- Your suggested remediation if you have one

## Scope

In scope:
- Smart contracts deployed to `ironshield.near` and sub-accounts
- Backend services (Express API, governance listener, Telegram bot)
- Frontend (Next.js app at https://ironshield.pages.dev)
- Agent runtime integration (NEAR AI connector)

Out of scope:
- IronClaw runtime itself — report to https://github.com/nearai/ironclaw
- NEAR Protocol core — report to NEAR Foundation
- Issues already documented in our public sprint plan

## Response timeline

- **48 hours** — initial acknowledgement
- **7 days** — triage complete, severity assessed, fix ETA shared
- **90 days** — public disclosure window (negotiable for critical findings affecting funds)

## Recognition

We do not currently run a bug bounty. Researchers who responsibly disclose valid findings will be credited in release notes (with their permission) and prioritized for inclusion in the future bounty program once $IRONCLAW launches.

Thank you for helping keep IronShield safe.
