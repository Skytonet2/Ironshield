// bot/utils/formatter.js

// Escape special chars for Telegram Markdown v1 (_*`[)
const esc = (text) => String(text || "").replace(/([_*`\[])/g, "\\$1");

const trustColor = (score) => {
  if (score >= 75) return "🟢";
  if (score >= 50) return "🟡";
  return "🔴";
};

const verdictEmoji = (verdict) => {
  switch (verdict) {
    case "VERIFIED":         return "✅";
    case "FALSE":            return "❌";
    case "PARTIALLY_FALSE":  return "⚠️";
    default:                 return "❓";
  }
};

module.exports = {

  formatResearch(data) {
    if (!data) return "⚠️ No research data returned.";
    const m = data.metrics || {};
    const overview = data.overview ? esc(data.overview.split(".")[0]) : "Unknown";
    const lines = [
      `🔍 *Research: ${overview}*`,
      `━━━━━━━━━━━━━━━━━━`,
      `📊 *Metrics*`,
      m.price       ? `• Price: \`${m.price}\``             : null,
      m.marketCap   ? `• Market Cap: \`${m.marketCap}\``    : null,
      m.volume24h   ? `• 24h Volume: \`${m.volume24h}\``    : null,
      m.holders     ? `• Holders: \`${m.holders}\``         : null,
      m.liquidityLocked !== undefined ? `• Liquidity Locked: ${m.liquidityLocked ? "✅" : "❌"}` : null,
      m.auditStatus ? `• Audit: \`${m.auditStatus}\``       : null,
      ``,
    ].filter(Boolean);

    if (data.risks?.length) {
      lines.push(`⚠️ *Risks*`);
      data.risks.slice(0, 4).forEach(r => lines.push(`• ${esc(r)}`));
      lines.push(``);
    }

    if (data.redFlags?.length) {
      lines.push(`🚩 *Red Flags*`);
      data.redFlags.slice(0, 3).forEach(f => lines.push(`• ${esc(f)}`));
      lines.push(``);
    }

    if (data.trustScore !== undefined) {
      lines.push(`${trustColor(data.trustScore)} *Trust Score: ${data.trustScore}/100*`);
    }

    if (data.sources?.length) {
      lines.push(`\n🔗 Sources: ${data.sources.join(" | ")}`);
    }

    return lines.join("\n");
  },

  formatSummary(data) {
    if (!data) return "⚠️ No summary data returned.";
    const lines = [
      `📋 *${esc(data.title || "Group Analysis")}*`,
      `━━━━━━━━━━━━━━━━━━`,
    ];

    // Group overview (new intelligence fields)
    const go = data.groupOverview;
    if (go) {
      lines.push(`📊 *Group Overview*`);
      if (go.activityLevel) lines.push(`• Activity: ${esc(go.activityLevel)}`);
      if (go.signalQuality) lines.push(`• Signal Quality: ${esc(go.signalQuality)}`);
      if (go.keyParticipants?.length) lines.push(`• Key Voices: ${go.keyParticipants.map(p => esc(p)).join(", ")}`);
      lines.push(``);
    }

    if (data.keyPoints?.length) {
      lines.push(`📌 *Key Points*`);
      data.keyPoints.slice(0, 5).forEach(p => lines.push(`• ${esc(p)}`));
      lines.push(``);
    }

    if (data.keyNarratives?.length) {
      lines.push(`🧭 *Key Narratives:* ${data.keyNarratives.map(n => esc(n)).join(", ")}`);
      lines.push(``);
    }

    // Alpha findings (new intelligence fields)
    if (data.alphaFindings?.length) {
      lines.push(`🎯 *Alpha Findings*`);
      data.alphaFindings.slice(0, 5).forEach(a => {
        const conv = a.conviction ? ` (${esc(a.conviction)})` : "";
        lines.push(`• ${esc(a.token || a)}${conv}${a.why ? " — " + esc(a.why) : ""}`);
      });
      lines.push(``);
    }

    if (data.tokensMentioned?.length) {
      lines.push(`🪙 *Tokens Mentioned:* ${data.tokensMentioned.map(t => esc(t)).join(", ")}`);
    }

    if (data.redFlags?.length) {
      lines.push(`🚩 *Red Flags*`);
      data.redFlags.forEach(f => lines.push(`• ${esc(f)}`));
      lines.push(``);
    }

    if (data.actionableInsights?.length) {
      lines.push(`⚡ *Insights*`);
      data.actionableInsights.forEach(i => lines.push(`• ${esc(i)}`));
    }

    if (data.confidenceLevel) {
      lines.push(``);
      lines.push(`🔒 *Confidence:* ${esc(data.confidenceLevel)}`);
    }

    return lines.join("\n");
  },

  formatVerify(data) {
    if (!data) return "⚠️ No verification data returned.";
    const verdict = data.verdict || "INSUFFICIENT_EVIDENCE";
    const emoji = verdict === "TRUE" ? "✅" : verdict === "FALSE" ? "❌" : verdict === "MISLEADING" ? "⚠️" : "❓";
    const conf  = data.overallConfidence ? `${Math.round(data.overallConfidence * 100)}%` : "—";
    const lines = [
      `${emoji} *Fact Check*`,
      `━━━━━━━━━━━━━━━━━━`,
      `*Verdict: ${esc(verdict)}*`,
      `Confidence: ${conf}`,
    ];

    if (data.explanation) {
      lines.push(``);
      lines.push(`${esc(data.explanation)}`);
    }

    if (data.breakdown?.length) {
      lines.push(``);
      lines.push(`📋 *Breakdown*`);
      data.breakdown.forEach(b => {
        const icon = b.result === "TRUE" ? "✅" : b.result === "FALSE" ? "❌" : b.result === "MISLEADING" ? "⚠️" : "❓";
        lines.push(`${icon} *${esc(b.claim)}*`);
        if (b.detail) lines.push(`   ${esc(b.detail)}`);
        if (b.source) lines.push(`   Source: ${esc(b.source)}`);
        lines.push(``);
      });
    }

    return lines.join("\n");
  },

  formatPortfolio(data) {
    if (!data) return "⚠️ No portfolio data. Add a wallet first: /portfolio add 0x...";

    const change = data.change24hUSD >= 0
      ? `📈 +$${Math.abs(data.change24hUSD).toFixed(2)} (${data.change24hPct})`
      : `📉 -$${Math.abs(data.change24hUSD).toFixed(2)} (${data.change24hPct})`;

    const lines = [
      `💼 *Your Portfolio*`,
      `━━━━━━━━━━━━━━━━━━`,
      `💰 *Total: $${(data.totalNetWorthUSD || 0).toLocaleString()}*`,
      `${change}`,
      ``,
    ];

    (data.wallets || []).forEach((w, i) => {
      lines.push(`🔑 *Wallet ${i + 1}:* \`${w.address.slice(0, 8)}...${w.address.slice(-6)}\``);
      lines.push(`   Chain: ${w.chain} · Value: $${(w.balanceUSD || 0).toLocaleString()}`);
      (w.tokens || []).slice(0, 3).forEach(tok => {
        lines.push(`   • ${tok.symbol}: ${tok.amount} → $${(tok.valueUSD || 0).toLocaleString()}`);
      });
      if (w.riskFlags?.length) lines.push(`   ⚠️ ${w.riskFlags.join(", ")}`);
      lines.push(``);
    });

    if (!data.wallets?.length) {
      lines.push(`No wallets tracked yet.\nAdd one: /portfolio add 0xYourAddress`);
    }

    lines.push(`_Updated just now_`);
    return lines.join("\n");
  },

  formatAlert(data) {
    return `🚨 *IronClaw Alert*\n\n${data.message || "Something needs your attention."}`;
  },

  formatError(message) {
    return `⚠️ ${message || "Something went wrong. Please try again."}`;
  },
};
