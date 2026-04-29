export const DEFAULT_CONTESTS = [
  { id: 1, title: "Write a thread about AZUKA", description: "Create an informative Twitter/X thread explaining what AZUKA does and why it matters. Min. 5 tweets.", reward: "500 $IRONCLAW", type: "Content", difficulty: "Medium", deadline: "Apr 10", emoji: "🧵" },
  { id: 2, title: "Create a staking explainer carousel", description: "Design a visual carousel (Canva, Figma, etc.) that explains AZUKA staking tiers clearly.", reward: "400 $IRONCLAW", type: "Design", difficulty: "Medium", deadline: "Apr 10", emoji: "🎨" },
  { id: 3, title: "30-second AZUKA demo video", description: "Record a short video showing AZUKA detecting a scam in a Telegram group. Share on YouTube/TikTok.", reward: "600 $IRONCLAW", type: "Video", difficulty: "Hard", deadline: "Apr 12", emoji: "🎬" },
  { id: 4, title: "Report 5 verified scam links", description: "Use /report in any AZUKA-protected group to report 5 verified phishing/scam links. Screenshot required.", reward: "100 $IRONCLAW", type: "Community", difficulty: "Easy", deadline: "Ongoing", emoji: "🚨" },
  { id: 5, title: "Refer a group admin to install AZUKA", description: "Refer a Telegram group admin to install AZUKA. Submit the group link and confirmation screenshot.", reward: "200 $IRONCLAW", type: "Growth", difficulty: "Easy", deadline: "Ongoing", emoji: "📢" },
];

export const initialScores = [
  { wallet: "ironshield.near", points: 1840, ts: "Apr 3, 2026" },
  { wallet: "builder99.near", points: 1500, ts: "Apr 2, 2026" },
];

export const memoryStore = {
  contests: [...DEFAULT_CONTESTS],
  scores: [...initialScores]
};
