import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Inbox, ShieldCheck, CheckCircle2 } from 'lucide-react';

export default function BursarDashboard({ userProfile }) {
  const [pendingApps, setPendingApps] = useState([]);
  const [approvedApps, setApprovedApps] = useState([]);
  const [completedTxns, setCompletedTxns] = useState([]);
  const [schoolConfig, setSchoolConfig] = useState(null); 
  const [configError, setConfigError] = useState(false); 

  const [searchMatricule, setSearchMatricule] = useState('');
  const [searchedStudent, setSearchedStudent] = useState(null);
  const [searchAmount, setSearchAmount] = useState('');
  const [searchType, setSearchType] = useState('TUITION');

  const [activePaymentStudent, setActivePaymentStudent] = useState(null);

  useEffect(() => {
    loadDashboardData();

    const masterChannel = supabase
      .channel('bursar_realtime_ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => loadDashboardData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_transactions' }, () => loadDashboardData())
      .subscribe();

    return () => supabase.removeChannel(masterChannel);
  }, []);

  async function loadDashboardData() {
    const { data: config, error: cfgError } = await supabase.from('school_configs').select('*').eq('school_id', userProfile.school_id).single();
      
    if (cfgError) setConfigError(true);
    if (config) { setSchoolConfig(config); setConfigError(false); }

    const { data: pending } = await supabase.from('students').select('*, classes(name)').eq('school_id', userProfile.school_id).eq('application_status', 'PENDING_REVIEW').order('created_at', { ascending: false });
    setPendingApps(pending || []);

    const { data: approved } = await supabase.from('students').select('*, classes(name, segmented_registration_fee)').eq('school_id', userProfile.school_id).eq('application_status', 'APPROVED').order('created_at', { ascending: false });
    setApprovedApps(approved || []);

    // Implemented pagination limit to prevent DOM memory bloat in production
    const { data: txns } = await supabase.from('financial_transactions').select('*, students(full_name, classes(name))').eq('school_id', userProfile.school_id).order('created_at', { ascending: false }).limit(100);
    setCompletedTxns(txns || []);
  }

  function calculateMandatedRegistrationFee(student) {
    if (!schoolConfig) return 0;
    return schoolConfig.fee_structure === 'UNIFORM'
      ? Number(schoolConfig.uniform_registration_fee || 0)
      : Number(student.classes?.segmented_registration_fee || 0);
  }

  async function handleApplicationDecision(studentId, decision) {
    const toastId = toast.loading('Processing decision...');
    const { error } = await supabase.from('students').update({ application_status: decision }).eq('id', studentId);
    if (error) toast.error("Action error: " + error.message, { id: toastId });
    else toast.success(`Application marked as ${decision}`, { id: toastId });
  }

  async function executeDigitizedPayment(e, targetStudent, amount, feeType, isFallbackSearch = false) {
    e.preventDefault();
    if (!amount || amount <= 0) return toast.error("Invalid financial amount.");

    const toastId = toast.loading(`Processing ${Number(amount).toLocaleString()} XAF...`);

    const { error: txnError } = await supabase.from('financial_transactions').insert([{
      school_id: userProfile.school_id, student_id: targetStudent.id, amount: Number(amount), type: feeType, payment_method: 'CASH_DIGITIZED_SIMULATED', processed_by: userProfile.id, status: 'COMPLETED'
    }]);

    if (txnError) return toast.error("Transaction failed: " + txnError.message, { id: toastId });

    const updates = {};
    if (feeType === 'REGISTRATION') {
        updates.application_status = 'COMPLETED';
        updates.is_registered = true;
    } else if (feeType === 'TUITION') {
        updates.tuition_paid = Number(targetStudent.tuition_paid || 0) + Number(amount);
    }

    const { error: studentError } = await supabase.from('students').update(updates).eq('id', targetStudent.id);

    if (studentError) return toast.error("Lifecycle update error.", { id: toastId });

    toast.success(`${Number(amount).toLocaleString()} XAF recorded successfully for ${targetStudent.full_name}.`, { id: toastId, duration: 4000 });
    
    if (isFallbackSearch) {
      setSearchedStudent(null);
      setSearchAmount('');
    } else {
      setActivePaymentStudent(null);
    }
  }

  async function searchStudentByMatricule() {
    const toastId = toast.loading('Querying ledger...');
    const { data } = await supabase.from('students').select('*, classes(name)').eq('school_id', userProfile.school_id).eq('matricule', searchMatricule).single();
    
    if (data) {
        setSearchedStudent(data);
        toast.success('Student Profile Loaded.', { id: toastId });
    } else {
        toast.error('No student matching this matricule registered.', { id: toastId });
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-10">
      
      {/* GLOBAL SEARCH UTILITY */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Direct Matricule Ledger Search</h3>
        <div className="flex gap-2">
          <input className="border-2 border-slate-100 p-3 flex-1 rounded-xl focus:border-slate-400 transition outline-none font-bold text-sm text-slate-900" placeholder="e.g. MAT-2026-001" value={searchMatricule} onChange={e => setSearchMatricule(e.target.value)} />
          <button onClick={searchStudentByMatricule} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg shadow-slate-900/20 text-sm">Search Network</button>
        </div>

        {searchedStudent && (
          <form onSubmit={(e) => executeDigitizedPayment(e, searchedStudent, searchAmount, searchType, true)} className="space-y-4 border-t border-slate-100 mt-6 pt-6 animate-fadeIn">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
              <div>
                <p className="font-black text-slate-900 text-lg flex items-center gap-2"><ShieldCheck className="text-emerald-500 w-5 h-5"/> {searchedStudent.full_name}</p>
                <p className="text-sm text-slate-600 font-medium">Class Group: {searchedStudent.classes?.name || 'Unassigned'}</p>
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700">Status: {searchedStudent.application_status}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">Fee Allocation Type</label>
                <select className="border-2 border-slate-100 p-3 w-full rounded-xl text-slate-900 bg-white font-bold outline-none focus:border-emerald-500 transition" value={searchType} onChange={e => setSearchType(e.target.value)}>
                  <option value="TUITION">Tuition Allocation</option>
                  <option value="REGISTRATION">Registration Validation</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">Amount Collected (XAF)</label>
                <input type="number" className="border-2 border-slate-100 p-3 w-full rounded-xl text-slate-900 bg-white font-bold outline-none focus:border-emerald-500 transition" placeholder="e.g. 50000" value={searchAmount} onChange={e => setSearchAmount(e.target.value)} required />
              </div>
            </div>
            <button className="bg-emerald-600 text-white w-full p-4 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
              Authorize Cash Digitization (Simulated)
            </button>
          </form>
        )}
      </div>

      {/* PRIORITY BLOCK 1 */}
      <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
        <div className="bg-amber-50 px-6 py-5 border-b border-amber-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-amber-900 uppercase tracking-tight">1. Pending Document Approvals</h2>
          <span className="bg-amber-200 text-amber-900 font-black text-xs px-3 py-1 rounded-lg shadow-sm">{pendingApps.length} Required</span>
        </div>
        
        <div className="p-6 divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {pendingApps.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-slate-300">
                <Inbox size={48} className="mb-3 opacity-50"/>
                <p className="font-bold text-sm">Admissions verification queue is clean.</p>
            </div>
          ) : (
            pendingApps.map(app => (
              <div key={app.id} className="py-5 first:pt-0 last:pb-0 flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div className="w-full">
                  <div className="flex justify-between items-baseline mb-2">
                    <p className="font-black text-slate-900 text-lg">{app.full_name}</p>
                    <p className="text-[10px] uppercase font-mono font-black text-slate-400 bg-slate-50 px-2 py-1 rounded border">ID: {app.matricule}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-medium text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p>Class: <span className="text-slate-900 font-bold">{app.classes?.name}</span></p>
                    <p>Contact: <span className="text-slate-900 font-mono font-bold">{app.parent_phone}</span></p>
                    <p>Gender: <span className="text-slate-900 font-bold">{app.gender || 'N/A'}</span></p>
                    <p>DOB: <span className="text-slate-900 font-bold">{app.date_of_birth || 'N/A'}</span></p>
                  </div>
                </div>
                <div className="flex flex-row md:flex-col gap-2 min-w-[120px]">
                  <button onClick={() => handleApplicationDecision(app.id, 'APPROVED')} className="flex-1 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-700 transition shadow-sm">Accept</button>
                  <button onClick={() => handleApplicationDecision(app.id, 'REJECTED')} className="flex-1 bg-rose-50 text-rose-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-rose-100 transition">Decline</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 2 */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 overflow-hidden">
        <div className="bg-indigo-50 px-6 py-5 border-b border-indigo-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-indigo-900 uppercase tracking-tight">2. Approved & Waiting Registration Payment</h2>
          <span className="bg-indigo-200 text-indigo-900 font-black text-xs px-3 py-1 rounded-lg shadow-sm">{approvedApps.length} Pending</span>
        </div>

        <div className="p-6 divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {configError && (
             <div className="bg-rose-100 text-rose-800 p-4 mb-4 rounded-xl text-sm font-bold flex items-center gap-2 border border-rose-200">
               ⚠️ Database Error: Supabase is blocking Fee Config reads. Check RLS.
             </div>
          )}

          {approvedApps.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-slate-300">
                <CheckCircle2 size={48} className="mb-3 opacity-50"/>
                <p className="font-bold text-sm">No approved applications awaiting settlement.</p>
            </div>
          ) : (
            approvedApps.map(app => {
              const standardFee = calculateMandatedRegistrationFee(app);
              
              return (
                <div key={app.id} className="py-5 first:pt-0 last:pb-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-black text-slate-900 text-lg">{app.full_name}</p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">
                        Class: <span className="text-indigo-600 font-bold">{app.classes?.name}</span>
                        <span className="mx-2 text-slate-300">|</span>
                        Mandated Fee: <span className={standardFee === 0 ? "text-rose-600 font-black bg-rose-50 px-2 py-0.5 rounded" : "text-slate-900 font-black bg-slate-100 px-2 py-0.5 rounded"}>{standardFee.toLocaleString()} XAF</span>
                      </p>
                    </div>
                    
                    {activePaymentStudent?.id !== app.id ? (
                      <button onClick={() => setActivePaymentStudent(app)} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/20">Process Cash</button>
                    ) : (
                      <button onClick={() => setActivePaymentStudent(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600 px-3 py-2 bg-slate-50 rounded-lg">Cancel</button>
                    )}
                  </div>

                  {activePaymentStudent?.id === app.id && (
                    <form onSubmit={(e) => executeDigitizedPayment(e, app, standardFee, 'REGISTRATION', false)} className="mt-5 p-5 bg-slate-50 rounded-xl border border-indigo-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-5 animate-fadeIn">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest">Locked Allocation Route</p>
                        <p className="text-sm font-black text-slate-800 uppercase">REGISTRATION FEE VALIDATION</p>
                      </div>

                      <div className="bg-white px-5 py-3 rounded-xl border border-slate-200 text-right min-w-[160px] shadow-sm">
                        <p className="text-[10px] font-black uppercase text-slate-400">Enforced Value</p>
                        <p className="font-mono text-xl font-black text-slate-900">{standardFee.toLocaleString()} <span className="text-xs text-slate-400">XAF</span></p>
                      </div>

                      <button type="submit" className="w-full md:w-auto bg-emerald-600 text-white px-8 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
                        Remit Cash
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 3 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-5 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">3. Live Transaction Settlement Ledger</h2>
          <span className="bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Audited Engine
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-100 text-[10px] font-black tracking-widest text-slate-400 uppercase">
                <th className="p-5">Student Identity</th>
                <th className="p-5">Class Target</th>
                <th className="p-5">Allocation</th>
                <th className="p-5 text-right">Value Settled</th>
                <th className="p-5 text-center">Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {completedTxns.length === 0 ? (
                <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-medium">No confirmed logs indexed on system nodes.</td></tr>
              ) : (
                completedTxns.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition">
                    <td className="p-5 font-black text-slate-900">{tx.students?.full_name || 'System Managed'}</td>
                    <td className="p-5 text-slate-500 font-bold">{tx.students?.classes?.name || 'N/A'}</td>
                    <td className="p-5">
                      <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${tx.type === 'REGISTRATION' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-5 font-black text-right text-slate-900">{Number(tx.amount).toLocaleString()} <span className="text-[10px] text-slate-400">XAF</span></td>
                    <td className="p-5 text-center">
                      <span className="bg-slate-100 text-slate-500 text-[9px] font-mono font-black uppercase tracking-widest px-2 py-1 rounded border">
                        {tx.payment_method.replace('_SIMULATED', '')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}