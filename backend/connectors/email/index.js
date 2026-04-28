// backend/connectors/email/index.js
//
// Email connector — SMTP send via nodemailer, IMAP read via imapflow.
//
// Auth model: BYO mailbox credentials (host + user + password / app
// password). Stored encrypted per-wallet in connector_credentials with
// payload shape:
//   {
//     smtp: { host, port, secure, user, pass },
//     imap: { host, port, secure, user, pass }
//   }
//
// Both libraries are lazy-required so the backend boots fine without
// them; the connector throws EMAIL_DEP_MISSING if a caller invokes
// before they're installed.
//
// Production deployers wanting email need:
//   npm install nodemailer imapflow

const credentialStore = require("../credentialStore");

function _lazy(name) {
  try { return require(name); }
  catch {
    const err = new Error(`email: ${name} not installed. Run \`npm install ${name}\` on the backend host.`);
    err.code = "EMAIL_DEP_MISSING";
    throw err;
  }
}

async function _creds(wallet) {
  if (!wallet || wallet === "platform") {
    throw new Error("email: per-wallet creds required (no platform mailbox)");
  }
  const row = await credentialStore.getDecrypted({ wallet, connector: "email" }).catch(() => null);
  if (!row?.payload) throw new Error("email: connect mailbox first via /api/connectors/email/connect");
  return row.payload;
}

async function send({ wallet, to, subject, text, html, replyTo }) {
  if (!to || !subject || !(text || html)) {
    throw new Error("send: { to, subject, text|html } required");
  }
  const { smtp } = await _creds(wallet);
  if (!smtp?.host) throw new Error("send: smtp config missing in credentials");
  const nm = _lazy("nodemailer");
  const transporter = nm.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure ?? (smtp.port === 465),
    auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    return await transporter.sendMail({
      from: smtp.user,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      text,
      html,
      replyTo,
    });
  } finally {
    transporter.close();
  }
}

async function listInbox({ wallet, mailbox = "INBOX", limit = 20, since }) {
  const { imap } = await _creds(wallet);
  if (!imap?.host) throw new Error("list_inbox: imap config missing in credentials");
  const { ImapFlow } = _lazy("imapflow");
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port || 993,
    secure: imap.secure ?? true,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });
  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const search = since ? { since: new Date(since) } : { all: true };
      const uids = await client.search(search, { uid: true });
      const slice = uids.slice(-Math.min(100, Math.max(1, limit))).reverse();
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: false, uid: true }, { uid: true });
        if (!msg) continue;
        out.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || null,
          from: msg.envelope?.from?.[0]?.address || null,
          date: msg.envelope?.date || null,
          messageId: msg.envelope?.messageId || null,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { mailbox, count: out.length, messages: out };
}

async function getThread({ wallet, mailbox = "INBOX", uid }) {
  if (!uid) throw new Error("get_thread: { uid } required");
  const { imap } = await _creds(wallet);
  const { ImapFlow } = _lazy("imapflow");
  const { simpleParser } = _lazy("mailparser");
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port || 993,
    secure: imap.secure ?? true,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(uid, { envelope: true, source: true, uid: true }, { uid: true });
      if (!msg) throw new Error("get_thread: message not found");
      const parsed = await simpleParser(msg.source);
      return {
        uid: msg.uid,
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to?.text,
        date: parsed.date,
        text: parsed.text,
        html: parsed.html || null,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  const wallet = ctx.wallet;
  switch (action) {
    case "send":       return send({ wallet, ...params });
    case "list_inbox": return listInbox({ wallet, ...params });
    case "get_thread": return getThread({ wallet, ...params });
    default: throw new Error(`email connector: unknown action ${action}`);
  }
}

module.exports = {
  name: "email",
  capabilities: ["read", "write", "monitor"],
  // BYO mailbox quotas vary wildly. Most providers (Gmail, SES, Postmark)
  // enforce per-day caps in the high-thousands; per-second varies. Set a
  // conservative outbound budget that won't trip a typical provider's
  // anti-spam heuristic.
  rate_limits: { per_minute: 10, per_hour: 100, scope: "wallet" },
  auth_method: "byo_account",
  invoke,
};
