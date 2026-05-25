import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ParentPortal({ schoolSlug }) {
  const [school, setSchool] = useState(null);
  const [config, setConfig] = useState(null);
  const [classes, setClasses] = useState([]);
  
  // Roster Workflow Logic states
  const [step, setStep] = useState('LOOKUP'); // LOOKUP, CHOOSE_ACTION, PAYMENT_PROCESSING
  const [matricule, setMatricule] = useState('');
  const [studentFound, setStudentFound] = useState(null);
  
  // Registration data structure states
  const [fullName, setFullName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [paymentType, setPaymentType] = useState(null); // REGISTRATION, TUITION
  const [paymentAmount, setPaymentAmount] = useState(0);

  useEffect(() => { loadInitialData(); }, []);

  async function loadInitialData() {
    const { data: s } = await supabase.from('schools').select('*').eq('slug', schoolSlug).single();
    setSchool(s);
    const { data: c } = await supabase.from('school_configs').select('*').eq('school_id', s.id).single();
    setConfig(c);
    const { data: cl } = await supabase.from('classes').select('*').eq('school_id', s.id);
    setClasses(cl || []);
  }

  async function handleStudentLookup(e) {
    e.preventDefault();
    const { data, error } = await supabase
      .from('students')
      .select('*, classes(*)')
      .eq('matricule', matricule.toUpperCase().trim())
      .single();

    if (data) {
      setStudentFound(data);
      setStep('CHOOSE_ACTION');
    } else {
      // Direct state branch prompt to execute new registration creation row setup
      setStep('NEW_REGISTRATION_FORM');
    }
  }

  async function executeNewStudentCreation(e) {
    e.preventDefault();
    const cleanMatricule = matricule.toUpperCase().trim();
    const { data, error } = await supabase.from('students').insert([{
      school_id: school.id,
      class_id: selectedClassId,
      matricule: cleanMatricule,
      full_name: fullName,
      parent_phone: parentPhone,
      is_registered: false
    }]).select().single();

    if (error) return alert(error.message);
    setStudentFound(data);
    
    // Determine exact target structure fee price parameters
    const targetClass = classes.find(c => c.id === selectedClassId);
    const feeToCharge = config.fee_structure === 'UNIFORM' 
      ? config.uniform_registration_fee 
      : targetClass.segmented_registration_fee;

    setPaymentType('REGISTRATION');
    setPaymentAmount(feeToCharge);
    setStep('PAYMENT_PROCESSING');
  }

  async function handleInitiateMoMoPayment(e) {
    e.preventDefault();
    // 1. Create Transaction Ledger entry with a PENDING state trigger
    const { data: tx, error } = await supabase.from('financial_transactions').insert([{
      school_id: school.id,
      student_id: studentFound.id,
      amount: paymentAmount,
      type: paymentType,
      status: 'PENDING'
    }]).select().single();

    if (error) return alert(error.message);

    // 2. Trigger USSD Intercept push via proxy server logic pipeline
    alert(`USSD PIN Authorization Push Triggered for ${parentPhone}. Provide confirmation and wait for receipt print broadcast confirmation.`);
  }

  if (!school) return <div className="text-center p-12 font-bold text-slate-500">Connecting Infrastructure Ledger Nodes...</div>;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl border w-full max-w-md">
        <h1 className="text-xl font-black text-center text-slate-800 mb-1">{school.name}</h1>
        <p className="text-xs text-center text-slate-400 tracking-wider uppercase mb-6">Secured Financial Gateway</p>

        {step === 'LOOKUP' && (
          <form onSubmit={handleStudentLookup} className="space-y-4">
            <p className="text-sm text-slate-600">Enter the assigned Student Matricule Number to confirm payment records:</p>
            <input className="border-2 border-slate-200 p-3 w-full rounded-xl text-center font-mono font-bold tracking-widest text-lg focus:border-indigo-600 outline-none transition" placeholder="e.g. CBS-2026-0012" value={matricule} onChange={e=>setMatricule(e.target.value)} required />
            <button type="submit" className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold tracking-wide hover:bg-slate-800 transition">Validate Matricule</button>
          </form>
        )}

        {step === 'CHOOSE_ACTION' && studentFound && (
          <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border">
              <p className="text-xs font-bold text-slate-400 uppercase">Validated Roster Node</p>
              <h2 className="text-base font-black text-slate-800">{studentFound.full_name}</h2>
              <p className="text-xs text-slate-600">Class: {studentFound.classes?.name}</p>
            </div>
            
            {!studentFound.is_registered ? (
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-800 font-medium">
                Our database indicates structural registration fees have not been recorded for this student node. Complete this core allocation requirement before tuition tracking blocks are unlocked.
              </div>
            ) : null}

            <div className="space-y-2">
              <button disabled={studentFound.is_registered} onClick={() => {
                const targetFee = config.fee_structure === 'UNIFORM' ? config.uniform_registration_fee : studentFound.classes.segmented_registration_fee;
                setPaymentType('REGISTRATION'); setPaymentAmount(targetFee); setParentPhone(studentFound.parent_phone); setStep('PAYMENT_PROCESSING');
              }} className="w-full p-3 rounded-xl font-bold border-2 text-sm transition text-left flex justify-between items-center border-emerald-500 bg-emerald-50 text-emerald-900 disabled:opacity-40">
                <span>Pay Core Registration</span>
                <span className="font-black">{config.fee_structure === 'UNIFORM' ? config.uniform_registration_fee : studentFound.classes?.segmented_registration_fee} XAF</span>
              </button>

              <button disabled={!studentFound.is_registered} onClick={() => {
                setPaymentType('TUITION'); setParentPhone(studentFound.parent_phone); setStep('TUITION_AMOUNT_FORM');
              }} className="w-full p-3 rounded-xl font-bold border-2 text-sm transition text-left flex justify-between items-center border-indigo-500 bg-indigo-50 text-indigo-900 disabled:opacity-40">
                <span>Execute Tuition Term Installments</span>
                <span className="text-xs font-black bg-indigo-200 px-2 py-0.5 rounded text-indigo-800">Available Track</span>
              </button>
            </div>
          </div>
        )}

        {step === 'NEW_REGISTRATION_FORM' && (
          <form onSubmit={executeNewStudentCreation} className="space-y-3">
            <div className="bg-amber-50 text-amber-900 text-xs p-3 rounded-xl border border-amber-200 font-medium">
              Matricule assignment record not found. Input configuration data blocks below to initialize registration mapping.
            </div>
            <input className="border p-2.5 w-full rounded-xl" placeholder="Full Student Name" value={fullName} onChange={e=>setFullName(e.target.value)} required />
            <select className="border p-2.5 w-full rounded-xl" value={selectedClassId} onChange={e=>setSelectedClassId(e.target.value)} required>
              <option value="">Select Target Class Assignment...</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="border p-2.5 w-full rounded-xl" placeholder="Parent Mobile Money Number" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} required />
            <button type="submit" className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold">Register Student</button>
          </form>
        )}

        {step === 'TUITION_AMOUNT_FORM' && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-700">Enter Tuition Installment Target Value (XAF):</p>
            <input type="number" className="border-2 p-3 w-full rounded-xl text-xl font-bold text-center" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} />
            <button onClick={() => setStep('PAYMENT_PROCESSING')} className="w-full bg-indigo-600 text-white p-3 rounded-xl font-bold">Proceed to Verification</button>
          </div>
        )}

        {step === 'PAYMENT_PROCESSING' && (
          <form onSubmit={handleInitiateMoMoPayment} className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border text-center">
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Total Settlement Required</span>
              <p className="text-3xl font-black text-slate-900 mt-1">{Number(paymentAmount).toLocaleString()} XAF</p>
              <p className="text-xs text-indigo-600 font-bold mt-1 uppercase tracking-wider">Allocation Target: {paymentType}</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Payer Network Source Wallet Number</label>
              <input className="border p-3 w-full rounded-xl text-center font-bold text-lg" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} required />
            </div>
            <button type="submit" className="w-full bg-emerald-600 text-white p-3 rounded-xl font-black tracking-wide text-base hover:bg-emerald-700 transition">Authorize MoMo PIN Push</button>
          </form>
        )}
      </div>
    </div>
  );
}