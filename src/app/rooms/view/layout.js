// Static metadata for /rooms/view/?id=<roomId>. Per-room OG previews would
// require SSR/ISR; static export keeps the title generic.

export const metadata = {
  title: "Live Alpha Room · IronShield",
  description: "Voice + chat alpha room on IronShield. Powered by IronClaw on NEAR.",
  openGraph: {
    title: "Live Alpha Room · IronShield",
    description: "Voice + chat alpha room on IronShield.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live Alpha Room · IronShield",
    description: "Voice + chat alpha room on IronShield.",
  },
};

export default function RoomViewLayout({ children }) {
  return children;
}
