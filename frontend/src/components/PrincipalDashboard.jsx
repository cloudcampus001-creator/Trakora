import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import { toast } from 'react-hot-toast';

export default function PrincipalDashboard({ userProfile }) {
  const [config, setConfig] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [analytics, setAnalytics] = useState({ revenue: 0, count: 0, pending: 0 });
  const [qrUrl, setQrUrl] = useState('');
  
  const [className, setClassName] = useState('');
  const [regFee, setRegFee] = useState(0);
  const [tuiFee, setTuiFee] = useState(0);
  const [bName, setBName] = useState('');
  const [bEmail, setBEmail] = useState('');
  const [bPassword, setBPassword] = useState('');

  useEffect(() => {
    loadConfigurations();
    loadClasses();
    loadStudentsAndAnalytics();
    generateSchoolRegistrationQR();
  }, []);

  async function loadConfigurations() {
    const { data } = await supabase.from('school_configs').select('*').eq('school_id', userProfile.school_id).single();
    setConfig(data);
  }

  async function loadClasses() {
    const { data } = await supabase.from('classes').select('*').eq('school_id', userProfile.school_id).order('name');
    setClasses(data || []);
  }

  async function loadStudentsAndAnalytics() {
    const { data: stdData } = await supabase.from('students').select('*, classes(*)').eq('school_id', userProfile.school_id);
    const { data: txData } = await supabase.from('financial_transactions').select('amount').eq('school_id', userProfile.school_id).eq('status', 'COMPLETED');
    
    setStudents(stdData || []);

    const totalRev = txData ? txData.reduce((acc, curr) => acc + Number(curr.amount), 0) : 0;
    const registeredCount = stdData ? stdData.filter(s => s.is_registered).length : 0;
    const pendingCount = stdData ? stdData.filter(s => s.application_status === 'PENDING_REVIEW').length : 0;
    
    setAnalytics({ revenue: totalRev, count: registeredCount, pending: pendingCount });
  }

  async function generateSchoolRegistrationQR() {
    const { data: school } = await supabase.from('schools').select('slug').eq('id', userProfile.school_id).single();
    if(school) {
        const portalUrl = `${window.location.origin}/portal/${school.slug}`;
        const targetCode = await QRCode.toDataURL(portalUrl, { width: 150, margin: 1 });
        setQrUrl(targetCode);
    }
  }

  async function updateConfig(updates) {
    const toastId = toast.loading('Saving configuration...');
    const { error } = await supabase.from('school_configs').update(updates).eq('school_id', userProfile.school_id);
    if (error) {
        toast.error('Failed to update config.', { id: toastId });
    } else {
        toast.success('Configuration Saved.', { id: toastId });
        loadConfigurations();
    }
  }

  async function handleAddClass(e) {
    e.preventDefault();
    const toastId = toast.loading('Adding class segment...');
    const { error } = await supabase.from('classes').insert([{
      school_id: userProfile.school_id, name: className, segmented_registration_fee: regFee, segmented_tuition_fee: tuiFee
    }]);
    
    if(error) {
        toast.error(error.message, { id: toastId });
    } else {
        toast.success('Class added successfully.', { id: toastId });
        setClassName(''); setRegFee(0); setTuiFee(0);
        loadClasses();
    }
  }

  async function handleCreateBursar(e) {
    e.preventDefault();
    const toastId = toast.loading('Deploying Bursar access...');
    
    const { error } = await supabase.auth.signUp({ 
      email: bEmail.trim(), 
      password: bPassword,
      options: { data: { role: 'bursar', school_id: userProfile.school_id, full_name: bName.trim() } }
    });

    if (error) {
        toast.error(error.message, { id: toastId });
    } else {
        toast.success('Bursar node account active!', { id: toastId });
        setBName(''); setBEmail(''); setBPassword('');
    }
  }

  function exportClassPDF(targetClassId = null) {
    const doc = new jsPDF();
    doc.text(`Financial Audit Report`, 14, 15);
    
    const filtered = targetClassId ? students.filter(s => s.class_id === targetClassId) : students;
    const tableRows = filtered.map(s => [
      s.matricule, s.full_name, s.classes?.name || 'N/A', s.is_registered ? 'REG' : 'NO REG', `${Number(s.tuition_paid).toLocaleString()} XAF`
    ]);

    doc.autoTable({
      head: [['Matricule', 'Student Name', 'Class Room', 'Reg Status', 'Tuition Ledger Paid']],
      body: tableRows,
      startY: 25,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42] }
    });
    doc.save(`Financial_Report_Export.pdf`);
    toast.success('PDF Generated successfully.');
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      
      {/* Analytics Hero Section */}
      <div className="grid grid-cols-4 gap-6">
        <div className="col-span-4 md:col-span-2 bg-slate-900 text-white p-8 rounded-2xl flex justify-between items-center shadow-xl">
          <div>
            <h1 className="text-3xl font-black mb-2">Command Board</h1>
            <p className="text-slate-400 text-sm font-medium">Manage rates, rosters, and financial operations.</p>
          </div>
          {qrUrl && (
            <div className="bg-white p-2 rounded-xl text-center text-black text-[10px] font-black uppercase tracking-wider shadow-lg transform rotate-3">
              <img src={qrUrl} alt="Portal Address" className="w-20 h-20 mb-1 rounded" />
              <span>Portal QR</span>
            </div>
          )}
        </div>
        
        <div className="col-span-4 md:col-span-2 grid grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Gross Revenue</span>
                <span className="text-2xl font-black text-emerald-600">{analytics.revenue.toLocaleString()} <span className="text-xs">XAF</span></span>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Registered Active</span>
                <span className="text-2xl font-black text-indigo-600">{analytics.count} <span className="text-xs">Students</span></span>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Pending Action</span>
                <span className="text-2xl font-black text-amber-500">{analytics.pending} <span className="text-xs">Profiles</span></span>
            </div>
        </div>
      </div>

      {/* Control Panels Grid */}
      <div className="grid grid-cols-3 gap-6">
          {/* Global Config Settings Interface Row */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 col-span-3 md:col-span-1">
            <h2 className="text-lg font-black mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Financial Rules Engine</h2>
            {config ? (
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-2">Fee Allocation Architecture</label>
                  <select className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold text-sm" value={config.fee_structure} onChange={e=>updateConfig({fee_structure: e.target.value})}>
                    <option value="UNIFORM">Uniform Rates Across All Classes</option>
                    <option value="SEGMENTED">Segmented Pricing Structure per Class</option>
                  </select>
                </div>
                {config.fee_structure === 'UNIFORM' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-2">Base Reg Fee</label>
                      <input type="number" className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold" value={config.uniform_registration_fee} onBlur={e=>updateConfig({uniform_registration_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_registration_fee: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-2">Base Tuition</label>
                      <input type="number" className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold" value={config.uniform_tuition_fee} onBlur={e=>updateConfig({uniform_tuition_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_tuition_fee: e.target.value})} />
                    </div>
                  </div>
                )}
                <div className="border-t border-slate-100 pt-5">
                  <h3 className="text-[10px] uppercase tracking-wider font-black text-slate-400 mb-2">MoMo Settlement Wallet Configuration</h3>
                  <input type="text" placeholder="Wallet Target Number (e.g. 670...)" className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold" value={config.momo_number || ''} onBlur={e=>updateConfig({momo_number: e.target.value})} onChange={e=>setConfig({...config, momo_number: e.target.value})} />
                </div>
              </div>
            ) : <div className="animate-pulse h-32 bg-slate-100 rounded-xl"></div>}
          </div>

          {/* Class Allocation Control Area */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 col-span-3 md:col-span-1">
            <h2 className="text-lg font-black mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-indigo-500"></span> Class Segments</h2>
            <form onSubmit={handleAddClass} className="space-y-4">
              <input className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Class Name (e.g., Form 5)" value={className} onChange={e=>setClassName(e.target.value)} required />
              {config?.fee_structure === 'SEGMENTED' && (
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Reg Fee" value={regFee} onChange={e=>setRegFee(e.target.value)} />
                  <input type="number" className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Tuition Fee" value={tuiFee} onChange={e=>setTuiFee(e.target.value)} />
                </div>
              )}
              <button className="bg-indigo-600 text-white w-full p-3.5 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/30">Add Class Segment</button>
            </form>
          </div>

          {/* Staff Provisioning Pipeline Panel */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 col-span-3 md:col-span-1">
            <h2 className="text-lg font-black mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-500"></span> Provision Bursar</h2>
            <form onSubmit={handleCreateBursar} className="space-y-4">
              <input className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Full Staff Name" value={bName} onChange={e=>setBName(e.target.value)} required />
              <input className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Staff Email Address" type="email" value={bEmail} onChange={e=>setBEmail(e.target.value)} required />
              <input className="border-2 border-slate-100 p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Access Password" type="password" value={bPassword} onChange={e=>setBPassword(e.target.value)} required />
              <button className="bg-purple-600 text-white w-full p-3.5 rounded-xl font-black text-sm uppercase tracking-wider hover:bg-purple-700 transition shadow-lg shadow-purple-600/30">Deploy Account</button>
            </form>
          </div>
      </div>

      {/* Main Multi-Class Student Ledger Output Grid */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h2 className="text-xl font-black text-slate-800">Segmented Student Ledger</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportClassPDF()} className="bg-slate-900 text-white text-xs px-4 py-2.5 rounded-lg font-bold shadow hover:bg-slate-800 transition">Master Export PDF</button>
            {classes.map(c => (
              <button key={c.id} onClick={() => exportClassPDF(c.id)} className="bg-slate-100 border border-slate-200 text-slate-700 text-xs px-3 py-2.5 rounded-lg font-bold hover:bg-slate-200 transition">
                Export {c.name}
              </button>
            ))}
          </div>
        </div>
        
        <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left border-collapse">
            <thead>
                <tr className="bg-slate-50 uppercase text-[10px] tracking-widest text-slate-400 font-black border-b border-slate-100">
                <th className="p-4">Matricule</th>
                <th className="p-4">Full Name</th>
                <th className="p-4">Class</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right">Tuition Paid</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {students.length === 0 ? (
                    <tr><td colSpan="5" className="p-8 text-center text-slate-400 font-bold">No students registered yet.</td></tr>
                ) : (
                    students.map(s => (
                    <tr key={s.id} className="text-sm hover:bg-slate-50/50 transition">
                        <td className="p-4 font-mono font-bold text-slate-500">{s.matricule}</td>
                        <td className="p-4 font-bold text-slate-900">{s.full_name}</td>
                        <td className="p-4 text-slate-600 font-medium">{s.classes?.name || 'Unassigned'}</td>
                        <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${s.is_registered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {s.is_registered ? 'Verified' : 'Pending'}
                        </span>
                        </td>
                        <td className="p-4 font-black text-slate-900 text-right">{Number(s.tuition_paid).toLocaleString()} <span className="text-[10px] text-slate-400">XAF</span></td>
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