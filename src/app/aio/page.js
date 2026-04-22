"use client";
// /aio — the AIO Feed route. Wraps the new AppShell chrome around the
// live feed. Opens a WS to /ws/feed on mount; if the backend is
// offline (dev without `npm run backend`), the local seeder
// generates realistic events so the UI still has something to render.
// Card components land in Phase 4; today each event is a raw JSON row.

import { useEffect } from "react";
import { useTheme } from "@/lib/contexts";
import { useFeed } from "@/lib/stores/feedStore";
import AppShell from "@/components/shell/AppShell";
import * as wsClient from "@/lib/ws/wsClient";
import * as seeder from "@/lib/ws/seeder";
import CoinItButton from "@/components/feed/CoinItButton";

function YourDeploysPanel() {
  const t = useTheme();
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: t.textDim,
        fontWeight: 600,
        margin: "0 0 12px",
      }}>
        Your Deploys
      </h3>
      <div style={{
        fontSize: 12,
        color: t.textDim,
        lineHeight: 1.5,
        padding: 12,
        border: `1px dashed ${t.border}`,
        borderRadius: 8,
      }}>
        You haven't launched a token yet. Hit <strong style={{ color: t.accent }}>CREATE</strong> in
        the top nav to pick a chain + launchpad.
      </div>
    </div>
  );
}

function FeedEmpty() {
  const t = useTheme();
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: 8,
      color: t.textDim,
      fontSize: 13,
      padding: 40,
      textAlign: "center",
    }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>⚡</div>
      <div style={{ color: t.textMuted, fontWeight: 500 }}>Feed is quiet</div>
      <div>Trackers haven't fired anything yet. The WebSocket stream lights up in the next build phase.</div>
    </div>
  );
}

export default function AioPage() {
  const t = useTheme();
  const items = useFeed((s) => s.items);

  useEffect(() => {
    // Connect the singleton WS (public subscription — every tracker).
    // If the backend is unreachable, the wsClient will keep retrying
    // with exponential backoff while the seeder keeps the UI alive
    // in development. The seeder is a no-op in production builds.
    wsClient.connect({
      trackers: ["ca", "x", "dex", "near", "telegram", "news",
                 "ironclaw", "newpair", "wallet", "trade"],
    });
    seeder.start();
    return () => {
      seeder.stop();
      // Leave the socket open — another page in the same tab might
      // want it. wsClient.disconnect() is only for explicit sign-out.
    };
  }, []);

  return (
    <AppShell rightPanel={<YourDeploysPanel />}>
      <div style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "16px 20px",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${t.border}`,
          paddingBottom: 12,
          marginBottom: 12,
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: t.text, margin: 0 }}>
            AIO Feed
          </h2>
          <span style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--accent-dim)",
            color: t.accent,
          }}>
            Live
          </span>
        </div>
        {items.length === 0 ? <FeedEmpty /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((ev, i) => (
              <div
                key={ev.id}
                className="feed-item-enter"
                style={{
                  "--index": i,
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${t.border}`,
                  background: "var(--bg-card)",
                  fontSize: 13,
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  color: t.textDim,
                  marginBottom: 4,
                }}>
                  <span style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "var(--accent-dim)",
                    color: t.accent,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}>
                    {ev.type}
                  </span>
                  {ev.source && <span>{ev.source}</span>}
                  <span style={{ flex: 1 }} />
                  {/* Coin It is offered on anything we have enough
                   * context to name — CA detections, news headlines,
                   * X posts. DEX pairs already exist as tokens; skip. */}
                  {["ca", "news", "x", "newpair"].includes(ev.type) && (
                    <CoinItButton
                      sourceType={ev.type === "news" ? "news" : "external"}
                      sourceUrl={ev.data?.url || null}
                      sourceText={
                        ev.data?.headline ||
                        ev.data?.text ||
                        ev.data?.ticker ||
                        ""
                      }
                      suggestedName={ev.data?.headline || ev.data?.ticker || ""}
                      suggestedTicker={ev.data?.ticker || ""}
                    />
                  )}
                </div>
                <div style={{ color: t.text }}>
                  {JSON.stringify(ev.data).slice(0, 200)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
