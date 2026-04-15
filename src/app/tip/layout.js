// Static metadata for /tip/?u=<creator>. Per-creator OG previews would
// require SSR/ISR; we're static-exported so the page title stays generic.

export const metadata = {
  title: "Tip a creator · IronShield",
  description: "Send a tip to any IronShield creator in the token of your choice — NEAR, USDC, or any NEP-141 you hold.",
  openGraph: {
    title: "Tip a creator · IronShield",
    description: "Support IronShield creators with a one-click multi-token tip.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tip a creator · IronShield",
    description: "Support IronShield creators with a one-click multi-token tip.",
  },
};

export default function TipLayout({ children }) {
  return children;
}
