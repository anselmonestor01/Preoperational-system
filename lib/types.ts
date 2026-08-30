// Tipos de dominio (espejo del esquema Postgres de Mundo Marítimo).

export type Role =
  | "superadmin" | "admin" | "supervisor"
  | "maintenance" | "auditor" | "operator" | "driver";

export type ItemType = "nivel" | "estado" | "equipo";
export type Severity = "ok" | "warn" | "bad";
export type InspectionResult = "bueno" | "regular" | "malo";
export type InspectionStatus =
  | "in_progress" | "submitted" | "authorized" | "rejected" | "closed" | "voided";
export type OperationStatus = "none" | "open" | "closed";
export type IssueStatus = "pending" | "review" | "resolved" | "reopened";
export type VehicleStatus = "active" | "inactive" | "archived";

export interface Profile {
  id: string;
  organization_id: string;
  role: Role;
  full_name: string;
  email: string;
  active: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  max_non_critical_bad: number;
}

export interface Round {
  id: string;
  round_number: number;
  label: string;
  status: "open" | "closed";
  started_at: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  reference: string | null;
  model: string | null;
  operation_card: string | null;
  insurance_expires: string | null;
  emissions_expires: string | null;
  oil_change_date: string | null;
  status: VehicleStatus;
  admin_blocked: boolean;
  admin_block_reason: string | null;
  blocked_at: string | null;
}

export interface Driver {
  id: string;
  full_name: string;
  license: string | null;
  whatsapp: string | null;
  photo_path: string | null;
  active: boolean;
}

export interface ChecklistItem {
  id: string;
  name: string;
  item_type: ItemType;
  required: boolean;
  is_safety_critical: boolean;
  sort_order: number;
}

export interface ChecklistCategory {
  key: string;
  name: string;
  icon: string;
  sort_order: number;
  items: ChecklistItem[];
}

export interface Inspection {
  id: string;
  round_id: string;
  vehicle_id: string;
  driver_id: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  checklist_version_number: number | null;
  status: InspectionStatus;
  result: InspectionResult | null;
  authorized: boolean | null;
  auth_reasons: unknown;
  km_inicial: number | null;
  km_final: number | null;
  fuel_in: string | null;
  fuel_out: string | null;
  recorrido: number | null;
  obs_general: string | null;
  ok_count: number;
  warn_count: number;
  bad_count: number;
  total_items: number;
  operation_status: OperationStatus;
  released: boolean;
  submitted_at: string | null;
  authorized_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface Issue {
  id: string;
  inspection_id: string | null;
  vehicle_id: string;
  driver_id: string | null;
  category_key: string | null;
  item_name: string;
  severity: Severity;
  description: string | null;
  due_date: string | null;
  status: IssueStatus;
  resolution_note: string | null;
  created_at: string;
}

// Respuesta de una inspección enviada al RPC submit_inspection.
export interface AnswerPayload {
  category_key: string;
  item_id: string | null;
  item_name: string;
  item_type: ItemType;
  value: string;
  note?: string;
  due_date?: string;
  evidence?: string[];
}
