import { supabase } from './supabase';

export interface StaffRow { user_id: string; display_name: string | null; phone: string | null; roles: string[] }

/** RPC list_staff(p_roles): staff of the caller's institution, optionally filtered by role. */
export async function listStaff(roles: string[] | null): Promise<StaffRow[]> {
  const { data, error } = await supabase.rpc('list_staff', { p_roles: roles });
  if (error) throw error;
  return (data ?? []) as StaffRow[];
}
