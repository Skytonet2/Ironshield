# Email connector — compliance posture

## Auth model
**BYO mailbox.** The user supplies SMTP + IMAP credentials for a mailbox they control. Stored encrypted per-wallet in `connector_credentials` (AES-256-GCM under `CUSTODIAL_ENCRYPT_KEY`) with payload shape:
```
{
  smtp: { host, port, secure, user, pass },
  imap: { host, port, secure, user, pass }
}
```
We never log in to a shared platform mailbox on behalf of the user.

## ToS posture
- Standard SMTP / IMAP — both protocols are user-authenticated and the user has authorized us via the connect flow.
- For Gmail: the user must use an [App Password](https://myaccount.google.com/apppasswords) or OAuth 2.0 (only password auth wired in v1; OAuth follow-up).
- We **do not** bulk-send: per-wallet caps `per_minute: 10, per_hour: 100`.
- We honour CAN-SPAM / GDPR boilerplate requirements: every outbound message includes the user's own from-address; if the user is sending marketing-shaped content, they must include their own unsubscribe link — we do not auto-inject one (we'd be impersonating the user otherwise).
- We do not auto-reply to every inbox message. Replies happen only from a Kit's explicit outreach action.

## Runtime dependencies
Lazy-required:
- `nodemailer` — SMTP send.
- `imapflow` — IMAP read.
- `mailparser` — used by `get_thread` to parse RFC822.

If any are missing, the relevant action throws `EMAIL_DEP_MISSING` with an install hint. The backend boots fine without them.

Install on the host:
```
npm install nodemailer imapflow mailparser
```

## Rate limits
- `per_minute: 10, per_hour: 100`, wallet-scoped. Per_hour binds at ~1.6/min sustained.
- Conservative because most provider anti-spam heuristics react to **bursty** patterns more than absolute volume; staying under 100/hour from a single user mailbox is normal-human territory.
- For platform-scale ESPs (SES, SendGrid), the user should use that provider's own SMTP relay credentials and the cap above is comfortably inside any reasonable plan.

## Failure modes
| Symptom | Likely cause | Recovery |
|---|---|---|
| `EAUTH` from nodemailer | wrong password / app-password not enabled / 2FA without app password | re-run /connect with corrected creds |
| `EENVELOPE` / 550 | recipient rejected — bad address, invalid domain, blocked | surface to caller; do not retry |
| `421 4.7.0` from Gmail SMTP | rate limit / suspicious activity | back off this wallet for ≥1h |
| IMAP `getMailboxLock` timeout | concurrent fetch from another client / mailbox busy | the connector serialises per-wallet via the rate hub; if it still fails the user has another live IMAP session |
| `get_thread` returns null body | `source: true` fetch denied by provider | some providers limit raw RFC822 fetch — check provider docs |

## PII / data handling
- Mailbox credentials are encrypted at rest. Decrypt path runs server-side only inside the connector.
- Message bodies (text, html) are returned to the calling Kit and persisted only inside that Kit's mission audit log, not as a global table.
- We do not parse email for analytics or training data.
- Subject lines may appear in error logs at the connector boundary; bodies do not.

## Known gaps
- No OAuth 2.0 flow for Gmail / Outlook (password-auth only). Adds complexity per provider; deferred until a Kit needs it.
- No DKIM/SPF check on inbound messages — caller decides how to treat unsigned mail.
- No rate-limit awareness of provider-specific heuristics (bursts vs. steady) — we just use the hub's smooth bucket.
- `get_thread` fetches one message at a time. Real "thread" reconstruction (References / In-Reply-To traversal) is a follow-up — current shape returns a single message addressed by UID.
