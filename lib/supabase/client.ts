"use client";

import { createBrowserClient } from "@supabase/ssr";

// Cliente para componentes del navegador. Usa la clave publishable/anon:
// es pública por diseño; la seguridad real la impone RLS + RPC en el servidor.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
