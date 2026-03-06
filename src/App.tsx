/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Clock, 
  User, 
  Lock, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  LogOut,
  AlertCircle,
  CalendarDays,
  Trash2
} from 'lucide-react';
import { supabase, TEACHERS, Teacher, Booking, NegoRequest, isSupabaseConfigured } from './lib/supabase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  format, 
  startOfWeek, 
  addDays, 
  isSameDay, 
  differenceInWeeks, 
  startOfDay,
  addWeeks,
  subWeeks
} from 'date-fns';
import { id } from 'date-fns/locale';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const WEEKS = ['Minggu 1', 'Minggu 2', 'Minggu 3'];

// Default schedule mapping based on the image
const DEFAULT_SCHEDULE: Record<number, Record<number, string | null>> = {
  0: { 0: '1a', 1: '1b', 2: '2a', 3: '2b', 4: null },
  1: { 0: '3a', 1: '3b', 2: '4a', 3: '4b', 4: null },
  2: { 0: '5a', 1: '5b', 2: '6a', 3: '6b', 4: null },
};

export default function App() {
  const [currentTeacher, setCurrentTeacher] = useState<Teacher | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: string; data: any } | null>(null);
  
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [negoRequests, setNegoRequests] = useState<NegoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ week: number; day: number } | null>(null);
  const [showNegoModal, setShowNegoModal] = useState(false);
  const [negoMessage, setNegoMessage] = useState('');

  // Date logic
  const today = useMemo(() => new Date(), []);
  
  // Reference date: Monday, March 2, 2026 (Start of a cycle)
  const REFERENCE_DATE = useMemo(() => new Date(2026, 2, 2), []); // March is index 2
  
  const currentCycleInfo = useMemo(() => {
    const diffWeeks = differenceInWeeks(startOfWeek(today, { weekStartsOn: 1 }), startOfWeek(REFERENCE_DATE, { weekStartsOn: 1 }));
    const cycleIndex = ((diffWeeks % 3) + 3) % 3; // Ensure positive 0, 1, 2
    
    // Calculate the start of the 3-week block that contains today
    const blockStart = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), cycleIndex);
    
    return { cycleIndex, blockStart };
  }, [today, REFERENCE_DATE]);

  const getSlotDate = (weekIdx: number, dayIdx: number) => {
    return addDays(addWeeks(currentCycleInfo.blockStart, weekIdx), dayIdx);
  };

  // Fetch data from Supabase
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const { data: bookingsData, error: bError } = await supabase
          .from('bookings')
          .select('*');
        
        const { data: negoData, error: nError } = await supabase
          .from('negotiations')
          .select('*')
          .eq('status', 'pending');

        if (bError || nError) throw bError || nError;

        setBookings(bookingsData || []);
        setNegoRequests(negoData || []);
      } catch (err: any) {
        console.error('Error fetching data:', err);
        // Fallback to empty if table doesn't exist yet (common in first setup)
        setError("Pastikan tabel 'bookings' dan 'negotiations' sudah dibuat di Supabase.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();

    // Realtime subscription
    const bookingsChannel = supabase
      .channel('bookings-changes')
      .on('postgres_changes', { event: '*', table: 'bookings' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setBookings(prev => [...prev, payload.new as Booking]);
        } else if (payload.eventType === 'UPDATE') {
          setBookings(prev => prev.map(b => b.id === payload.new.id ? payload.new as Booking : b));
        } else if (payload.eventType === 'DELETE') {
          const deletedId = payload.old?.id;
          if (deletedId) {
            setBookings(prev => prev.filter(b => b.id !== deletedId));
          }
        }
      })
      .subscribe();

    const negoChannel = supabase
      .channel('nego-changes')
      .on('postgres_changes', { event: '*', table: 'negotiations' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setNegoRequests(prev => [...prev, payload.new as NegoRequest]);
        } else if (payload.eventType === 'UPDATE') {
          setNegoRequests(prev => {
            if (payload.new.status !== 'pending') {
              return prev.filter(r => r.id !== payload.new.id);
            }
            return prev.map(r => r.id === payload.new.id ? payload.new as NegoRequest : r);
          });
        } else if (payload.eventType === 'DELETE') {
          const deletedId = payload.old?.id;
          if (deletedId) {
            setNegoRequests(prev => prev.filter(r => r.id !== deletedId));
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(bookingsChannel);
      supabase.removeChannel(negoChannel);
    };
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const teacher = TEACHERS.find(t => t.code === accessCode);
    if (teacher) {
      setCurrentTeacher(teacher);
      setAccessCode('');
      setShowLoginModal(false);
      
      // Execute pending action if any
      if (pendingAction) {
        const { type, data } = pendingAction;
        if (type === 'accept') handleAcceptNego(data, teacher);
        if (type === 'reject') handleRejectNego(data, teacher);
        if (type === 'booking') handleBooking(data.week, data.day, teacher);
        if (type === 'nego_request') {
          setSelectedSlot(data);
          setShowNegoModal(true);
        }
        if (type === 'cancel_booking') handleCancelBooking(data, teacher);
        if (type === 'cancel_nego') handleCancelNego(data, teacher);
        setPendingAction(null);
      }
    } else {
      alert('Kode akses salah.');
    }
  };

  const handleLogout = () => {
    setCurrentTeacher(null);
  };

  const handleActionWithAuth = (type: string, data: any) => {
    if (!currentTeacher) {
      setPendingAction({ type, data });
      setShowLoginModal(true);
      return;
    }
    
    if (type === 'accept') handleAcceptNego(data, currentTeacher);
    if (type === 'reject') handleRejectNego(data, currentTeacher);
    if (type === 'booking') handleBooking(data.week, data.day, currentTeacher);
    if (type === 'nego_request') {
      setSelectedSlot(data);
      setShowNegoModal(true);
    }
    if (type === 'cancel_booking') handleCancelBooking(data, currentTeacher);
    if (type === 'cancel_nego') handleCancelNego(data, currentTeacher);
  };

  const handleBooking = async (week: number, day: number, teacher: Teacher) => {
    try {
      const newBooking: Booking = {
        week_index: week,
        day_index: day,
        teacher_id: teacher.id,
        type: 'booked',
        status: 'confirmed'
      };
      const { error } = await supabase.from('bookings').insert([newBooking]);
      if (error) throw error;
      setSelectedSlot(null);
    } catch (err) {
      console.error('Booking error:', err);
      alert('Gagal melakukan booking.');
    }
  };

  const handleCancelBooking = async (bookingId: string, teacher: Teacher) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (booking?.teacher_id !== teacher.id) {
      alert('Anda hanya bisa membatalkan booking milik sendiri.');
      return;
    }
    if (!window.confirm('Apakah Anda yakin ingin membatalkan booking ini?')) return;
    try {
      setLoading(true);
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
      if (error) throw error;
      setBookings(prev => prev.filter(b => b.id !== bookingId));
      setNegoRequests(prev => prev.filter(r => r.booking_id !== bookingId));
    } catch (err: any) {
      alert(`Gagal membatalkan booking: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelNego = async (negoId: string, teacher: Teacher) => {
    const nego = negoRequests.find(r => r.id === negoId);
    if (nego?.from_teacher_id !== teacher.id) {
      alert('Anda hanya bisa membatalkan negosiasi milik sendiri.');
      return;
    }
    if (!window.confirm('Apakah Anda yakin ingin membatalkan permintaan negosiasi ini?')) return;
    try {
      setLoading(true);
      const { error } = await supabase.from('negotiations').delete().eq('id', negoId);
      if (error) throw error;
      setNegoRequests(prev => prev.filter(r => r.id !== negoId));
    } catch (err: any) {
      alert(`Gagal membatalkan negosiasi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptNego = async (req: NegoRequest, teacher: Teacher) => {
    if (req.to_teacher_id !== teacher.id) {
      alert('Anda hanya bisa menerima negosiasi untuk jadwal Anda sendiri.');
      return;
    }
    try {
      await supabase.from('negotiations').update({ status: 'accepted' }).eq('id', req.id);
      const { data: booking } = await supabase.from('bookings').select('*').eq('id', req.booking_id).single();
      if (booking) {
        await supabase.from('bookings').update({ 
          teacher_id: req.from_teacher_id,
          original_teacher_id: req.to_teacher_id,
          type: 'negotiated'
        }).eq('id', req.booking_id);
      }
      setNegoRequests(prev => prev.filter(r => r.id !== req.id));
    } catch (err) {
      console.error('Accept error:', err);
    }
  };

  const handleRejectNego = async (req: NegoRequest, teacher: Teacher) => {
    if (req.to_teacher_id !== teacher.id) {
      alert('Anda hanya bisa menolak negosiasi untuk jadwal Anda sendiri.');
      return;
    }
    try {
      await supabase.from('negotiations').update({ status: 'rejected' }).eq('id', req.id);
      setNegoRequests(prev => prev.filter(r => r.id !== req.id));
    } catch (err) {
      console.error('Reject error:', err);
    }
  };

  const getSlotOwner = (week: number, day: number) => {
    const customBooking = bookings.find(b => b.week_index === week && b.day_index === day);
    if (customBooking) {
      return TEACHERS.find(t => t.id === customBooking.teacher_id);
    }
    const defaultId = DEFAULT_SCHEDULE[week][day];
    if (defaultId) {
      return TEACHERS.find(t => t.id === defaultId);
    }
    return null;
  };

  const handleNegoRequest = async () => {
    if (!currentTeacher || !selectedSlot) return;
    const owner = getSlotOwner(selectedSlot.week, selectedSlot.day);
    if (!owner) return;

    try {
      let bookingId: string;
      const existingBooking = bookings.find(b => b.week_index === selectedSlot.week && b.day_index === selectedSlot.day);
      if (existingBooking) {
        bookingId = existingBooking.id!;
      } else {
        const { data, error } = await supabase.from('bookings').insert([{
          week_index: selectedSlot.week,
          day_index: selectedSlot.day,
          teacher_id: owner.id,
          type: 'default',
          status: 'confirmed'
        }]).select();
        if (error) throw error;
        bookingId = data[0].id;
      }

      const { error } = await supabase.from('negotiations').insert([{
        booking_id: bookingId,
        from_teacher_id: currentTeacher.id,
        to_teacher_id: owner.id,
        status: 'pending',
        message: negoMessage
      }]);
      if (error) throw error;
      setShowNegoModal(false);
      setNegoMessage('');
      setSelectedSlot(null);
      alert('Permintaan negosiasi telah dikirim!');
    } catch (err) {
      alert('Gagal mengirim negosiasi.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md">
              <Calendar className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">IFP Scheduler</h1>
              <p className="text-xs text-gray-500">Jadwal Siklus 3 Minggu</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {currentTeacher ? (
              <>
                <div className="hidden md:flex flex-col items-end">
                  <span className="text-sm font-semibold text-gray-900">{currentTeacher.name}</span>
                  <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">Teacher Active</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2.5 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-xl transition-colors"
                  title="Keluar"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button 
                onClick={() => setShowLoginModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>Login Guru</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Configuration Warning */}
        {!isSupabaseConfigured && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3 max-w-2xl mx-auto">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">Konfigurasi Diperlukan</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Silakan atur <strong>VITE_SUPABASE_URL</strong> dan <strong>VITE_SUPABASE_ANON_KEY</strong> di panel Secrets untuk mengaktifkan fitur database.
              </p>
            </div>
          </div>
        )}

        {/* Notifications for Nego Requests */}
        <AnimatePresence>
          {currentTeacher && negoRequests.filter(r => r.to_teacher_id === currentTeacher.id).map(req => {
            const fromTeacher = TEACHERS.find(t => t.id === req.from_teacher_id);
            return (
              <motion.div 
                key={req.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="mb-6 bg-white border-l-4 border-amber-500 rounded-2xl shadow-sm p-4 flex flex-col md:flex-row items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <ArrowRightLeft className="text-amber-600 w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      <span className="font-bold">{fromTeacher?.name}</span> ingin negosiasi jadwal Anda.
                    </p>
                    {req.message && <p className="text-xs text-gray-500 italic mt-0.5">"{req.message}"</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleActionWithAuth('accept', req)}
                    className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Terima
                  </button>
                  <button 
                    onClick={() => handleActionWithAuth('reject', req)}
                    className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Tolak
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Schedule Grid */}
        <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="p-6 text-left text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em] border-b border-gray-100">Minggu</th>
                  {DAYS.map((day, idx) => (
                    <th key={day} className="p-6 text-left border-b border-gray-100">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em]">{day}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEKS.map((weekLabel, weekIdx) => (
                  <tr key={weekIdx} className="group hover:bg-gray-50/30 transition-colors">
                    <td className="p-6 border-b border-gray-100">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-900">{weekLabel}</span>
                        <span className="text-[10px] text-gray-400 font-medium mt-1">
                          {format(getSlotDate(weekIdx, 0), 'd MMM', { locale: id })} - {format(getSlotDate(weekIdx, 4), 'd MMM', { locale: id })}
                        </span>
                      </div>
                    </td>
                    {DAYS.map((_, dayIdx) => {
                      const slotDate = getSlotDate(weekIdx, dayIdx);
                      const isToday = isSameDay(slotDate, today);
                      const owner = getSlotOwner(weekIdx, dayIdx);
                      const isMe = currentTeacher && owner?.id === currentTeacher.id;
                      
                      const slotBooking = bookings.find(b => b.week_index === weekIdx && b.day_index === dayIdx);
                      const isNegotiated = slotBooking?.type === 'negotiated';
                      const myPendingNego = currentTeacher && slotBooking ? negoRequests.find(r => r.booking_id === slotBooking.id && r.from_teacher_id === currentTeacher.id) : null;

                      return (
                        <td key={dayIdx} className={cn(
                          "p-4 border-b border-gray-100 transition-colors",
                          isToday && "bg-indigo-50/50"
                        )}>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between px-1">
                              <span className={cn(
                                "text-[10px] font-bold",
                                isToday ? "text-indigo-600" : "text-gray-400"
                              )}>
                                {format(slotDate, 'd MMM', { locale: id })}
                              </span>
                              {isToday && (
                                <div className="flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></div>
                                  <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-tighter">Hari Ini</span>
                                </div>
                              )}
                            </div>
                            
                            {owner ? (
                              <div className={cn(
                                "group/card relative p-4 rounded-2xl transition-all duration-300",
                                isMe ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border border-gray-100 hover:border-indigo-200 hover:shadow-md"
                              )}>
                                <div className="flex items-start justify-between mb-2">
                                  <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    isMe ? "bg-white/20 text-white" : "bg-gray-100 text-gray-400"
                                  )}>
                                    <User className="w-4 h-4" />
                                  </div>
                                  <div className="flex gap-1">
                                    {isNegotiated && (
                                      <div className={cn(
                                        "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase",
                                        isMe ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                                      )}>
                                        Nego
                                      </div>
                                    )}
                                    {myPendingNego && (
                                      <div className="bg-blue-100 text-blue-700 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">
                                        Pending
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <p className={cn(
                                  "text-sm font-bold leading-tight mb-1",
                                  isMe ? "text-white" : "text-gray-900"
                                )}>
                                  {owner.name}
                                </p>
                                <p className={cn(
                                  "text-[10px] font-medium",
                                  isMe ? "text-white/70" : "text-gray-400"
                                )}>
                                  {owner.isClassTeacher ? 'Wali Kelas' : 'Guru Mapel'}
                                </p>

                                {/* Action Overlay */}
                                <div className="absolute inset-0 bg-indigo-600/90 opacity-0 group-hover/card:opacity-100 rounded-2xl flex flex-col items-center justify-center text-white transition-opacity duration-200 gap-2">
                                  {loading ? (
                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
                                  ) : isMe && slotBooking && slotBooking.type !== 'default' ? (
                                    <button 
                                      onClick={() => handleActionWithAuth('cancel_booking', slotBooking.id!)}
                                      disabled={loading}
                                      className="flex flex-col items-center justify-center hover:scale-110 transition-transform disabled:opacity-50"
                                    >
                                      <Trash2 className="w-6 h-6 mb-1" />
                                      <span className="text-[10px] font-bold uppercase tracking-wider">Batal Booking</span>
                                    </button>
                                  ) : !isMe && myPendingNego ? (
                                    <button 
                                      onClick={() => handleActionWithAuth('cancel_nego', myPendingNego.id!)}
                                      disabled={loading}
                                      className="flex flex-col items-center justify-center hover:scale-110 transition-transform disabled:opacity-50"
                                    >
                                      <XCircle className="w-6 h-6 mb-1" />
                                      <span className="text-[10px] font-bold uppercase tracking-wider">Batal Nego</span>
                                    </button>
                                  ) : !isMe ? (
                                    <button 
                                      onClick={() => handleActionWithAuth('nego_request', { week: weekIdx, day: dayIdx })}
                                      disabled={loading}
                                      className="flex flex-col items-center justify-center hover:scale-110 transition-transform disabled:opacity-50"
                                    >
                                      <ArrowRightLeft className="w-6 h-6 mb-1" />
                                      <span className="text-[10px] font-bold uppercase tracking-wider">Nego Jadwal</span>
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <button 
                                onClick={() => handleActionWithAuth('booking', { week: weekIdx, day: dayIdx })}
                                className="w-full h-[100px] border-2 border-dashed border-gray-100 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group/btn"
                              >
                                <div className="w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center group-hover/btn:bg-indigo-100 transition-colors">
                                  <Clock className="text-gray-300 group-hover/btn:text-indigo-500 w-4 h-4" />
                                </div>
                                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest group-hover/btn:text-indigo-500">Booking</span>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-indigo-600 rounded-full"></div>
            <span className="text-xs text-gray-500 font-medium">Jadwal Anda</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-white border border-gray-200 rounded-full"></div>
            <span className="text-xs text-gray-500 font-medium">Jadwal Guru Lain</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border border-dashed border-gray-300 rounded-full"></div>
            <span className="text-xs text-gray-500 font-medium">Slot Kosong</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-amber-400 rounded-full"></div>
            <span className="text-xs text-gray-500 font-medium">Hasil Negosiasi</span>
          </div>
        </div>
      </main>

      {/* Nego Modal */}
      <AnimatePresence>
        {showNegoModal && selectedSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNegoModal(false)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 overflow-hidden"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                  <ArrowRightLeft className="text-amber-600 w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Negosiasi Jadwal</h3>
                  <p className="text-sm text-gray-500">Kirim pesan ke {getSlotOwner(selectedSlot.week, selectedSlot.day)?.name}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Waktu Terpilih</span>
                    <span className="text-xs font-bold text-indigo-600">{WEEKS[selectedSlot.week]}, {DAYS[selectedSlot.day]}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Pesan (Opsional)</label>
                  <textarea 
                    value={negoMessage}
                    onChange={(e) => setNegoMessage(e.target.value)}
                    placeholder="Contoh: Boleh tukar jadwal? Saya ada keperluan mendesak..."
                    className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px] resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setShowNegoModal(false)}
                    className="flex-1 px-6 py-4 bg-gray-100 text-gray-600 font-bold rounded-2xl hover:bg-gray-200 transition-all"
                  >
                    Batal
                  </button>
                  <button 
                    onClick={handleNegoRequest}
                    className="flex-1 px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                  >
                    Kirim Nego
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Login Modal */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowLoginModal(false);
                setPendingAction(null);
              }}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 overflow-hidden"
            >
              <div className="flex flex-col items-center mb-8">
                <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
                  <Lock className="text-white w-8 h-8" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Verifikasi Guru</h1>
                <p className="text-gray-500 text-sm mt-1">Masukkan kode akses Anda untuk melanjutkan</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 ml-1">
                    Kode Akses Guru (3 Digit)
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input 
                      type="password"
                      maxLength={3}
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder="Masukkan 3 digit kode..."
                      className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 text-lg font-mono focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowLoginModal(false);
                      setPendingAction(null);
                    }}
                    className="flex-1 px-6 py-4 bg-gray-100 text-gray-600 font-bold rounded-2xl hover:bg-gray-200 transition-all"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-100 transition-all active:scale-[0.98]"
                  >
                    Verifikasi
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tentang IFP</h4>
            <p className="text-sm text-gray-500 leading-relaxed">
              Interactive Flat Panel (IFP) adalah sarana pembelajaran modern. Gunakan jadwal ini untuk memastikan penggunaan yang adil bagi seluruh kelas.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Aturan Booking</h4>
            <ul className="text-sm text-gray-500 space-y-2">
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
                Satu hari hanya untuk satu kelas/guru.
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
                Slot kosong di hari Jumat bebas di-booking.
              </li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kontak Admin</h4>
            <p className="text-sm text-gray-500">
              Jika ada kendala teknis atau lupa kode akses, silakan hubungi tim IT Sekolah.
            </p>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">© 2024 IFP Scheduler System • SD Negeri Digital</p>
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">System Operational</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
