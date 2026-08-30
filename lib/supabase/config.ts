// Configuración pública de Supabase.
//
// La URL y la clave *publishable/anon* son PÚBLICAS por diseño: viajan al
// navegador y la seguridad real la impone RLS + los RPC en el servidor. Se dejan
// como valor por defecto para que el despliegue funcione sin configuración
// adicional; si se definen las variables de entorno NEXT_PUBLIC_*, éstas tienen
// prioridad. El service_role NUNCA se incluye aquí ni se expone al cliente.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://vkduxheifqmomtazolku.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_0qxowk5wAIYyUvfMzK6qCg_YQATb8uT";
