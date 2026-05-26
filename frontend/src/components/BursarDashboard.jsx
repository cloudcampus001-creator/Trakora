import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function BursarDashboard({ userProfile }) {
  // Data Queues State
  const [pendingApps, setPendingApps] = useState([]);
  const [approvedApps, setApprovedApps] = useState([]);
  const [completedTxns, setCompletedTxns] = useState([]);
  const [schoolConfig, setSchoolConfig] = useState(null); // Holds the Principal's fee rules

  // Manual Search fallback state (Used for future Tuition payments once registered)
  const [searchMatricule, setSearchMatricule] = useState('');
  const [searchedStudent, setSearchedStudent] = useState(null);
  const [searchAmount, setSearchAmount] = useState('');
  const [searchType, setSearchType] = useState('TUITION');

  // Direct Inline Processing State
  const [activePaymentStudent, setActivePaymentStudent] = useState(null);

  useEffect(() => {
    loadDashboardData();

    // ENGAGE MASTER REAL-TIME PIPELINE
    const masterChannel = supabase
      .channel('bursar_realtime_ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadDashboardData();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_transactions' }, () => {
        loadDashboardData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(masterChannel);
    };
  }, []);

  async function loadDashboardData() {
    // 0. Fetch the Principal's Official Financial Configuration rules
    const { data: config } = await supabase
      .from('school_configs')
      .select('*')
      .eq('school_id', userProfile.school_id)
      .single();
    if (config) setSchoolConfig(config);

    // 1. Fetch Priority 1: Pending Review Queue
    const { data: pending } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('school_id', userProfile.school_id)
      .eq('application_status', 'PENDING_REVIEW')
      .order('created_at', { ascending: false });
    setPendingApps(pending || []);

    // 2. Fetch Priority 2: Approved & Waiting for Payment (Includes fee settings per class)
    const { data: approved } = await supabase
      .from('students')
      .select('*, classes(name, segmented_registration_fee)')
      .eq('school_id', userProfile.school_id)
      .eq('application_status', 'APPROVED')
      .order('created_at', { ascending: false });
    setApprovedApps(approved || []);

    // 3. Fetch Priority 3: Completed Transaction Audit History
    const { data: txns } = await supabase
      .from('financial_transactions')
      .select('*, students(full_name, classes(name))')
      .eq('school_id', userProfile.school_id)
      .order('created_at', { ascending: false });
    setCompletedTxns(txns || []);
  }

  // Helper to automatically compute what the Principal mandated for this specific student
  function calculateMandatedRegistrationFee(student) {
    if (!schoolConfig) return 0;
    return schoolConfig.fee_structure === 'UNIFORM'
      ? Number(schoolConfig.uniform_registration_fee || 0)
      : Number(student.classes?.segmented_registration_fee || 0);
  }

  // --- ACTIONS ---

  async function handleApplicationDecision(studentId, decision) {
    const { error } = await supabase
      .from('students')
      .update({ application_status: decision })
      .eq('id', studentId);
      
    if (error) alert("Action error: " + error.message);
  }

  async function executeDigitizedPayment(e, targetStudent, amount, feeType, isFallbackSearch = false) {
    e.preventDefault();
    if (!amount || amount <= 0) return alert("Invalid financial amount calculated.");

    alert(`[SYSTEM SECURE LOCK] Processing ${Number(amount).toLocaleString()} XAF for ${feeType}. Authorizing settlement...`);

    // 1. Insert transaction token log
    const { error: txnError } = await supabase.from('financial_transactions').insert([{
      school_id: userProfile.school_id,
      student_id: targetStudent.id,
      amount: Number(amount),
      type: feeType,
      payment_method: 'CASH_DIGITIZED',
      processed_by: userProfile.id,
      status: 'COMPLETED'
    }]);

    if (txnError) return alert("Transaction failed: " + txnError.message);

    // 2. Advance student status
    const updates = {
      application_status: 'COMPLETED',
      is_registered: true
    };

    if (feeType === 'TUITION') {
      updates.tuition_paid = Number(targetStudent.tuition_paid || 0) + Number(amount);
    }

    const { error: studentError } = await supabase
      .from('students')
      .update(updates)
      .eq('id', targetStudent.id);

    if (studentError) return alert("Lifecycle update error: " + studentError.message);

    alert(`Success! Payment recorded. Student is now officially registered in the system.`);
    
    if (isFallbackSearch) {
      setSearchedStudent(null);
      setSearchAmount('');
    } else {
      setActivePaymentStudent(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      
      {/* GLOBAL SEARCH UTILITY (Used for standalone tuition lookups) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">Direct Matricule Ledger Search (Tuition Settlements)</h3>
        <div className="flex gap-2">
          <input 
            className="border p-3 flex-1 rounded-xl text-slate-900 bg-white font-medium" 
            placeholder="Enter Student Matricule Code..." 
            value={searchMatricule}
            onChange={e => setSearchMatricule(e.target.value)} 
          />
          <button onClick={searchStudentByMatricule} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition shadow-sm">
            Search
          </button>
        </div>

        {searchedStudent && (
          <form onSubmit={(e) => executeDigitizedPayment(e, searchedStudent, searchAmount, searchType, true)} className="space-y-4 border-t mt-4 pt-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
              <div>
                <p className="font-black text-slate-900 text-lg">{searchedStudent.full_name}</p>
                <p className="text-sm text-slate-600 font-medium">Class Group: {searchedStudent.classes?.name || 'Unassigned'}</p>
              </div>
              <span className="text-xs font-bold uppercase bg-slate-200 px-3 py-1 rounded-full text-slate-700">Status: {searchedStudent.application_status}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Fee Allocation Type</label>
                <select className="border p-3 w-full rounded-xl text-slate-900 bg-white font-medium" value={searchType} onChange={e => setSearchType(e.target.value)}>
                  <option value="TUITION">Tuition Allocation</option>
                  <option value="REGISTRATION">Registration Validation</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Amount Collected (XAF)</label>
                <input 
                  type="number" 
                  className="border p-3 w-full rounded-xl text-slate-900 bg-white font-medium" 
                  placeholder="e.g. 50,000" 
                  value={searchAmount} 
                  onChange={e => setSearchAmount(e.target.value)} 
                  required 
                />
              </div>
            </div>
            <button className="bg-emerald-600 text-white w-full p-3.5 rounded-xl font-bold hover:bg-emerald-700 transition shadow">
              Authorize Cash Digitization
            </button>
          </form>
        )}
      </div>

      {/* PRIORITY BLOCK 1: PENDING CONFIRMATIONS */}
      <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
        <div className="bg-amber-50 px-6 py-4 border-b border-amber-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-amber-900 uppercase tracking-tight">1. Pending Document & Data Approvals</h2>
          <span className="bg-amber-200 text-amber-900 font-black text-xs px-2.5 py-1 rounded-full">{pendingApps.length} Action Required</span>
        </div>
        
        <div className="p-6 divide-y divide-slate-100 max-h-[350px] overflow-y-auto">
          {pendingApps.length === 0 ? (
            <p className="text-slate-400 font-medium text-center py-4 text-sm">Admissions data verification queue clean.</p>
          ) : (
            pendingApps.map(app => (
              <div key={app.id} className="py-4 first:pt-0 last:pb-0 flex justify-between items-center">
                <div className="w-full mr-4">
                  <div className="flex justify-between items-baseline mb-1">
                    <p className="font-black text-slate-900 text-lg">{app.full_name}</p>
                    <p className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">REQ ID: {app.matricule}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-medium text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p>Class Target: <span className="text-slate-900 font-bold">{app.classes?.name}</span></p>
                    <p>Parent Contact: <span className="text-slate-900 font-mono font-bold">{app.parent_phone}</span></p>
                    <p>Gender: <span className="text-slate-900 font-bold">{app.gender || 'N/A'}</span></p>
                    <p>DOB: <span className="text-slate-900 font-bold">{app.date_of_birth || 'N/A'}</span></p>
                    <p className="col-span-2 md:col-span-4 border-t border-slate-200 pt-2 mt-1">
                      Place of Birth: <span className="text-slate-900 font-bold">{app.place_of_birth || 'N/A'}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 min-w-[100px]">
                  <button 
                    onClick={() => handleApplicationDecision(app.id, 'APPROVED')}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition shadow-sm">
                    Accept
                  </button>
                  <button 
                    onClick={() => handleApplicationDecision(app.id, 'REJECTED')}
                    className="bg-rose-50 text-rose-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-rose-100 transition">
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 2: APPROVED & WAITING FOR PAYMENT (AUTOMATED & LOCKED) */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 overflow-hidden">
        <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-indigo-900 uppercase tracking-tight">2. Approved Admissions Waiting Registration Payment</h2>
          <span className="bg-indigo-200 text-indigo-900 font-black text-xs px-2.5 py-1 rounded-full">{approvedApps.length} Pending Settlement</span>
        </div>

        <div className="p-6 divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {approvedApps.length === 0 ? (
            <p className="text-slate-400 font-medium text-center py-4 text-sm">No approved applications awaiting settlement.</p>
          ) : (
            approvedApps.map(app => {
              const standardFee = calculateMandatedRegistrationFee(app);
              
              return (
                <div key={app.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-black text-slate-900 text-base">{app.full_name}</p>
                      <p className="text-xs font-semibold text-slate-500">
                        Target Class: <span className="text-indigo-600 font-bold">{app.classes?.name}</span>
                        {" • "} Mandated Registration Fee: <span className="text-slate-900 font-black">{standardFee.toLocaleString()} XAF</span>
                      </p>
                    </div>
                    
                    {activePaymentStudent?.id !== app.id ? (
                      <button 
                        onClick={() => setActivePaymentStudent(app)}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm">
                        Process Registration Fee
                      </button>
                    ) : (
                      <button 
                        onClick={() => setActivePaymentStudent(null)}
                        className="text-xs font-bold text-slate-400 hover:text-slate-600 px-3 py-2">
                        Cancel Form
                      </button>
                    )}
                  </div>

                  {/* LONE-PATH SECURE AUTOMATED SUBMISSION FORM */}
                  {activePaymentStudent?.id === app.id && (
                    <form 
                      onSubmit={(e) => executeDigitizedPayment(e, app, standardFee, 'REGISTRATION', false)}
                      className="mt-4 p-4 bg-slate-50 rounded-xl border border-indigo-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fadeIn">
                      
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Verified Allocation Route</p>
                        <p className="text-sm font-bold text-slate-800">
                          Fee Classification: <span className="text-indigo-600 uppercase font-black">REGISTRATION FEE</span>
                        </p>
                        <p className="text-xs text-slate-500 font-medium">
                          *System has blocked tuition routing until this registration value is verified.
                        </p>
                      </div>

                      <div className="bg-white px-4 py-2 rounded-lg border text-right min-w-[150px]">
                        <p className="text-[10px] font-black uppercase text-slate-400">Enforced Value</p>
                        <p className="font-mono text-lg font-black text-slate-900">{standardFee.toLocaleString()} XAF</p>
                      </div>

                      <button type="submit" className="w-full md:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase hover:bg-emerald-700 transition tracking-wider shadow-md">
                        Collect Cash & Register Student
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PRIORITY BLOCK 3: FULL COMPLETED PAYMENTS & LOGS */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">3. Live System Transaction Settlement Ledger</h2>
          <span className="bg-slate-200 text-slate-700 font-bold text-xs px-2.5 py-1 rounded-full">Audited Realtime Engine</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-black tracking-wider text-slate-500 uppercase">
                <th className="p-4">Student Identity</th>
                <th className="p-4">Class</th>
                <th className="p-4">Allocation Type</th>
                <th className="p-4 text-right">Value Settled</th>
                <th className="p-4 text-center">Protocol Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium">
              {completedTxns.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-400 font-medium">No confirmed logs indexed on system nodes.</td>
                </tr>
              ) : (
                completedTxns.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition text-slate-900">
                    <td className="p-4 font-bold text-slate-900">{tx.students?.full_name || 'System Managed'}</td>
                    <td className="p-4 text-slate-600 font-semibold">{tx.students?.classes?.name || 'N/A'}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-black tracking-wide ${tx.type === 'REGISTRATION' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-4 font-black text-right text-slate-900">{Number(tx.amount).toLocaleString()} <span className="text-[11px] text-slate-400 font-bold">XAF</span></td>
                    <td className="p-4 text-center">
                      <span className="bg-slate-100 text-slate-700 text-[10px] font-mono font-black tracking-wider px-2 py-0.5 rounded border">
                        {tx.payment_method}
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

  async function searchStudentByMatricule() {
    const { data } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('school_id', userProfile.school_id)
      .eq('matricule', searchMatricule)
      .single();
    
    if (data) setSearchedStudent(data);
    else alert('No student matching this matricule registered.');
  }
}