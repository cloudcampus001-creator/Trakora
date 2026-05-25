import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { connectAndPrintReceipt } from '../utils/bluetoothPrinter';
import { Printer, RefreshCw } from 'lucide-react';

export default function BursarLogs({ userProfile }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadTransactions();

    // Instantiate Realtime WebSocket synchronization pipeline listener
    const channel = supabase
      .channel('bursar-telemetry-feed')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'financial_transactions',
        filter: `school_id=eq.${userProfile.school_id}`
      }, (payload) => {
        handleIncomingRealtimeTx(payload.new);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadTransactions() {
    const { data } = await supabase
      .from('financial_transactions')
      .select('*, students(full_name, matricule, classes(name))')
      .eq('school_id', userProfile.school_id)
      .order('created_at', { ascending: false })
      .limit(50);
    setLogs(data || []);
  }

  async function handleIncomingRealtimeTx(newTx) {
    // Fetch related components missing from standard stream output payload structures
    const { data: enrichedStudent } = await supabase
      .from('students')
      .select('full_name, matricule, classes(name)')
      .eq('id', newTx.student_id)
      .single();

    const printableTxObj = {
      school_name: "Our Institution", 
      matricule: enrichedStudent.matricule,
      student_name: enrichedStudent.full_name,
      class_name: enrichedStudent.classes?.name || 'N/A',
      type: newTx.type,
      amount: newTx.amount,
      created_at: newTx.created_at,
      tx_id: newTx.id
    };

    setLogs(prev => [[{ ...newTx, students: enrichedStudent }], ...prev]);

    // Trigger instant hardware printing
    if (newTx.status === 'COMPLETED') {
      const success = await connectAndPrintReceipt(printableTxObj);
      if (success) {
        await supabase.from('financial_transactions').update({ bursar_printed: true }).eq('id', newTx.id);
      }
    }
  }

  async function triggerManualReprint(tx) {
    const printableTxObj = {
      school_name: "Our Institution",
      matricule: tx.students.matricule,
      student_name: tx.students.full_name,
      class_name: tx.students?.classes?.name || 'N/A',
      type: tx.type,
      amount: tx.amount,
      created_at: tx.created_at,
      tx_id: tx.id
    };
    await connectAndPrintReceipt(printableTxObj);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-slate-900 text-white p-6 rounded-xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            Terminal Logs: Realtime Audit Feed 
            <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
          </h1>
          <p className="text-xs text-slate-400">Connected to direct device ESC/POS thermal engine output</p>
        </div>
      </div>

      <div className="space-y-3">
        {logs.map(tx => (
          <div key={tx.id} className="bg-white p-4 rounded-xl border shadow-sm flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-slate-800">{tx.students?.matricule}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-black ${tx.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {tx.status}
                </span>
                <span className="text-xs text-purple-600 font-bold uppercase">{tx.type}</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">Student: {tx.students?.full_name} | Class: {tx.students?.classes?.name}</p>
              <p className="text-xs text-slate-400 font-mono mt-0.5">Tx: {tx.id}</p>
            </div>
            <div className="text-right flex items-center gap-4">
              <div>
                <p className="text-lg font-black text-slate-900">{Number(tx.amount).toLocaleString()} XAF</p>
                <p className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleTimeString()}</p>
              </div>
              <button onClick={() => triggerManualReprint(tx)} className="p-2 border rounded-lg bg-slate-50 hover:bg-slate-100 transition" title="Force Reprint Statement">
                <Printer size={16} className="text-slate-700" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}