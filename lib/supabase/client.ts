"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Cliente para componentes del navegador. Usa la clave publishable/anon:
// es pública por diseño; la seguridad real la impone RLS + RPC en el servidor.
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
