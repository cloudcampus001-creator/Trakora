import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Inbox, ShieldCheck, CheckCircle2, BellRing } from 'lucide-react';
import { printThermalReceipt } from '../utils/printer';

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
  
  // NEW: The Remote Print Queue State
  const [printQueue, setPrintQueue] = useState([]);

  useEffect(() => {
    loadDashboardData();

    // Setup the Realtime Listener
    const masterChannel = supabase
      .channel('bursar_realtime_ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
          loadDashboardData();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_transactions' }, async (payload) => {
          // 1. A new transaction occurred! Reload the UI.
          loadDashboardData();

          // 2. Check if this is a REMOTE payment (e.g., from a Parent's phone via MoMo)
          const newTxn = payload.new;
          
          if (newTxn.school_id === userProfile.school_id && newTxn.payment_method.includes('MOMO')) {
              
              const { data: studentInfo } = await supabase
                  .from('students')
                  .select('full_name, matricule, classes(name)')
                  .eq('id', newTxn.student_id)
                  .single();

              if (studentInfo) {
                  // Construct the receipt object
                  const receiptData = {
                      id: newTxn.id,
                      student_name: studentInfo.full_name,
                      matricule: studentInfo.matricule,
                      class_name: studentInfo.classes?.name,
                      type: newTxn.type === 'REGISTRATION' ? 'Validation Inscription / Registration Fee' : 'Paiement Scolarité / Tuition Fee',
                      amount: newTxn.amount,
                      payment_method: newTxn.payment_method.replace(/_/g, ' '),
                      bursar_name: 'Paiement en ligne (MoMo)' 
                  };

                  // 3. Push to the Print Queue so the Bursar can tap to print
                  setPrintQueue(prev => [...prev, receiptData]);
                  toast('Remote payment received! Ready to print.', { icon: '🔔', duration: 5000 });
              }
          }
      })
      .subscribe();

    return () => supabase.removeChannel(masterChannel);
  }, [schoolConfig, userProfile]); 

  async function loadDashboardData() {
    const { data: configData, error: cfgError } = await supabase
      .from('school_configs')
      .select('*, schools(name)')
      .eq('school_id', userProfile.school_id)
      .single();

    if (cfgError) setConfigError(true);
    if (configData) {
      const fullConfig = { ...configData, name: configData.schools?.name };
      setSchoolConfig(fullConfig);
      setConfigError(false);
    }

    const { data: pending } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('school_id', userProfile.school_id)
      .eq('application_status', 'PENDING_REVIEW')
      .order('created_at', { ascending: false });
    setPendingApps(pending || []);

    const { data: approved } = await supabase
      .from('students')
      .select('*, classes(name, segmented_registration_fee)')
      .eq('school_id', userProfile.school_id)
      .eq('application_status', 'APPROVED')
      .order('created_at', { ascending: false });
    setApprovedApps(approved || []);

    const { data: txns } = await supabase
      .from('financial_transactions')
      .select('*, students(full_name, matricule, gender, date_of_birth, place_of_birth, parent_phone, classes(name))')
      .eq('school_id', userProfile.school_id)
      .order('created_at', { ascending: false })
      .limit(100);
    setCompletedTxns(txns || []);
  }

  // --- Process the Queue ---
  async function handleProcessQueue() {
    if (printQueue.length === 0) return;
    const targetReceipt = printQueue[0];
    
    // We send 'true' to keep the printing smooth and silent, but it is triggered by a tap.
    await printThermalReceipt(targetReceipt, schoolConfig, true);
    
    // Remove the printed receipt from the queue
    setPrintQueue(prev => prev.slice(1));
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
    if (error) toast.error('Action error: ' + error.message, { id: toastId });
    else toast.success(`Application marked as ${decision}`, { id: toastId });
  }

  async function executeDigitizedPayment(e, targetStudent, amount, feeType, isFallbackSearch = false) {
    e.preventDefault();
    if (!amount || amount <= 0) return toast.error('Invalid financial amount.');

    const toastId = toast.loading(`Processing ${Number(amount).toLocaleString()} XAF...`);

    const { data: transaction, error: txnError } = await supabase
      .from('financial_transactions')
      .insert([{
        school_id:      userProfile.school_id,
        student_id:     targetStudent.id,
        amount:         Number(amount),
        type:           feeType,
        payment_method: 'CASH',
        processed_by:   userProfile.id,
        status:         'COMPLETED',
      }])
      .select()
      .single();

    if (txnError) return toast.error('Transaction failed: ' + txnError.message, { id: toastId });

    const updates = {};
    if (feeType === 'REGISTRATION') {
      updates.application_status = 'COMPLETED';
      updates.is_registered      = true;
    } else if (feeType === 'TUITION') {
      updates.tuition_paid = Number(targetStudent.tuition_paid || 0) + Number(amount);
    }

    const { error: studentError } = await supabase
      .from('students')
      .update(updates)
      .eq('id', targetStudent.id);

    if (studentError) return toast.error('Lifecycle update error.', { id: toastId });

    toast.success(
      `${Number(amount).toLocaleString()} XAF recorded successfully.`,
      { id: toastId, duration: 4000 }
    );

    const receiptData = {
      id:             transaction.id,
      student_name:   targetStudent.full_name,
      matricule:      targetStudent.matricule,
      class_name:     targetStudent.classes?.name   || null,
      gender:         targetStudent.gender          || null,
      date_of_birth:  targetStudent.date_of_birth   || null,
      place_of_birth: targetStudent.place_of_birth  || null,
      parent_phone:   targetStudent.parent_phone    || null,
      type:           feeType === 'REGISTRATION' ? 'Validation Inscription / Registration Fee' : 'Paiement Scolarité / Tuition Fee',
      amount:         transaction.amount,
      payment_method: 'ESPÈCES / CASH',
      bursar_name:    userProfile.full_name,
      created_at:     transaction.created_at,
    };

    printThermalReceipt(receiptData, schoolConfig, false);

    if (isFallbackSearch) {
      setSearchedStudent(null);
      setSearchAmount('');
    } else {
      setActivePaymentStudent(null);
    }
  }

  async function searchStudentByMatricule() {
    const toastId = toast.loading('Querying ledger...');
    const { data } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('school_id', userProfile.school_id)
      .eq('matricule', searchMatricule)
      .single();

    if (data) {
      setSearchedStudent(data);
      toast.success('Student Profile Loaded.', { id: toastId });
    } else {
      toast.error('No student matching this matricule registered.', { id: toastId });
    }
  }

  function buildReprintData(tx) {
    return {
      id:             tx.id,
      student_name:   tx.students?.full_name        || 'N/A',
      matricule:      tx.students?.matricule         || 'N/A',
      class_name:     tx.students?.classes?.name    || null,
      gender:         tx.students?.gender           || null,
      date_of_birth:  tx.students?.date_of_birth    || null,
      place_of_birth: tx.students?.place_of_birth   || null,
      parent_phone:   tx.students?.parent_phone     || null,
      type:           tx.type === 'REGISTRATION' ? 'Validation Inscription / Registration Fee' : 'Paiement Scolarité / Tuition Fee',
      amount:         tx.amount,
      payment_method: (tx.payment_method || 'CASH').replace('_SIMULATED', '').replace(/_/g, ' '),
      bursar_name:    userProfile.full_name,
      created_at:     tx.created_at,
    };
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 md:space-y-10">

      {/* NEW: THE REMOTE PAYMENT PRINT QUEUE BANNER */}
      {printQueue.length > 0 && (
        <div className="bg-emerald-600 text-white p-4 md:p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-emerald-500 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-full"><BellRing size={24} /></div>
            <div>
              <p className="font-black text-lg">Parent MoMo Payment Received!</p>
              <p className="text-sm font-medium text-emerald-100">Ready to print receipt for {printQueue[0].student_name}</p>
            </div>
          </div>
          <button
            onClick={handleProcessQueue}
            className="w-full sm:w-auto bg-white text-emerald-700 px-6 py-3 rounded-xl font-black shadow-lg hover:bg-emerald-50 transition uppercase tracking-wider text-sm"
          >
            Tap to Print Receipt
          </button>
        </div>
      )}

      {/* GLOBAL SEARCH UTILITY */}
      <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-[10px] md:text-xs font-black uppercase tracking-wider text-slate-400 mb-3">
          Direct Matricule Ledger Search
        </h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="border-2 border-slate-100 p-3 flex-1 rounded-xl focus:border-slate-400 transition outline-none font-bold text-sm text-slate-900"
            placeholder="e.g. MAT-001"
            value={searchMatricule}
            onChange={e => setSearchMatricule(e.target.value)}
          />
          <button
            onClick={searchStudentByMatricule}
            className="bg-slate-900 text-white p-3 md:px-6 md:py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg shadow-slate-900/20 text-sm"
          >
            Search Network
          </button>
        </div>

        {searchedStudent && (
          <form
            onSubmit={(e) => executeDigitizedPayment(e, searchedStudent, searchAmount, searchType, true)}
            className="space-y-4 border-t border-slate-100 mt-5 pt-5 md:mt-6 md:pt-6 animate-fadeIn"
          >
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <p className="font-black text-slate-900 text-base md:text-lg flex items-center gap-2">
                  <ShieldCheck className="text-emerald-500 w-4 h-4 md:w-5 md:h-5"/>
                  {searchedStudent.full_name}
                </p>
                <p className="text-xs md:text-sm text-slate-600 font-medium">
                  Class Group: {searchedStudent.classes?.name || 'Unassigned'}
                </p>
              </div>
              <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700">
                Status: {searchedStudent.application_status}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <div>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 md:mb-2">
                  Fee Allocation Type
                </label>
                <select
                  className="border-2 border-slate-100 p-3 w-full rounded-xl text-slate-900 bg-white font-bold outline-none focus:border-emerald-500 transition text-sm"
                  value={searchType}
                  onChange={e => setSearchType(e.target.value)}
                >
                  <option value="TUITION">Tuition Allocation</option>
                  <option value="REGISTRATION">Registration Validation</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 md:mb-2">
                  Amount Collected (XAF)
                </label>
                <input
                  type="number"
                  className="border-2 border-slate-100 p-3 w-full rounded-xl text-slate-900 bg-white font-bold outline-none focus:border-emerald-500 transition text-sm"
                  placeholder="e.g. 50000"
                  value={searchAmount}
                  onChange={e => setSearchAmount(e.target.value)}
                  required
                />
              </div>
            </div>

            <button className="bg-emerald-600 text-white w-full p-3.5 md:p-4 rounded-xl font-black text-xs md:text-sm uppercase tracking-wider hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
              Process Cash &amp; Print Receipt
            </button>
          </form>
        )}
      </div>

      {/* PRIORITY BLOCK 1 — Pending Approvals */}
      <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
        <div className="bg-amber-50 px-4 md:px-6 py-4 md:py-5 border-b border-amber-200 flex justify-between items-center">
          <h2 className="text-base md:text-lg font-black text-amber-900 uppercase tracking-tight truncate mr-2">
            1. Pending Approvals
          </h2>
          <span className="bg-amber-200 text-amber-900 font-black text-[10px] md:text-xs px-2 md:px-3 py-1 rounded-lg shadow-sm whitespace-nowrap">
            {pendingApps.length} Required
          </span>
        </div>

        <div className="p-4 md:p-6 divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {pendingApps.length === 0 ? (
            <div className="py-6 md:py-8 flex flex-col items-center text-slate-300">
              <Inbox size={40} className="mb-2 md:mb-3 opacity-50"/>
              <p className="font-bold text-xs md:text-sm text-center">Admissions verification queue is clean.</p>
            </div>
          ) : (
            pendingApps.map(app => (
              <div key={app.id} className="py-4 md:py-5 first:pt-0 last:pb-0 flex flex-col md:flex-row justify-between md:items-center gap-3 md:gap-4">
                <div className="w-full">
                  <div className="flex justify-between items-baseline mb-2">
                    <p className="font-black text-slate-900 text-base md:text-lg">{app.full_name}</p>
                    <p className="text-[9px] md:text-[10px] uppercase font-mono font-black text-slate-400 bg-slate-50 px-2 py-1 rounded border">
                      ID: {app.matricule}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] md:text-xs font-medium text-slate-600 bg-slate-50 p-2.5 md:p-3 rounded-xl border border-slate-100">
                    <p>Class: <span className="text-slate-900 font-bold">{app.classes?.name}</span></p>
                    <p>Contact: <span className="text-slate-900 font-mono font-bold truncate block sm:inline">{app.parent_phone}</span></p>
                    <p>Gender: <span className="text-slate-900 font-bold">{app.gender || 'N/A'}</span></p>
                    <p>DOB: <span className="text-slate-900 font-bold">{app.date_of_birth || 'N/A'}</span></p>
                  </div>
                </div>
                <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto mt-2 md:mt-0">
                  <button
                    onClick={() => handleApplicationDecision(app.id, 'APPROVED')}
                    className="flex-1 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold hover:bg-emerald-700 transition shadow-sm"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleApplicationDecision(app.id, 'REJECTED')}
                    className="flex-1 bg-rose-50 text-rose-700 px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold hover:bg-rose-100 transition"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 2 — Waiting Registration Payment */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 overflow-hidden">
        <div className="bg-indigo-50 px-4 md:px-6 py-4 md:py-5 border-b border-indigo-200 flex justify-between items-center">
          <h2 className="text-base md:text-lg font-black text-indigo-900 uppercase tracking-tight truncate mr-2">
            2. Waiting Registration Payment
          </h2>
          <span className="bg-indigo-200 text-indigo-900 font-black text-[10px] md:text-xs px-2 md:px-3 py-1 rounded-lg shadow-sm whitespace-nowrap">
            {approvedApps.length} Pending
          </span>
        </div>

        <div className="p-4 md:p-6 divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {configError && (
            <div className="bg-rose-100 text-rose-800 p-3 md:p-4 mb-3 md:mb-4 rounded-xl text-xs md:text-sm font-bold flex items-center gap-2 border border-rose-200">
              ⚠️ DB Error: Check RLS.
            </div>
          )}

          {approvedApps.length === 0 ? (
            <div className="py-6 md:py-8 flex flex-col items-center text-slate-300">
              <CheckCircle2 size={40} className="mb-2 md:mb-3 opacity-50"/>
              <p className="font-bold text-xs md:text-sm text-center">No approved applications awaiting settlement.</p>
            </div>
          ) : (
            approvedApps.map(app => {
              const standardFee = calculateMandatedRegistrationFee(app);

              return (
                <div key={app.id} className="py-4 md:py-5 first:pt-0 last:pb-0">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <p className="font-black text-slate-900 text-base md:text-lg">{app.full_name}</p>
                      <div className="text-[10px] md:text-xs font-semibold text-slate-500 mt-1 flex flex-wrap items-center gap-1">
                        <span>Class: <span className="text-indigo-600 font-bold">{app.classes?.name}</span></span>
                        <span className="hidden sm:inline mx-1 text-slate-300">|</span>
                        <span>Fee: <span className={standardFee === 0
                          ? 'text-rose-600 font-black bg-rose-50 px-1.5 md:px-2 py-0.5 rounded'
                          : 'text-slate-900 font-black bg-slate-100 px-1.5 md:px-2 py-0.5 rounded'
                        }>{standardFee.toLocaleString()} XAF</span></span>
                      </div>
                    </div>

                    {activePaymentStudent?.id !== app.id ? (
                      <button
                        onClick={() => setActivePaymentStudent(app)}
                        className="w-full sm:w-auto bg-indigo-600 text-white px-4 md:px-5 py-2 md:py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/20"
                      >
                        Process Cash
                      </button>
                    ) : (
                      <button
                        onClick={() => setActivePaymentStudent(null)}
                        className="w-full sm:w-auto text-xs font-bold text-slate-500 hover:text-slate-700 px-3 py-2 bg-slate-100 rounded-lg"
                      >
                        Cancel Form
                      </button>
                    )}
                  </div>

                  {activePaymentStudent?.id === app.id && (
                    <form
                      onSubmit={(e) => executeDigitizedPayment(e, app, standardFee, 'REGISTRATION', false)}
                      className="mt-4 md:mt-5 p-4 md:p-5 bg-slate-50 rounded-xl border border-indigo-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fadeIn"
                    >
                      <div className="space-y-0.5 md:space-y-1">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-indigo-400 tracking-widest">Locked Route</p>
                        <p className="text-xs md:text-sm font-black text-slate-800 uppercase">REGISTRATION VALIDATION</p>
                      </div>

                      <div className="w-full md:w-auto bg-white px-4 md:px-5 py-2.5 md:py-3 rounded-xl border border-slate-200 text-left md:text-right min-w-[140px] md:min-w-[160px] shadow-sm">
                        <p className="text-[9px] md:text-[10px] font-black uppercase text-slate-400">Enforced Value</p>
                        <p className="font-mono text-lg md:text-xl font-black text-slate-900">
                          {standardFee.toLocaleString()} <span className="text-[10px] md:text-xs text-slate-400">XAF</span>
                        </p>
                      </div>

                      <button
                        type="submit"
                        className="w-full md:w-auto bg-emerald-600 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30"
                      >
                        Remit Cash &amp; Print
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 3 — Settlement Ledger */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 md:px-6 py-4 md:py-5 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-base md:text-lg font-black text-slate-800 uppercase tracking-tight truncate mr-2">
            3. Settlement Ledger
          </h2>
          <span className="bg-emerald-100 text-emerald-800 font-bold text-[9px] md:text-[10px] uppercase tracking-widest px-2 md:px-3 py-1.5 rounded-lg flex items-center gap-1 md:gap-2 whitespace-nowrap">
            <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse"></span> Audited Engine
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[500px]">
            <thead>
              <tr className="bg-white border-b border-slate-100 text-[9px] md:text-[10px] font-black tracking-widest text-slate-400 uppercase">
                <th className="p-3 md:p-5">Student Identity</th>
                <th className="p-3 md:p-5">Class Target</th>
                <th className="p-3 md:p-5">Allocation</th>
                <th className="p-3 md:p-5 text-right">Value Settled</th>
                <th className="p-3 md:p-5 text-center">Route</th>
                <th className="p-3 md:p-5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-xs md:text-sm">
              {completedTxns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 md:p-12 text-center text-slate-400 font-medium text-xs md:text-sm">
                    No confirmed logs indexed on system nodes.
                  </td>
                </tr>
              ) : (
                completedTxns.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition">
                    <td className="p-3 md:p-5 font-black text-slate-900">
                      {tx.students?.full_name || 'System Managed'}
                    </td>
                    <td className="p-3 md:p-5 text-slate-500 font-bold">
                      {tx.students?.classes?.name || 'N/A'}
                    </td>
                    <td className="p-3 md:p-5">
                      <span className={`px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-wider ${tx.type === 'REGISTRATION' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-3 md:p-5 font-black text-right text-slate-900">
                      {Number(tx.amount).toLocaleString()} <span className="text-[9px] md:text-[10px] text-slate-400">XAF</span>
                    </td>
                    <td className="p-3 md:p-5 text-center">
                      <span className="bg-slate-100 text-slate-500 text-[8px] md:text-[9px] font-mono font-black uppercase tracking-widest px-1.5 md:px-2 py-1 rounded border">
                        {(tx.payment_method || 'CASH').replace('_SIMULATED', '')}
                      </span>
                    </td>
                    <td className="p-3 md:p-5 text-center">
                      <button
                        onClick={() => printThermalReceipt(buildReprintData(tx), schoolConfig, false)}
                        className="bg-slate-200 text-slate-700 hover:bg-slate-300 px-3 py-1.5 rounded text-xs font-bold transition"
                      >
                        Reprint
                      </button>
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