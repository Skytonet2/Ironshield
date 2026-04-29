// backend/services/pushNotify.js — Web Push helper
//
// Sends push notifications to all active subscriptions for a given user.
// Silently removes stale/expired subscriptions on 410 Gone or invalid errors.

const db = require("../db/client");
const feedHub = require("../ws/feedHub");

let webpush;
try {
  webpush = require("web-push");
  const publicKey  = process.env.VAPID_PUBLIC_KEY  || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (publicKey && privateKey) {
    webpush.setVapidDetails(
      "mailto:admin@ironshield.near.page",
      publicKey,
      privateKey
    );
  } else {
    console.warn("[push] VAPID keys not set — push notifications disabled");
    webpush = null;
  }
} catch (e) {
  console.warn("[push] web-push not available:", e.message);
  webpush = null;
}

/**
 * Send push notification to a user by their feed_users.id.
 * @param {number} userId - feed_users.id of recipient
 * @param {object} payload - { title, body, url?, tag?, actions? }
 */
async function notifyUser(userId, payload) {
  if (!webpush) return;
  try {
    const r = await db.query(
      "SELECT id, subscription FROM feed_push_subscriptions WHERE user_id = $1",
      [userId]
    );
    if (!r.rows.length) return;

    const data = JSON.stringify({
      title: payload.title || "AZUKA",
      body: payload.body || "",
      url: payload.url || "/",
      tag: payload.tag || "general",
      actions: payload.actions || [],
      kind: payload.kind || "general",
      conversationId: payload.conversationId,
    });

    // Calls need high urgency so push is delivered immediately even when the
    // device is dozing. Regular DMs use normal urgency.
    const options = payload.kind === "call"
      ? { urgency: "high", TTL: 60 }
      : { urgency: "normal", TTL: 3600 };

    const staleIds = [];
    await Promise.allSettled(
      r.rows.map(async (row) => {
        try {
          await webpush.sendNotification(JSON.parse(row.subscription), data, options);
        } catch (err) {
          const status = err?.statusCode || err?.status;
          if (status === 410 || status === 404 || /expired|unsubscribed/i.test(String(err))) {
            staleIds.push(row.id);
          }
        }
      })
    );

    if (staleIds.length) {
      await db.query(
        "DELETE FROM feed_push_subscriptions WHERE id = ANY($1)",
        [staleIds]
      );
    }
  } catch (e) {
    console.warn("[push] notifyUser error:", e.message);
  }
}

/**
 * Emit a feed_notification row AND push it to the user's device(s).
 * @param {object} opts - { userId, actorId?, postId?, type, body?, url? }
 */
async function createAndPush({ userId, actorId = null, postId = null, type, body, url }) {
  try {
    // 1. Insert notification row
    const inserted = await db.query(
      `INSERT INTO feed_notifications (user_id, type, actor_id, post_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [userId, type, actorId, postId]
    );

    // Live WS push to the recipient's authed sockets. Replaces the 30s
    // poll on /api/notifications. Carries the same field names the
    // /api/notifications response uses so the client store can prepend
    // without an extra fetch.
    try {
      const u = await db.query("SELECT wallet_address FROM feed_users WHERE id=$1", [userId]);
      const wallet = u.rows[0]?.wallet_address;
      if (wallet) {
        feedHub.publish(wallet, {
          type: "notification:new",
          notification: {
            id: inserted.rows[0]?.id,
            type,
            actor_id: actorId,
            post_id: postId,
            created_at: inserted.rows[0]?.created_at,
            read_at: null,
          },
        });
      }
    } catch { /* best-effort */ }

    // 2. Look up actor name for the push body
    let actorName = "Someone";
    if (actorId) {
      const a = await db.query("SELECT display_name, username FROM feed_users WHERE id=$1", [actorId]);
      if (a.rows[0]) actorName = a.rows[0].display_name || a.rows[0].username || "Someone";
    }

    // 3. Build push payload
    const MSGS = {
      like:    `${actorName} liked your post`,
      comment: `${actorName} commented on your post`,
      follow:  `${actorName} joined your squad`,
      repost:  `${actorName} reposted your post`,
      tip:     `${actorName} tipped your post`,
      mention: `${actorName} mentioned you`,
      room_invite: `${actorName} invited you to a room`,
      alpha:   `${actorName} called alpha on your room`,
    };

    const pushBody = body || MSGS[type] || `New ${type} notification`;
    const pushUrl  = url || (postId ? `/#/Feed?post=${postId}` : "/");

    await notifyUser(userId, {
      title: "AZUKA",
      body: pushBody,
      url: pushUrl,
      tag: type,
    });

    // 4. Telegram side-channel. Settings-key mapping: feed `type` →
    // per-user TG toggle. Unknown types fall through to the default
    // enabled state.
    try {
      const tg = require("./tgNotify");
      const keyMap = {
        like: "likes", comment: "comments", follow: "follows",
        repost: "reposts", tip: "tips", mention: "comments",
        room_invite: "dms", alpha: "alpha",
      };
      const settingKey = keyMap[type] || null;
      tg.notifyFeedUser(
        userId,
        settingKey,
        `🔔 *${pushBody}*\n[Open on AZUKA](https://ironshield.near.page${pushUrl})`,
      ).catch(() => {});
    } catch { /* bot token not set */ }
  } catch (e) {
    console.warn("[push] createAndPush error:", e.message);
  }
}

module.exports = { notifyUser, createAndPush };
