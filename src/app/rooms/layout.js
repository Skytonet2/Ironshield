// Static metadata for /rooms (live alpha rooms grid).
// Per-room OG previews live on /rooms/[id]/layout.js once the dynamic
// room route ships with generateStaticParams.

export const metadata = {
  title: "Live Alpha Rooms · IronShield",
  description: "Join hosted voice + chat rooms where stakers share alpha. Powered by IronClaw on NEAR.",
  openGraph: {
    title: "Live Alpha Rooms · IronShield",
    description: "Hosted alpha rooms — stake $IRONCLAW, share calls, get tipped.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live Alpha Rooms · IronShield",
    description: "Hosted alpha rooms — stake $IRONCLAW, share calls, get tipped.",
  },
};

export default function RoomsLayout({ children }) {
  return children;
}
