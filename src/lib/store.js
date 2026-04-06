export const DEFAULT_CONTESTS = [
  { id: 1, title: "Write a thread about IronShield", description: "Create an informative Twitter/X thread explaining what IronShield does and why it matters. Min. 5 tweets.", reward: "500 $IRONCLAW", type: "Content", difficulty: "Medium", deadline: "Apr 10", emoji: "🧵" },
  { id: 2, title: "Create a staking explainer carousel", description: "Design a visual carousel (Canva, Figma, etc.) that explains IronShield staking tiers clearly.", reward: "400 $IRONCLAW", type: "Design", difficulty: "Medium", deadline: "Apr 10", emoji: "🎨" },
  { id: 3, title: "30-second IronShield demo video", description: "Record a short video showing IronShield detecting a scam in a Telegram group. Share on YouTube/TikTok.", reward: "600 $IRONCLAW", type: "Video", difficulty: "Hard", deadline: "Apr 12", emoji: "🎬" },
  { id: 4, title: "Report 5 verified scam links", description: "Use /report in any IronShield-protected group to report 5 verified phishing/scam links. Screenshot required.", reward: "100 $IRONCLAW", type: "Community", difficulty: "Easy", deadline: "Ongoing", emoji: "🚨" },
  { id: 5, title: "Refer a group admin to install IronShield", description: "Refer a Telegram group admin to install IronShield. Submit the group link and confirmation screenshot.", reward: "200 $IRONCLAW", type: "Growth", difficulty: "Easy", deadline: "Ongoing", emoji: "📢" },
];

export const initialScores = [
  { wallet: "ironshield.near", points: 1840, ts: "Apr 3, 2026" },
  { wallet: "builder99.near", points: 1500, ts: "Apr 2, 2026" },
];

/**
 * Returns all contests: built-in defaults + any admin-added extras from localStorage.
 * This ensures DEFAULT_CONTESTS are always visible to every user regardless of browser.
 */
export function getAllContests() {
  if (typeof window === "undefined") return [...DEFAULT_CONTESTS];
  try {
    const extras = JSON.parse(localStorage.getItem("ironshield_admin_contests") || "[]");
    return [...DEFAULT_CONTESTS, ...extras];
  } catch {
    return [...DEFAULT_CONTESTS];
  }
}

/**
 * Returns admin-added extras only (not the baked-in defaults).
 */
export function getAdminContests() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("ironshield_admin_contests") || "[]");
  } catch {
    return [];
  }
}

/**
 * Saves admin-added contests (extras only, not defaults).
 */
export function saveAdminContests(contests) {
  if (typeof window === "undefined") return;
  localStorage.setItem("ironshield_admin_contests", JSON.stringify(contests));
}

export function getScores() {
  if (typeof window === "undefined") return [...initialScores];
  try {
    const stored = JSON.parse(localStorage.getItem("ironshield_scores") || "null");
    return stored || [...initialScores];
  } catch {
    return [...initialScores];
  }
}

export function saveScores(scores) {
  if (typeof window === "undefined") return;
  localStorage.setItem("ironshield_scores", JSON.stringify(scores));
}

export function seedDefaults() {
  if (typeof window === "undefined") return;
  if (!localStorage.getItem("ironshield_scores")) {
    localStorage.setItem("ironshield_scores", JSON.stringify(initialScores));
  }
}
