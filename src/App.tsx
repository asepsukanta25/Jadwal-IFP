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
      .on('postgres_changes' as any, { event: '*', table: 'bookings' }, (payload: any) => {
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
      .on('postgres_changes' as any, { event: '*', table: 'negotiations' }, (payload: any) => {
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
    <div className="min-h-screen font-sans selection:bg-brand-100 selection:text-brand-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 w-full glass border-b border-slate-200/60 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3 group cursor-pointer">
              <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-200 group-hover:scale-110 transition-transform duration-300">
                <CalendarDays className="text-white w-7 h-7" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-brand-600 transition-colors">IFP Scheduler</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] leading-none">SD NEGERI LEUWIGAJAH 3</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {currentTeacher ? (
                <div className="flex items-center gap-4">
                  <div className="hidden md:flex flex-col items-end">
                    <span className="text-sm font-bold text-slate-900">{currentTeacher.name}</span>
                    <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wider">Guru Terverifikasi</span>
                  </div>
                  <div className="w-10 h-10 bg-brand-50 border border-brand-100 rounded-xl flex items-center justify-center text-brand-600 shadow-sm">
                    <User className="w-5 h-5" />
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200"
                    title="Logout"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setShowLoginModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-brand-200 hover:bg-brand-700 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                >
                  <Lock className="w-4 h-4" />
                  <span>Login Guru</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Hero Section */}
        <div className="mb-12 text-center md:text-left">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4 border border-brand-100"
          >
            <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></div>
            Sistem Penjadwalan IFP v2.0
          </motion.div>
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-4"
          >
            JADWAL PENGGUNAAN IFP <span className="text-brand-600">SD NEGERI LEUWIGAJAH 3</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-slate-500 max-w-2xl text-lg leading-relaxed"
          >
            Pantau dan atur penggunaan Interactive Flat Panel (IFP) dengan mudah. 
            Pastikan setiap kelas mendapatkan kesempatan belajar yang sama.
          </motion.p>
        </div>

        {/* Supabase Config Warning */}
        {!isSupabaseConfigured && (
          <div className="mb-10 bg-amber-50 border border-amber-200 rounded-3xl p-6 flex items-start gap-4 shadow-sm">
            <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="text-amber-600 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-900 uppercase tracking-wider mb-1">Konfigurasi Database Diperlukan</p>
              <p className="text-sm text-amber-700 leading-relaxed">
                Silakan hubungi administrator untuk mengatur <strong>VITE_SUPABASE_URL</strong> dan <strong>VITE_SUPABASE_ANON_KEY</strong>.
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
        <div className="space-y-12">
          {WEEKS.map((weekLabel, weekIdx) => (
            <div key={weekIdx} className="space-y-6">
              <div className="flex items-end justify-between px-2">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{weekLabel}</h3>
                  <p className="text-sm text-slate-400 font-medium">
                    {format(getSlotDate(weekIdx, 0), 'd MMMM', { locale: id })} — {format(getSlotDate(weekIdx, 4), 'd MMMM yyyy', { locale: id })}
                  </p>
                </div>
                <div className="hidden md:block h-px flex-1 bg-slate-100 mx-8 mb-2"></div>
                <div className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] mb-1">
                  Week {weekIdx + 1} Cycle
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                {DAYS.map((dayName, dayIdx) => {
                  const slotDate = getSlotDate(weekIdx, dayIdx);
                  const isToday = isSameDay(slotDate, today);
                  const owner = getSlotOwner(weekIdx, dayIdx);
                  const isMe = currentTeacher && owner?.id === currentTeacher.id;
                  
                  const slotBooking = bookings.find(b => b.week_index === weekIdx && b.day_index === dayIdx);
                  const isNegotiated = slotBooking?.type === 'negotiated';
                  const myPendingNego = currentTeacher && slotBooking ? negoRequests.find(r => r.booking_id === slotBooking.id && r.from_teacher_id === currentTeacher.id) : null;

                  return (
                    <motion.div 
                      key={dayIdx}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: (weekIdx * 5 + dayIdx) * 0.03 }}
                      className={cn(
                        "relative group flex flex-col min-h-[220px] rounded-[32px] p-6 transition-all duration-500",
                        isToday ? "ring-2 ring-brand-500 ring-offset-4" : "border border-slate-100 bg-white/50 backdrop-blur-sm hover:bg-white hover:shadow-2xl hover:shadow-brand-100/50"
                      )}
                    >
                      {/* Date Header */}
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex flex-col">
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-widest",
                            isToday ? "text-brand-600" : "text-slate-400"
                          )}>
                            {dayName}
                          </span>
                          <span className={cn(
                            "text-lg font-bold tracking-tight",
                            isToday ? "text-slate-900" : "text-slate-700"
                          )}>
                            {format(slotDate, 'd MMM', { locale: id })}
                          </span>
                        </div>
                        {isToday && (
                          <div className="px-2 py-1 bg-brand-600 text-white text-[8px] font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-brand-200">
                            Today
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 flex flex-col">
                        {owner ? (
                          <div className="flex flex-col h-full">
                            <div className="flex items-start justify-between mb-4">
                              <div className={cn(
                                "w-10 h-10 rounded-2xl flex items-center justify-center shadow-inner transition-colors duration-300",
                                isMe ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-400 group-hover:bg-brand-50 group-hover:text-brand-500"
                              )}>
                                <User className="w-5 h-5" />
                              </div>
                              <div className="flex flex-col gap-1 items-end">
                                {isNegotiated && (
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold uppercase tracking-widest rounded-full">
                                    Nego
                                  </span>
                                )}
                                {myPendingNego && (
                                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[8px] font-bold uppercase tracking-widest rounded-full">
                                    Pending
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="mt-auto">
                              <p className={cn(
                                "text-sm font-bold tracking-tight line-clamp-1",
                                isMe ? "text-brand-700" : "text-slate-900"
                              )}>
                                {owner.name}
                              </p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                {owner.isClassTeacher ? 'Wali Kelas' : 'Guru Mapel'}
                              </p>
                            </div>

                            {/* Action Overlay */}
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-slate-900/90 backdrop-blur-sm rounded-[32px] flex flex-col items-center justify-center p-6 text-center">
                              <div className="mb-4">
                                <p className="text-white font-bold text-sm mb-1">{owner.name}</p>
                                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                                  {owner.isClassTeacher ? 'Wali Kelas' : 'Guru Mapel'}
                                </p>
                              </div>
                              
                              {loading ? (
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-500 border-t-transparent"></div>
                              ) : isMe && slotBooking && slotBooking.type !== 'default' ? (
                                <button 
                                  onClick={() => handleActionWithAuth('cancel_booking', slotBooking.id!)}
                                  className="w-full py-3 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Batal Booking
                                </button>
                              ) : !isMe && myPendingNego ? (
                                <button 
                                  onClick={() => handleActionWithAuth('cancel_nego', myPendingNego.id!)}
                                  className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                  <XCircle className="w-4 h-4" />
                                  Batal Nego
                                </button>
                              ) : !isMe ? (
                                <button 
                                  onClick={() => handleActionWithAuth('nego_request', { week: weekIdx, day: dayIdx })}
                                  className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-brand-900/20"
                                >
                                  <ArrowRightLeft className="w-4 h-4" />
                                  Nego Jadwal
                                </button>
                              ) : (
                                <div className="p-3 bg-brand-500/20 rounded-2xl border border-brand-500/30">
                                  <CheckCircle2 className="text-brand-400 w-6 h-6 mx-auto mb-1" />
                                  <p className="text-[10px] text-brand-200 font-bold uppercase tracking-widest">Jadwal Anda</p>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleActionWithAuth('booking', { week: weekIdx, day: dayIdx })}
                            className="flex-1 w-full border-2 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center gap-3 group/btn hover:border-brand-300 hover:bg-brand-50/50 transition-all duration-300"
                          >
                            <div className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center group-hover/btn:bg-brand-100 group-hover/btn:scale-110 transition-all duration-300">
                              <Clock className="text-slate-300 group-hover/btn:text-brand-600 w-5 h-5" />
                            </div>
                            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] group-hover/btn:text-brand-600">Booking Slot</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-8 p-8 glass rounded-[32px] border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-brand-600 rounded-lg shadow-lg shadow-brand-100"></div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Jadwal Anda</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-white border-2 border-slate-100 rounded-lg"></div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Guru Lain</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-dashed border-slate-200 rounded-lg"></div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Slot Kosong</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-amber-400 rounded-lg shadow-lg shadow-amber-100"></div>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Hasil Nego</span>
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
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 overflow-hidden border border-slate-100"
            >
              <div className="flex items-center gap-5 mb-8">
                <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center shadow-inner">
                  <ArrowRightLeft className="text-amber-600 w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Negosiasi Jadwal</h3>
                  <p className="text-sm text-slate-500">Kirim pesan ke <span className="font-bold text-slate-700">{getSlotOwner(selectedSlot.week, selectedSlot.day)?.name}</span></p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Waktu Terpilih</span>
                    <span className="text-sm font-bold text-brand-600">{WEEKS[selectedSlot.week]}, {DAYS[selectedSlot.day]}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Pesan Negosiasi</label>
                  <textarea 
                    value={negoMessage}
                    onChange={(e) => setNegoMessage(e.target.value)}
                    placeholder="Contoh: Boleh tukar jadwal? Saya ada keperluan mendesak..."
                    className="w-full bg-slate-50 border-2 border-transparent rounded-3xl p-5 text-sm focus:border-brand-500 focus:bg-white transition-all outline-none min-h-[120px] resize-none"
                  />
                </div>

                <div className="flex gap-4 pt-2">
                  <button 
                    onClick={() => setShowNegoModal(false)}
                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Batal
                  </button>
                  <button 
                    onClick={handleNegoRequest}
                    className="flex-1 px-6 py-4 bg-brand-600 text-white font-bold rounded-2xl shadow-xl shadow-brand-200 hover:bg-brand-700 transition-all active:scale-95"
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
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 overflow-hidden border border-slate-100"
            >
              <div className="flex flex-col items-center mb-10">
                <div className="w-20 h-20 bg-brand-600 rounded-[32px] flex items-center justify-center mb-6 shadow-2xl shadow-brand-200 rotate-3 group-hover:rotate-0 transition-transform duration-500">
                  <Lock className="text-white w-10 h-10" />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Verifikasi Guru</h1>
                <p className="text-slate-500 text-sm mt-2 text-center">Masukkan 3 digit kode akses Anda untuk mengelola jadwal</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-8">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4 ml-1 text-center">
                    Kode Akses Guru
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-brand-500 transition-colors w-6 h-6" />
                    <input 
                      type="password"
                      maxLength={3}
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder="•••"
                      className="w-full bg-slate-50 border-2 border-transparent rounded-3xl py-5 pl-16 pr-6 text-2xl font-mono tracking-[1em] focus:border-brand-500 focus:bg-white transition-all outline-none text-center"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowLoginModal(false);
                      setPendingAction(null);
                    }}
                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-brand-200 transition-all active:scale-95"
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
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">© 2024 IFP Scheduler System • SD NEGERI LEUWIGAJAH 3</p>
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">System Operational</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
