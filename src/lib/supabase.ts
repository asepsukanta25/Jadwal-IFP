import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder';

export const isSupabaseConfigured = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Teacher {
  id: string;
  name: string;
  code: string;
  isClassTeacher: boolean;
}

export const TEACHERS: Teacher[] = [
  { id: '1a', name: 'Guru Kelas 1A', code: '101', isClassTeacher: true },
  { id: '1b', name: 'Guru Kelas 1B', code: '102', isClassTeacher: true },
  { id: '2a', name: 'Guru Kelas 2A', code: '201', isClassTeacher: true },
  { id: '2b', name: 'Guru Kelas 2B', code: '202', isClassTeacher: true },
  { id: '3a', name: 'Guru Kelas 3A', code: '301', isClassTeacher: true },
  { id: '3b', name: 'Guru Kelas 3B', code: '302', isClassTeacher: true },
  { id: '4a', name: 'Guru Kelas 4A', code: '401', isClassTeacher: true },
  { id: '4b', name: 'Guru Kelas 4B', code: '402', isClassTeacher: true },
  { id: '5a', name: 'Guru Kelas 5A', code: '501', isClassTeacher: true },
  { id: '5b', name: 'Guru Kelas 5B', code: '502', isClassTeacher: true },
  { id: '6a', name: 'Guru Kelas 6A', code: '601', isClassTeacher: true },
  { id: '6b', name: 'Guru Kelas 6B', code: '602', isClassTeacher: true },
  { id: 'pjok_a', name: 'Guru PJOK A', code: '701', isClassTeacher: false },
  { id: 'pjok_b', name: 'Guru PJOK B', code: '702', isClassTeacher: false },
  { id: 'pai_low', name: 'Guru PAI Kelas Rendah', code: '801', isClassTeacher: false },
  { id: 'pai_high', name: 'Guru PAI Kelas Tinggi', code: '802', isClassTeacher: false },
];

export interface Booking {
  id?: string;
  week_index: number; // 0, 1, 2
  day_index: number; // 0 (Mon) to 4 (Fri)
  teacher_id: string;
  type: 'default' | 'booked' | 'negotiated';
  original_teacher_id?: string;
  status: 'confirmed' | 'pending';
  created_at?: string;
}

export interface NegoRequest {
  id?: string;
  booking_id: string;
  from_teacher_id: string;
  to_teacher_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;
  created_at?: string;
}
