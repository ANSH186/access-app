// Shapes from docs/CONTRACT.md (§2 tables, §4 API).

export type Profile = {
  id: string;
  institution_id: string;
  display_name: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  share_location_in_sos: boolean;
  speech_rate: number;
  avoid_stairs: boolean;
};

export type LocationSource = 'qr_checkpoint' | 'staff_confirmed' | 'route_progress' | 'gps' | 'unknown';

export type ConfirmedLocation = {
  node_id: string;
  label: string;
  floor_level: number;
  floor_name: string;
  source: LocationSource;
  observed_at: string; // ISO
};

export type RouteStep = {
  index: number;
  instruction: string;
  from_node_id: string;
  to_node_id: string;
  floor_level: number;
  length_m: number;
  kind: string;
  checkpoint_qr: string | null;
};

export type RoutePlan = {
  found: boolean;
  total_length_m?: number;
  node_ids?: string[];
  edge_ids?: string[];
  steps?: RouteStep[];
  explanation?: string | null;
  blocked_edges_avoided?: { edge_id: string; label: string; reason: string }[];
  warnings?: string[];
  arrival_message?: string | null;
};

export type DestinationResult = {
  node_id: string;
  code: string;
  label: string;
  kind: string;
  floor_level: number;
  floor_name: string;
  score: number;
};

export type OcrResult = {
  text: string;
  language: string;
  confidence: 'high' | 'medium' | 'low';
  spoken: string;
  answer: string | null;
  advice: string | null;
};

export type VisionResult = {
  description: string;
  answer: string | null;
  confidence: 'high' | 'medium' | 'low';
  caution: string;
};

export type Intent =
  | 'navigate'
  | 'read_sign'
  | 'describe_scene'
  | 'report_problem'
  | 'sos'
  | 'where_am_i'
  | 'repeat'
  | 'cancel'
  | 'help'
  | 'unknown';

export type CommandResult = {
  transcript: string;
  intent: Intent;
  destination_query: string | null;
  destination: { node_id: string; label: string; floor_level: number; floor_name: string } | null;
  reply: string;
};

export type AlertStatus =
  | 'triggered'
  | 'acknowledged'
  | 'responding'
  | 'unable_to_contact'
  | 'resolved'
  | 'cancelled';

export type EmergencyAlert = {
  id: string;
  user_id: string;
  client_request_id: string;
  emergency_type: string;
  is_test: boolean;
  status: AlertStatus;
  node_id: string | null;
  location_source: LocationSource;
  location_label: string | null;
  location_observed_at: string | null;
  created_at: string;
  updated_at: string;
  resolution_notes: string | null;
};

export type EmergencyEvent = {
  id: number;
  alert_id: string;
  event_type: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  visible_to_user: boolean;
  created_at: string;
};

export const ACTIVE_ALERT_STATUSES: AlertStatus[] = [
  'triggered',
  'acknowledged',
  'responding',
  'unable_to_contact',
];

export const REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'blocked_path', label: 'Blocked path' },
  { value: 'closed_door', label: 'Closed door' },
  { value: 'broken_lift', label: 'Broken lift' },
  { value: 'wet_floor', label: 'Wet floor' },
  { value: 'missing_sign', label: 'Missing sign' },
  { value: 'construction', label: 'Construction' },
  { value: 'other', label: 'Something else' },
];

export type ObstacleReport = {
  id: string;
  category: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
