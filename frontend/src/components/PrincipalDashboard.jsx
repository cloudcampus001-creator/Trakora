import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';

export default function PrincipalDashboard({ userProfile }) {
  const [config, setConfig] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [qrUrl, setQrUrl] = useState('');
  
  // Input fields state hooks
  const [className, setClassName] = useState('');
  const [regFee, setRegFee] = useState(0);
  const [tuiFee, setTuiFee] = useState(0);
  const [bName, setBName] = useState('');
  const [bEmail, setBEmail] = useState('');
  const [bPassword, setBPassword] = useState('');

  useEffect(() => {
    loadConfigurations();
    loadClasses();
    loadStudents();
    generateSchoolRegistrationQR();
  }, []);

  async function loadConfigurations() {
    const { data } = await supabase.from('school_configs').select('*').eq('school_id', userProfile.school_id).single();
    setConfig(data);
  }

  async function loadClasses() {
    const { data } = await supabase.from('classes').select('*').eq('school_id', userProfile.school_id);
    setClasses(data || []);
  }

  async function loadStudents() {
    const { data } = await supabase.from('students').select('*, classes(*)').eq('school_id', userProfile.school_id);
    setStudents(data || []);
  }

  async function generateSchoolRegistrationQR() {
    const { data: school } = await supabase.from('schools').select('slug').eq('id', userProfile.school_id).single();
    const portalUrl = `${window.location.origin}/portal/${school.slug}`;
    const targetCode = await QRCode.toDataURL(portalUrl);
    setQrUrl(targetCode);
  }

  async function updateConfig(updates) {
    await supabase.from('school_configs').update(updates).eq('school_id', userProfile.school_id);
    loadConfigurations();
  }

  async function handleAddClass(e) {
    e.preventDefault();
    await supabase.from('classes').insert([{
      school_id: userProfile.school_id, name: className, segmented_registration_fee: regFee, segmented_tuition_fee: tuiFee
    }]);
    setClassName(''); setRegFee(0); setTuiFee(0);
    loadClasses();
  }

  async function handleCreateBursar(e) {
    e.preventDefault();
    
    // Pass the payload directly into options.data so the SQL trigger processes it correctly
    const { data, error } = await supabase.auth.signUp({ 
      email: bEmail.trim(), 
      password: bPassword,
      options: {
        data: {
          role: 'bursar',
          school_id: userProfile.school_id,
          full_name: bName.trim()
        }
      }
    });

    if (error) return alert(error.message);

    alert('Bursar node account deployed and active!');
    setBName(''); setBEmail(''); setBPassword('');
  }

  function exportClassPDF(targetClassId = null) {
    const doc = new jsPDF();
    doc.text(`Financial Audit Report - Class Segments`, 14, 15);
    
    const filtered = targetClassId ? students.filter(s => s.class_id === targetClassId) : students;
    const tableRows = filtered.map(s => [
      s.matricule, s.full_name, s.classes?.name || 'N/A', s.is_registered ? 'REG' : 'NO REG', `${s.tuition_paid} XAF`
    ]);

    doc.autoTable({
      head: [['Matricule', 'Student Name', 'Class Room', 'Reg Status', 'Tuition Ledger Paid']],
      body: tableRows,
      startY: 25,
    });
    doc.save(`Financial_Report_Export.pdf`);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto grid grid-cols-3 gap-6">
      <div className="col-span-3 bg-slate-900 text-white p-6 rounded-2xl flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black">Institutional Command Board</h1>
          <p className="text-slate-400">Manage rates, audit logs, student rosters, and bursars</p>
        </div>
        {qrUrl && (
          <div className="bg-white p-2 rounded-lg text-center text-black text-xs font-bold">
            <img src={qrUrl} alt="Portal Address" className="w-24 h-24 mb-1" />
            <span>Public Registration QR</span>
          </div>
        )}
      </div>

      {/* Global Config Settings Interface Row */}
      <div className="bg-white p-6 rounded-xl shadow border col-span-1">
        <h2 className="text-lg font-bold mb-4 text-emerald-700">Financial Rules Engine</h2>
        {config && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Fee Allocation Architecture</label>
              <select className="border p-2 w-full rounded" value={config.fee_structure} onChange={e=>updateConfig({fee_structure: e.target.value})}>
                <option value="UNIFORM">Uniform Rates Across All Classes</option>
                <option value="SEGMENTED">Segmented Pricing Structure per Class</option>
              </select>
            </div>
            {config.fee_structure === 'UNIFORM' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-600">Base Registration Fee</label>
                  <input type="number" className="border p-2 w-full rounded" value={config.uniform_registration_fee} onBlur={e=>updateConfig({uniform_registration_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_registration_fee: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600">Base Institutional Tuition</label>
                  <input type="number" className="border p-2 w-full rounded" value={config.uniform_tuition_fee} onBlur={e=>updateConfig({uniform_tuition_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_tuition_fee: e.target.value})} />
                </div>
              </>
            )}
            <div className="border-t pt-4">
              <h3 className="font-bold text-sm text-slate-700 mb-2">MoMo Settlement Wallet Configuration</h3>
              <input type="text" placeholder="Wallet Phone Target Number" className="border p-2 w-full rounded mb-2" value={config.momo_number || ''} onBlur={e=>updateConfig({momo_number: e.target.value})} onChange={e=>setConfig({...config, momo_number: e.target.value})} />
            </div>
          </div>
        )}
      </div>

      {/* Class Allocation Control Area */}
      <div className="bg-white p-6 rounded-xl shadow border col-span-1">
        <h2 className="text-lg font-bold mb-4 text-indigo-700">Class Management & Segment Rules</h2>
        <form onSubmit={handleAddClass} className="space-y-3">
          <input className="border p-2 w-full rounded" placeholder="Class Name (e.g., Form 5, Lower Sixth)" value={className} onChange={e=>setClassName(e.target.value)} required />
          {config?.fee_structure === 'SEGMENTED' && (
            <>
              <input type="number" className="border p-2 w-full rounded" placeholder="Segment Registration Fee" value={regFee} onChange={e=>setRegFee(e.target.value)} />
              <input type="number" className="border p-2 w-full rounded" placeholder="Segment Tuition Fee" value={tuiFee} onChange={e=>setTuiFee(e.target.value)} />
            </>
          )}
          <button className="bg-indigo-600 text-white w-full p-2 rounded font-bold">Add Class Segment</button>
        </form>
      </div>

      {/* Staff Provisioning Pipeline Panel */}
      <div className="bg-white p-6 rounded-xl shadow border col-span-1">
        <h2 className="text-lg font-bold mb-4 text-purple-700">Add Bursar Node Account</h2>
        <form onSubmit={handleCreateBursar} className="space-y-3">
          <input className="border p-2 w-full rounded" placeholder="Full Staff Name" value={bName} onChange={e=>setBName(e.target.value)} required />
          <input className="border p-2 w-full rounded" placeholder="Staff Email Address" type="email" value={bEmail} onChange={e=>setBEmail(e.target.value)} required />
          <input className="border p-2 w-full rounded" placeholder="Access Password" type="password" value={bPassword} onChange={e=>setBPassword(e.target.value)} required />
          <button className="bg-purple-600 text-white w-full p-2 rounded font-bold">Deploy Account Access</button>
        </form>
      </div>

      {/* Main Multi-Class Student Ledger Output Grid */}
      <div className="col-span-3 bg-white p-6 rounded-xl shadow border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-slate-800">Segmented Student Rosters & Balances Ledger</h2>
          <div className="space-x-2">
            <button onClick={() => exportClassPDF()} className="bg-slate-800 text-white text-xs px-3 py-2 rounded font-bold">Download Master PDF</button>
            {classes.map(c => (
              <button key={c.id} onClick={() => exportClassPDF(c.id)} className="bg-slate-200 text-slate-700 text-xs px-3 py-2 rounded font-semibold hover:bg-slate-300">
                Export {c.name} PDF
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100 uppercase text-xs text-slate-600 font-bold border-b">
              <th className="p-3">Matricule</th>
              <th className="p-3">Full Name</th>
              <th className="p-3">Class</th>
              <th className="p-3">Registration Status</th>
              <th className="p-3">Tuition Paid Balance</th>
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <tr key={s.id} className="border-b text-sm text-slate-700 hover:bg-slate-50">
                <td className="p-3 font-mono font-bold">{s.matricule}</td>
                <td className="p-3">{s.full_name}</td>
                <td className="p-3">{s.classes?.name || 'Unassigned'}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${s.is_registered ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {s.is_registered ? 'Registered Verified' : 'Pending Payment'}
                  </span>
                </td>
                <td className="p-3 font-semibold text-slate-900">{s.tuition_paid.toLocaleString()} XAF</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}