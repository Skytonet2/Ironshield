// Static metadata for /rooms/view/?id=<roomId>. Per-room OG previews would
// require SSR/ISR; static export keeps the title generic.

export const metadata = {
  title: "Live Alpha Room · AZUKA",
  description: "Voice + chat alpha room on AZUKA. Powered by IronClaw on NEAR.",
  openGraph: {
    title: "Live Alpha Room · AZUKA",
    description: "Voice + chat alpha room on AZUKA.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live Alpha Room · AZUKA",
    description: "Voice + chat alpha room on AZUKA.",
  },
};

export default function RoomViewLayout({ children }) {
  return children;
}
