import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { 
  Search, 
  CreditCard, 
  CheckCircle, 
  Printer, 
  ArrowLeft, 
  User, 
  School, 
  Wallet 
} from 'lucide-react';
import { printThermalReceipt } from '../utils/printer';

export default function ParentPortal() {
  const [view, setView] = useState('SEARCH'); // SEARCH, PAYMENT, SUCCESS
  const [matricule, setMatricule] = useState('');
  const [student, setStudent] = useState(null);
  const [feeType, setFeeType] = useState('TUITION');
  const [amount, setAmount] = useState('');
  const [transaction, setTransaction] = useState(null);

  // 1. Search Logic
  async function handleSearch(e) {
    e.preventDefault();
    const toastId = toast.loading('Locating student profile...');
    
    const { data, error } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('matricule', matricule.toUpperCase())
      .single();

    if (error || !data) {
      toast.error('Student not found. Please verify the matricule.', { id: toastId });
    } else {
      setStudent(data);
      setView('PAYMENT');
      toast.dismiss(toastId);
    }
  }

  // 2. Payment Execution
  async function handlePayment() {
    const toastId = toast.loading('Processing payment...');
    
    // Insert into DB
    const { data: tx, error: txError } = await supabase
      .from('financial_transactions')
      .insert([{
        school_id: student.school_id,
        student_id: student.id,
        amount: Number(amount),
        type: feeType,
        payment_method: 'MOMO_PORTAL',
        status: 'COMPLETED',
        processed_by: null // Portal transaction
      }])
      .select()
      .single();

    if (txError) {
      toast.error('Transaction Failed: ' + txError.message, { id: toastId });
      return;
    }

    // Update Student Balance
    if (feeType === 'TUITION') {
      await supabase
        .from('students')
        .update({ tuition_paid: Number(student.tuition_paid || 0) + Number(amount) })
        .eq('id', student.id);
    }

    setTransaction(tx);
    setView('SUCCESS');
    toast.success('Payment recorded successfully!', { id: toastId });
  }

  // 3. Reset Flow (For Multi-Child)
  function handleReset() {
    setMatricule('');
    setStudent(null);
    setAmount('');
    setTransaction(null);
    setView('SEARCH');
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Cloud Campus</h1>
          <p className="text-slate-500 font-medium text-sm">Parent Payment Portal</p>
        </div>

        {/* --- STEP 1: SEARCH --- */}
        {view === 'SEARCH' && (
          <form onSubmit={handleSearch} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-black text-slate-800 mb-6">Enter Student Matricule</h2>
            <div className="space-y-4">
              <input
                className="w-full p-4 rounded-xl border-2 border-slate-100 font-bold text-slate-900 focus:border-indigo-500 transition outline-none"
                placeholder="e.g. MAT-001"
                value={matricule}
                onChange={(e) => setMatricule(e.target.value)}
                required
              />
              <button className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition">
                <Search size={18} /> Search Profile
              </button>
            </div>
          </form>
        )}

        {/* --- STEP 2: PAYMENT --- */}
        {view === 'PAYMENT' && student && (
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 animate-fadeIn">
            <div className="flex items-center gap-3 mb-6 bg-slate-50 p-4 rounded-2xl">
              <div className="bg-indigo-100 p-3 rounded-full text-indigo-600"><User size={20} /></div>
              <div>
                <p className="font-black text-slate-900">{student.full_name}</p>
                <p className="text-xs font-bold text-slate-500 uppercase">{student.classes?.name}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Fee Type</label>
                <select 
                  className="w-full p-3 rounded-xl border-2 border-slate-100 font-bold"
                  value={feeType}
                  onChange={(e) => setFeeType(e.target.value)}
                >
                  <option value="TUITION">Tuition Fee</option>
                  <option value="REGISTRATION">Registration Fee</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Amount (XAF)</label>
                <input
                  type="number"
                  className="w-full p-4 rounded-xl border-2 border-slate-100 font-black text-lg"
                  placeholder="50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <button 
                onClick={handlePayment}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-emerald-700 transition"
              >
                <Wallet size={18} /> Confirm Payment
              </button>
              <button 
                onClick={() => setView('SEARCH')}
                className="w-full text-slate-400 font-bold text-sm py-2 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* --- STEP 3: SUCCESS --- */}
        {view === 'SUCCESS' && transaction && (
          <div className="bg-white/80 backdrop-blur-md border border-white/50 p-8 rounded-3xl shadow-2xl text-center space-y-6 animate-fadeIn">
            <div className="flex justify-center">
              <div className="bg-emerald-100 p-4 rounded-full">
                <CheckCircle className="w-12 h-12 text-emerald-500" />
              </div>
            </div>
            
            <div>
              <h2 className="text-xl font-black text-slate-800">Payment Successful</h2>
              <p className="text-sm font-medium text-slate-500 mt-2">
                Transaction recorded for {student.full_name}
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button 
                onClick={() => printThermalReceipt({ ...transaction, student_name: student.full_name, matricule: student.matricule }, null, false)}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg"
              >
                <Printer size={18} /> Print Official Receipt
              </button>
              
              <button 
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-2 bg-white text-slate-700 p-4 rounded-xl font-bold hover:bg-slate-50 transition border-2 border-slate-200"
              >
                <ArrowLeft size={18} /> Pay for Another Child
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}