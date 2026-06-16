import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { BellRing, CheckCircle2, Inbox, ShieldCheck } from 'lucide-react';
import { printThermalReceipt } from '../utils/printer';

export default function BursarDashboard({ userProfile }) {
  const [pendingApps, setPendingApps] = useState([]);
  const [approvedApps, setApprovedApps] = useState([]);
  const [completedTxns, setCompletedTxns] = useState([]);
  const [schoolConfig, setSchoolConfig] = useState(null);
  const [printQueue, setPrintQueue] = useState([]);

  useEffect(() => {
    loadDashboardData();

    // LISTEN FOR REMOTE PRINT JOBS (From Parents)
    const printerChannel = supabase
      .channel('remote_printing')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'print_jobs',
        filter: `school_id=eq.${userProfile.school_id}` 
      }, (payload) => {
        setPrintQueue(prev => [...prev, payload.new.content]);
        toast('New Remote Payment Receipt Ready!', { icon: '🖨️', duration: 5000 });
      })
      .subscribe();

    // LISTEN FOR STUDENT UPDATES
    const studentChannel = supabase
        .channel('students_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => loadDashboardData())
        .subscribe();

    return () => {
        supabase.removeChannel(printerChannel);
        supabase.removeChannel(studentChannel);
    };
  }, [userProfile]);

  async function loadDashboardData() {
    const { data: config } = await supabase.from('school_configs').select('*, schools(name)').eq('school_id', userProfile.school_id).single();
    if (config) setSchoolConfig({ ...config, name: config.schools?.name });

    const { data: pending } = await supabase.from('students').select('*, classes(*)').eq('school_id', userProfile.school_id).eq('application_status', 'PENDING_REVIEW');
    setPendingApps(pending || []);

    const { data: approved } = await supabase.from('students').select('*, classes(*)').eq('school_id', userProfile.school_id).eq('application_status', 'APPROVED');
    setApprovedApps(approved || []);

    const { data: txns } = await supabase.from('financial_transactions').select('*, students(*)').eq('school_id', userProfile.school_id).order('created_at', { ascending: false }).limit(20);
    setCompletedTxns(txns || []);
  }

  async function handleProcessPrint() {
    if (printQueue.length === 0) return;
    const job = printQueue[0];
    await printThermalReceipt(job, schoolConfig, false);
    setPrintQueue(prev => prev.slice(1));
  }

  async function handleDecision(id, status) {
    await supabase.from('students').update({ application_status: status }).eq('id', id);
    toast.success(`Application ${status}`);
    loadDashboardData();
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      
      {/* REMOTE PRINT NOTIFICATION */}
      {printQueue.length > 0 && (
        <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-xl flex justify-between items-center animate-bounce">
          <div className="flex items-center gap-4">
            <BellRing size={32} />
            <div>
              <p className="font-black text-xl">Remote Receipt Request</p>
              <p className="opacity-90">Parent paid via MoMo and requested a print for {printQueue[0].student_name}</p>
            </div>
          </div>
          <button onClick={handleProcessPrint} className="bg-white text-emerald-700 px-8 py-3 rounded-xl font-black shadow-lg">
            PRINT NOW
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* PENDING ADMISSIONS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border">
          <h2 className="font-black text-lg mb-4 text-amber-600 flex items-center gap-2">
            <Inbox /> 1. New Applications ({pendingApps.length})
          </h2>
          <div className="space-y-4">
            {pendingApps.map(app => (
              <div key={app.id} className="p-4 bg-slate-50 rounded-xl flex justify-between items-center">
                <div>
                  <p className="font-bold">{app.full_name}</p>
                  <p className="text-xs text-slate-500">{app.classes?.name}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleDecision(app.id, 'APPROVED')} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold">Approve</button>
                  <button onClick={() => handleDecision(app.id, 'REJECTED')} className="bg-rose-100 text-rose-600 px-4 py-2 rounded-lg text-xs font-bold">Deny</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT LEDGER */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border">
          <h2 className="font-black text-lg mb-4 text-slate-800 flex items-center gap-2">
            <ShieldCheck /> 2. Recent Payments
          </h2>
          <div className="space-y-3">
            {completedTxns.map(tx => (
              <div key={tx.id} className="flex justify-between items-center border-b pb-2">
                <p className="text-sm font-medium">{tx.students?.full_name}</p>
                <p className="font-black">{tx.amount.toLocaleString()} XAF</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}