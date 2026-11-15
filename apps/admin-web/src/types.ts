// Row types matching docs/CONTRACT.md section 2.

export type RoleName = 'admin' | 'responder' | 'maintenance' | 'map_editor';
export const ALL_ROLES: RoleName[] = ['admin', 'responder', 'maintenance', 'map_editor'];

export interface Institution {
  id: string;
  name: string;
  address: string | null;
  test_mode_only: boolean;
  created_at: string | null;
}

export interface Profile {
  id: string;
  institution_id: string;
  display_name: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  share_location_in_sos: boolean;
  speech_rate: number;
  avoid_stairs: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface RoleAssignment {
  user_id: string;
  institution_id: string;
  role: RoleName;
  created_at: string | null;
}

export interface Building {
  id: string;
  institution_id: string;
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  is_placeholder: boolean;
  notes: string | null;
}

export interface Floor {
  id: string;
  building_id: string;
  code: string;
  level: number;
  name: string;
}

export type NodeKind =
  | 'corridor' | 'entrance' | 'room' | 'lab' | 'office' | 'library' | 'washroom'
  | 'help_desk' | 'stairs' | 'lift' | 'emergency_point';

export interface RouteNode {
  id: string;
  floor_id: string;
  code: string;
  kind: NodeKind;
  label: string;
  aliases: string[];
  x: number;
  y: number;
  searchable: boolean;
  qr_token: string | null;
  verified: boolean;
  verified_at: string | null;
  notes: string | null;
  updated_at: string | null;
}

export type EdgeKind = 'corridor' | 'door' | 'stairs' | 'lift' | 'outdoor';
export type EdgeStatus = 'open' | 'blocked';

export interface RouteEdge {
  id: string;
  code: string;
  from_node_id: string;
  to_node_id: string;
  kind: EdgeKind;
  length_m: number;
  step_free: boolean;
  status: EdgeStatus;
  blocked_reason: string | null;
  blocked_by_report_id: string | null;
  verified: boolean;
  verified_at: string | null;
  updated_at: string | null;
}

export type ReportCategory =
  | 'blocked_path' | 'closed_door' | 'broken_lift' | 'wet_floor' | 'missing_sign' | 'construction' | 'other';

export type ReportStatus =
  | 'submitted' | 'under_review' | 'verified' | 'assigned' | 'resolved' | 'closed' | 'rejected' | 'reopened';

export interface ObstacleReport {
  id: string;
  reporter_id: string | null;
  institution_id: string;
  node_id: string | null;
  edge_id: string | null;
  category: ReportCategory;
  description: string | null;
  photo_path: string | null;
  status: ReportStatus;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  verified_by: string | null;
  verified_at: string | null;
  resolution_notes: string | null;
}

export interface ReportEvent {
  id: number;
  report_id: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

export type EmergencyType = 'unspecified' | 'medical' | 'lost' | 'fall' | 'unsafe' | 'other';
export type AlertStatus =
  | 'triggered' | 'acknowledged' | 'responding' | 'unable_to_contact' | 'resolved' | 'cancelled';
export type LocationSource = 'qr_checkpoint' | 'staff_confirmed' | 'route_progress' | 'gps' | 'unknown';

export interface EmergencyAlert {
  id: string;
  user_id: string;
  institution_id: string;
  client_request_id: string;
  emergency_type: EmergencyType;
  message: string | null;
  is_test: boolean;
  status: AlertStatus;
  node_id: string | null;
  location_source: LocationSource;
  location_label: string | null;
  location_observed_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  assigned_responder_id: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export interface EmergencyEvent {
  id: number;
  alert_id: string;
  actor_id: string | null;
  event_type: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  visible_to_user: boolean;
  created_at: string;
}

// ---- FastAPI route planning (CONTRACT section 4) ----
export interface RoutePlanRequest {
  from_node_id: string;
  to_node_id: string;
  avoid_stairs: boolean;
}
export interface RouteStep {
  index: number;
  instruction: string;
  from_node_id: string;
  to_node_id: string;
  floor_level: number;
  length_m: number;
  kind: string;
  checkpoint_qr: string | null;
}
export interface RoutePlanResponse {
  found: boolean;
  total_length_m?: number;
  node_ids?: string[];
  edge_ids?: string[];
  steps?: RouteStep[];
  explanation?: string | null;
  blocked_edges_avoided?: { edge_id: string; label: string; reason: string }[];
  warnings?: string[];
  arrival_message?: string | null;
}
