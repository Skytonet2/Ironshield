"use client";
// /admin — admin console. AdminPanel is itself a fullscreen modal
// (position: fixed, z-index 2000) so we don't wrap it in AppShell;
// closing routes back to the feed.
//
// AdminPanel handles its own auth gate via POST /api/admin/check —
// non-admins see the "Not authorized" view inside the panel even
// though the route itself is publicly reachable. Backed by the
// admin_wallets table; seeded via ADMIN_WALLET_SEED env on first boot.

import { useRouter } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";

export default function AdminPage() {
  const router = useRouter();
  return <AdminPanel onClose={() => router.push("/feed")} />;
}
