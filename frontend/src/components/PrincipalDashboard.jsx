import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import { toast } from 'react-hot-toast';
import { Download, Trash2, X, FileText, QrCode } from 'lucide-react';

export default function PrincipalDashboard({ userProfile }) {
  const [config, setConfig] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [transactions, setTransactions] = useState([]); // Needed for Revenue PDF
  const [analytics, setAnalytics] = useState({ revenue: 0, count: 0, pending: 0 });
  const [qrUrl, setQrUrl] = useState('');
  
  const [className, setClassName] = useState('');
  const [regFee, setRegFee] = useState(0);
  const [tuiFee, setTuiFee] = useState(0);
  const [bName, setBName] = useState('');
  const [bEmail, setBEmail] = useState('');
  const [bPassword, setBPassword] = useState('');

  // --- IPHONE GLASSMORPHISM POPUP STATE ---
  const [popupConfig, setPopupConfig] = useState(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0, isMobile: false });

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
    
    // Upgraded to fetch full transaction details for the PDF generator
    const { data: txData } = await supabase.from('financial_transactions')
      .select('*, students(full_name)')
      .eq('school_id', userProfile.school_id)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false });
    
    setStudents(stdData || []);
    setTransactions(txData || []);

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

  // --- POPUP & PDF ACTIONS ---

  const handleOpenPopup = (e, type, payload = null) => {
    e.stopPropagation();
    const isMobile = window.innerWidth < 768;
    let x = isMobile ? '50%' : e.clientX;
    let y = isMobile ? '50%' : e.clientY;
    
    if (!isMobile) {
        // Prevent popup from bleeding off the right or bottom edges of the screen
        if (x > window.innerWidth - 350) x -= 350;
        else x += 20; 
        
        if (y > window.innerHeight - 400) y -= 400;
        else y += 20;
    }

    setPopupPos({ x, y, isMobile });
    setPopupConfig({ type, payload });
  };

  const closePopup = () => setPopupConfig(null);

  function downloadQRPDF() {
    const doc = new jsPDF();
    doc.text(`Official Registration Gateway QR`, 14, 20);
    doc.text(`Institution: ${config?.name || 'AuraLedger Hub'}`, 14, 28);
    doc.addImage(qrUrl, 'PNG', 15, 35, 150, 150);
    doc.save('Gateway_QR_Code.pdf');
    toast.success('High-Resolution QR PDF generated.');
    closePopup();
  }

  function downloadRevenuePDF() {
    const doc = new jsPDF();
    doc.text(`Master Revenue Audit Log`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
    
    const rows = transactions.map(tx => [
      tx.students?.full_name || 'System Auto',
      new Date(tx.created_at).toLocaleDateString(),
      tx.type,
      tx.payment_method.replace('_SIMULATED', ''),
      `${Number(tx.amount).toLocaleString()} XAF`
    ]);

    doc.autoTable({
      head: [['Student Identity', 'Date', 'Type', 'Method', 'Value Settled']],
      body: rows,
      startY: 28,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42] },
      foot: [['', '', '', 'GROSS TOTAL', `${analytics.revenue.toLocaleString()} XAF`]],
      footStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
    });

    doc.save('Revenue_Audit_Log.pdf');
    toast.success('Audit Log PDF generated.');
    closePopup();
  }

  async function handleDeleteStudent(studentId) {
    const toastId = toast.loading('Purging student record...');
    const { error } = await supabase.from('students').delete().eq('id', studentId);
    
    if (error) {
      toast.error("Failed to delete record: " + error.message, { id: toastId });
    } else {
      toast.success("Application permanently removed.", { id: toastId });
      loadStudentsAndAnalytics(); // Refresh table and Bursar queue
      closePopup();
    }
  }

  // --- STANDARD CONFIG ACTIONS ---

  async function updateConfig(updates) {
    const toastId = toast.loading('Saving configuration...');
    const { error } = await supabase.from('school_configs').update(updates).eq('school_id', userProfile.school_id);
    if (error) toast.error('Failed to update config.', { id: toastId });
    else { toast.success('Configuration Saved.', { id: toastId }); loadConfigurations(); }
  }

  async function handleAddClass(e) {
    e.preventDefault();
    const toastId = toast.loading('Adding class segment...');
    const { error } = await supabase.from('classes').insert([{ school_id: userProfile.school_id, name: className, segmented_registration_fee: regFee, segmented_tuition_fee: tuiFee }]);
    if(error) toast.error(error.message, { id: toastId });
    else { toast.success('Class added successfully.', { id: toastId }); setClassName(''); setRegFee(0); setTuiFee(0); loadClasses(); }
  }

  async function handleCreateBursar(e) {
    e.preventDefault();
    const toastId = toast.loading('Deploying Bursar access...');
    const { error } = await supabase.auth.signUp({ email: bEmail.trim(), password: bPassword, options: { data: { role: 'bursar', school_id: userProfile.school_id, full_name: bName.trim() } }});
    if (error) toast.error(error.message, { id: toastId });
    else { toast.success('Bursar node account active!', { id: toastId }); setBName(''); setBEmail(''); setBPassword(''); }
  }

  function exportClassPDF(targetClassId = null) {
    const doc = new jsPDF();
    doc.text(`Financial Audit Report`, 14, 15);
    const filtered = targetClassId ? students.filter(s => s.class_id === targetClassId) : students;
    const tableRows = filtered.map(s => [ s.matricule, s.full_name, s.classes?.name || 'N/A', s.is_registered ? 'REG' : 'NO REG', `${Number(s.tuition_paid).toLocaleString()} XAF` ]);
    doc.autoTable({ head: [['Matricule', 'Student Name', 'Class Room', 'Reg Status', 'Tuition Ledger Paid']], body: tableRows, startY: 25, theme: 'grid', headStyles: { fillColor: [15, 23, 42] }});
    doc.save(`Financial_Report_Export.pdf`);
    toast.success('PDF Generated successfully.');
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 relative">
      
      {/* --- IPHONE GLASSMORPHISM GLOBAL OVERLAY --- */}
      {popupConfig && (
        <div className="fixed inset-0 z-50 flex items-start justify-start" onClick={closePopup}>
          {/* Blurred Background Filter */}
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-md transition-all duration-300"></div>
          
          {/* Glass Card Container */}
          <div 
            className="absolute bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/50 dark:border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.2)] rounded-3xl p-6 w-[320px] sm:w-[380px] animate-fadeIn"
            style={popupPos.isMobile 
              ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } 
              : { top: popupPos.y, left: popupPos.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={closePopup} className="absolute top-4 right-4 bg-slate-200/50 hover:bg-slate-300/50 p-1.5 rounded-full text-slate-600 transition">
              <X size={16} />
            </button>

            {/* POPUP 1: QR CODE */}
            {popupConfig.type === 'QR' && (
              <div className="text-center space-y-4 pt-2">
                <div className="bg-slate-100 p-3 rounded-2xl inline-block shadow-inner"><QrCode size={40} className="text-slate-700" /></div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Public Gateway QR</h3>
                <p className="text-sm text-slate-600 font-medium">Download the ultra-high resolution version of this QR code for printing on posters and campus walls.</p>
                <button onClick={downloadQRPDF} className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 transition">
                  <Download size={18} /> Export PDF Format
                </button>
              </div>
            )}

            {/* POPUP 2: REVENUE LOG */}
            {popupConfig.type === 'REVENUE' && (
              <div className="text-center space-y-4 pt-2">
                <div className="bg-emerald-100 p-3 rounded-2xl inline-block shadow-inner"><FileText size={40} className="text-emerald-700" /></div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Gross Revenue Log</h3>
                <p className="text-sm text-slate-600 font-medium">Generate a comprehensive audit PDF containing all chronological financial transactions, names, and total sums.</p>
                <button onClick={downloadRevenuePDF} className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 transition">
                  <Download size={18} /> Download Audit PDF
                </button>
              </div>
            )}

            {/* POPUP 3: STUDENT DETAILS */}
            {popupConfig.type === 'STUDENT' && (
              <div className="space-y-4 pt-2 text-left">
                <h3 className="text-xl font-black text-slate-900 tracking-tight truncate pr-6">{popupConfig.payload.full_name}</h3>
                
                <div className="bg-slate-50/50 border border-white/40 p-4 rounded-2xl space-y-3">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-sm">
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Matricule</span><span className="font-mono font-bold text-slate-800">{popupConfig.payload.matricule}</span></div>
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Class Segment</span><span className="font-bold text-indigo-600">{popupConfig.payload.classes?.name || 'N/A'}</span></div>
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Parent Contact</span><span className="font-mono font-bold text-slate-800">{popupConfig.payload.parent_phone}</span></div>
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Gender</span><span className="font-bold text-slate-800">{popupConfig.payload.gender || 'N/A'}</span></div>
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Date of Birth</span><span className="font-bold text-slate-800">{popupConfig.payload.date_of_birth || 'N/A'}</span></div>
                    <div><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Status</span><span className={`font-black uppercase text-[10px] px-2 py-0.5 rounded ${popupConfig.payload.is_registered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{popupConfig.payload.is_registered ? 'Verified' : 'Pending'}</span></div>
                    <div className="col-span-2"><span className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Place of Birth</span><span className="font-bold text-slate-800">{popupConfig.payload.place_of_birth || 'N/A'}</span></div>
                  </div>
                </div>

                {!popupConfig.payload.is_registered && (
                  <button onClick={() => handleDeleteStudent(popupConfig.payload.id)} className="w-full flex items-center justify-center gap-2 bg-rose-50 border border-rose-200 text-rose-600 py-3 rounded-xl font-bold hover:bg-rose-100 hover:text-rose-700 transition">
                    <Trash2 size={18} /> Delete Unregistered Record
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analytics Hero Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="col-span-1 lg:col-span-2 bg-slate-900 text-white p-6 md:p-8 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-xl">
          <div>
            <h1 className="text-2xl md:text-3xl font-black mb-1 md:mb-2">Command Board</h1>
            <p className="text-slate-400 text-xs md:text-sm font-medium">Manage rates, rosters, and financial operations.</p>
          </div>
          {qrUrl && (
            <div onClick={(e) => handleOpenPopup(e, 'QR')} className="bg-white/90 backdrop-blur-sm p-2 rounded-xl text-center text-black text-[10px] font-black uppercase tracking-wider shadow-lg transform sm:rotate-3 self-end sm:self-auto cursor-pointer hover:scale-105 hover:rotate-0 transition duration-300">
              <img src={qrUrl} alt="Portal Address" className="w-16 h-16 md:w-20 md:h-20 mb-1 rounded mx-auto" />
              <span>Portal QR</span>
            </div>
          )}
        </div>
        
        <div className="col-span-1 lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
            <div onClick={(e) => handleOpenPopup(e, 'REVENUE')} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center cursor-pointer hover:shadow-md hover:border-emerald-200 hover:-translate-y-1 transition duration-300">
                <span className="text-[10px] md:text-xs font-black uppercase text-slate-400 tracking-wider">Gross Revenue</span>
                <span className="text-xl md:text-2xl font-black text-emerald-600">{analytics.revenue.toLocaleString()} <span className="text-[10px] md:text-xs">XAF</span></span>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center">
                <span className="text-[10px] md:text-xs font-black uppercase text-slate-400 tracking-wider">Registered Active</span>
                <span className="text-xl md:text-2xl font-black text-indigo-600">{analytics.count} <span className="text-[10px] md:text-xs">Students</span></span>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-center">
                <span className="text-[10px] md:text-xs font-black uppercase text-slate-400 tracking-wider">Pending Action</span>
                <span className="text-xl md:text-2xl font-black text-amber-500">{analytics.pending} <span className="text-[10px] md:text-xs">Profiles</span></span>
            </div>
        </div>
      </div>

      {/* Control Panels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Global Config Settings */}
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-base md:text-lg font-black mb-4 md:mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Financial Rules Engine</h2>
            {config ? (
              <div className="space-y-4 md:space-y-5">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1 md:mb-2">Fee Allocation Architecture</label>
                  <select className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold text-xs md:text-sm" value={config.fee_structure} onChange={e=>updateConfig({fee_structure: e.target.value})}>
                    <option value="UNIFORM">Uniform Rates</option>
                    <option value="SEGMENTED">Segmented per Class</option>
                  </select>
                </div>
                {config.fee_structure === 'UNIFORM' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1 md:mb-2">Base Reg Fee</label>
                      <input type="number" className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold text-sm" value={config.uniform_registration_fee} onBlur={e=>updateConfig({uniform_registration_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_registration_fee: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1 md:mb-2">Base Tuition</label>
                      <input type="number" className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold text-sm" value={config.uniform_tuition_fee} onBlur={e=>updateConfig({uniform_tuition_fee: e.target.value})} onChange={e=>setConfig({...config, uniform_tuition_fee: e.target.value})} />
                    </div>
                  </div>
                )}
                <div className="border-t border-slate-100 pt-4 md:pt-5">
                  <h3 className="text-[10px] uppercase tracking-wider font-black text-slate-400 mb-1 md:mb-2">MoMo Settlement Wallet</h3>
                  <input type="text" placeholder="e.g. 670..." className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-emerald-500 outline-none transition font-bold text-sm" value={config.momo_number || ''} onBlur={e=>updateConfig({momo_number: e.target.value})} onChange={e=>setConfig({...config, momo_number: e.target.value})} />
                </div>
              </div>
            ) : <div className="animate-pulse h-32 bg-slate-100 rounded-xl"></div>}
          </div>

          {/* Class Allocation Control Area */}
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-base md:text-lg font-black mb-4 md:mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-indigo-500"></span> Class Segments</h2>
            <form onSubmit={handleAddClass} className="space-y-3 md:space-y-4">
              <input className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Class Name (e.g., Form 5)" value={className} onChange={e=>setClassName(e.target.value)} required />
              {config?.fee_structure === 'SEGMENTED' && (
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <input type="number" className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Reg Fee" value={regFee} onChange={e=>setRegFee(e.target.value)} />
                  <input type="number" className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-indigo-500 outline-none transition font-bold text-sm" placeholder="Tuition Fee" value={tuiFee} onChange={e=>setTuiFee(e.target.value)} />
                </div>
              )}
              <button className="bg-indigo-600 text-white w-full p-3 md:p-3.5 rounded-xl font-black text-xs md:text-sm uppercase tracking-wider hover:bg-indigo-700 transition shadow-lg shadow-indigo-600/30">Add Class</button>
            </form>
          </div>

          {/* Staff Provisioning Panel */}
          <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100 lg:col-span-1 md:col-span-2">
            <h2 className="text-base md:text-lg font-black mb-4 md:mb-6 text-slate-800 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-500"></span> Provision Bursar</h2>
            <form onSubmit={handleCreateBursar} className="space-y-3 md:space-y-4">
              <input className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Full Staff Name" value={bName} onChange={e=>setBName(e.target.value)} required />
              <input className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Staff Email" type="email" value={bEmail} onChange={e=>setBEmail(e.target.value)} required />
              <input className="border-2 border-slate-100 p-2.5 md:p-3 w-full rounded-xl focus:border-purple-500 outline-none transition font-bold text-sm" placeholder="Access Password" type="password" value={bPassword} onChange={e=>setBPassword(e.target.value)} required />
              <button className="bg-purple-600 text-white w-full p-3 md:p-3.5 rounded-xl font-black text-xs md:text-sm uppercase tracking-wider hover:bg-purple-700 transition shadow-lg shadow-purple-600/30">Deploy Account</button>
            </form>
          </div>
      </div>

      {/* Main Multi-Class Student Ledger Output Grid */}
      <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-4">
          <h2 className="text-lg md:text-xl font-black text-slate-800">Segmented Student Ledger</h2>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button onClick={() => exportClassPDF()} className="flex-1 md:flex-none bg-slate-900 text-white text-[10px] md:text-xs px-3 md:px-4 py-2 md:py-2.5 rounded-lg font-bold shadow hover:bg-slate-800 transition whitespace-nowrap">Master Export</button>
            {classes.map(c => (
              <button key={c.id} onClick={() => exportClassPDF(c.id)} className="flex-1 md:flex-none bg-slate-100 border border-slate-200 text-slate-700 text-[10px] md:text-xs px-2 md:px-3 py-2 md:py-2.5 rounded-lg font-bold hover:bg-slate-200 transition whitespace-nowrap">
                {c.name}
              </button>
            ))}
          </div>
        </div>
        
        <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
                <tr className="bg-slate-50 uppercase text-[9px] md:text-[10px] tracking-widest text-slate-400 font-black border-b border-slate-100">
                <th className="p-3 md:p-4">Matricule</th>
                <th className="p-3 md:p-4">Full Name</th>
                <th className="p-3 md:p-4">Class</th>
                <th className="p-3 md:p-4 text-center">Status</th>
                <th className="p-3 md:p-4 text-right">Tuition Paid</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {students.length === 0 ? (
                    <tr><td colSpan="5" className="p-6 md:p-8 text-center text-slate-400 font-bold text-sm">No students registered yet.</td></tr>
                ) : (
                    students.map(s => (
                    <tr key={s.id} onClick={(e) => handleOpenPopup(e, 'STUDENT', s)} className="text-xs md:text-sm hover:bg-slate-50/80 cursor-pointer transition">
                        <td className="p-3 md:p-4 font-mono font-bold text-slate-500">{s.matricule}</td>
                        <td className="p-3 md:p-4 font-bold text-slate-900">{s.full_name}</td>
                        <td className="p-3 md:p-4 text-slate-600 font-medium">{s.classes?.name || 'Unassigned'}</td>
                        <td className="p-3 md:p-4 text-center">
                        <span className={`px-2 md:px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-wider ${s.is_registered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {s.is_registered ? 'Verified' : 'Pending'}
                        </span>
                        </td>
                        <td className="p-3 md:p-4 font-black text-slate-900 text-right">{Number(s.tuition_paid).toLocaleString()} <span className="text-[9px] md:text-[10px] text-slate-400">XAF</span></td>
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