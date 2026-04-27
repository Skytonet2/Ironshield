"use client";
// /admin — admin console.
//
// AdminPanel is itself a fullscreen modal (position: fixed, z-index 2000)
// so we don't wrap it in AppShell. But the pre-React PreLoader splash
// only unmounts when something with `data-app-shell="ready"` exists in
// the DOM, so a no-AppShell page hangs on the splash forever. The
// hidden marker div below satisfies that contract without bringing
// AppShell's sidebar onto the page.
//
// Auth gate: AdminPanel POSTs /api/admin/check on mount and renders
// the "Not authorized" branch for non-admins. The route itself stays
// publicly reachable; protection is at the API layer.

import { useRouter } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";

export default function AdminPage() {
  const router = useRouter();
  return (
    <>
      <div data-app-shell="ready" style={{ display: "none" }} aria-hidden="true" />
      <AdminPanel onClose={() => router.push("/feed")} />
    </>
  );
}
