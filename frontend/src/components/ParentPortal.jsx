import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

export default function ParentPortal({ schoolSlug }) {
  const [school, setSchool] = useState(null);
  const [classes, setClasses] = useState([]);
  
  // PORTAL ROUTING STATE
  const [portalMode, setPortalMode] = useState('SELECTION'); // 'SELECTION', 'REGISTER', 'TUITION', 'RECOVER'

  // --- REGISTRATION STATE ---
  const [currentAppId, setCurrentAppId] = useState(localStorage.getItem('edu_app_id') || null);
  const [appStatus, setAppStatus] = useState(null);
  const [feeStructure, setFeeStructure] = useState(0);
  
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [pob, setPob] = useState('');
  const [phone, setPhone] = useState('');

  // --- TUITION & RECOVERY STATE ---
  const [searchMatricule, setSearchMatricule] = useState('');
  const [foundStudent, setFoundStudent] = useState(null);
  const [tuitionAmountToPay, setTuitionAmountToPay] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveredStudents, setRecoveredStudents] = useState([]);

  useEffect(() => {
    loadSchoolData();
  }, [schoolSlug]);

  useEffect(() => {
    if (!currentAppId) return;
    checkApplicationStatus();

    const statusChannel = supabase
      .channel(`live_status_${currentAppId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students', filter: `id=eq.${currentAppId}` }, () => {
          checkApplicationStatus();
      }).subscribe();

    return () => supabase.removeChannel(statusChannel);
  }, [currentAppId]);

  async function loadSchoolData() {
    const { data: schoolData } = await supabase.from('schools').select('*').eq('slug', schoolSlug).single();
    if (schoolData) {
      setSchool(schoolData);
      const { data: classData } = await supabase.from('classes').select('*').eq('school_id', schoolData.id);
      setClasses(classData || []);
    }
  }

  async function checkApplicationStatus() {
    if (!currentAppId) return;
    const { data: studentData } = await supabase.from('students').select('*, classes(*)').eq('id', currentAppId).single();

    if (studentData) {
      setAppStatus(studentData.application_status);
      if (studentData.application_status === 'APPROVED') {
        const { data: configData } = await supabase.from('school_configs').select('*').eq('school_id', studentData.school_id).single();
        if (configData) {
          const absoluteFee = configData.fee_structure === 'UNIFORM' 
            ? Number(configData.uniform_registration_fee || 0)
            : Number(studentData.classes?.segmented_registration_fee || 0);
          setFeeStructure(absoluteFee);
        }
      }
    } else {
      localStorage.removeItem('edu_app_id');
      setCurrentAppId(null);
    }
  }

  async function handleSubmitRegistration(e) {
    e.preventDefault();
    const tempMatricule = `REQ-${Date.now().toString().slice(-6)}`;
    const toastId = toast.loading('Submitting application...');

    const { data, error } = await supabase.from('students').insert([{
      school_id: school.id, class_id: classId, full_name: fullName, gender: gender,
      date_of_birth: dob, place_of_birth: pob, matricule: tempMatricule, parent_phone: phone,
      application_status: 'PENDING_REVIEW'
    }]).select().single();

    if (error) {
      toast.error("Submission error: " + error.message, { id: toastId });
      return;
    }

    localStorage.setItem('edu_app_id', data.id);
    setCurrentAppId(data.id);
    setAppStatus('PENDING_REVIEW');
    toast.success('Application successfully routed to Bursar!', { id: toastId });
  }

  async function handleFindStudentForTuition(e) {
    e.preventDefault();
    const toastId = toast.loading('Searching registry...');
    const { data, error } = await supabase.from('students').select('*, classes(name)').eq('school_id', school.id).eq('matricule', searchMatricule).single();

    if (data) {
      if (data.application_status !== 'COMPLETED') {
        toast.error("Registration not finalized. Complete registration first.", { id: toastId });
        return;
      }
      setFoundStudent(data);
      toast.success('Student verified.', { id: toastId });
    } else {
      toast.error('Invalid Matricule. Check your receipt.', { id: toastId });
    }
  }

  async function handleRecoverMatricule(e) {
    e.preventDefault();
    const toastId = toast.loading('Scanning records for phone number...');
    const { data, error } = await supabase.from('students').select('full_name, matricule, classes(name)').eq('school_id', school.id).eq('parent_phone', recoveryPhone);
    
    if (data && data.length > 0) {
      setRecoveredStudents(data);
      toast.success(`${data.length} record(s) found.`, { id: toastId });
    } else {
      toast.error('No registered students linked to this number.', { id: toastId });
      setRecoveredStudents([]);
    }
  }

  async function handleMoMoPayment(type) {
    const amount = type === 'REGISTRATION' ? feeStructure : tuitionAmountToPay;
    const targetStudentId = currentAppId || foundStudent.id;
    const toastId = toast.loading('Initializing secure gateway...');

    try {
      const { error: txError } = await supabase.from('financial_transactions').insert([{
        school_id: school.id, student_id: targetStudentId, amount: Number(amount), type: type, payment_method: 'MTN_MOMO_SIMULATED', status: 'COMPLETED'
      }]);

      if (txError) throw txError;

      if (type === 'REGISTRATION') {
        await supabase.from('students').update({ application_status: 'COMPLETED', is_registered: true }).eq('id', targetStudentId);
        toast.success("Mobile Money Payment Successful! Registration is complete.", { id: toastId, duration: 5000 });
      } else if (type === 'TUITION') {
        const newTotalPaid = Number(foundStudent.tuition_paid || 0) + Number(amount);
        await supabase.from('students').update({ tuition_paid: newTotalPaid }).eq('id', targetStudentId);
        toast.success(`${Number(amount).toLocaleString()} XAF Successfully credited.`, { id: toastId, duration: 5000 });
        setFoundStudent(null);
        setTuitionAmountToPay('');
      }
    } catch (error) {
      toast.error("Gateway execution failed.", { id: toastId });
    }
  }

  if (!school) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 space-y-4 bg-slate-100">
      <div className="w-12 h-12 border-4 border-slate-300 border-t-emerald-600 rounded-full animate-spin"></div>
      <div className="font-bold text-slate-500 animate-pulse">Connecting to Institution...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full relative">
        
        {portalMode !== 'SELECTION' && !currentAppId && (
          <button onClick={() => {setPortalMode('SELECTION'); setRecoveredStudents([]);}} className="absolute top-6 left-6 text-sm font-bold text-slate-400 hover:text-slate-800 transition">
            ← Back
          </button>
        )}

        <div className="text-center mb-8 border-b pb-6 mt-4">
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">{school.name}</h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Official Admissions & Finance Portal</p>
        </div>

        {portalMode === 'SELECTION' && !currentAppId && (
          <div className="space-y-4">
            <button onClick={() => setPortalMode('REGISTER')} className="w-full bg-slate-900 text-white p-6 rounded-xl text-left hover:bg-slate-800 transition group border border-slate-900 shadow-lg shadow-slate-900/20">
              <h2 className="text-xl font-black mb-1 group-hover:translate-x-1 transition-transform">New Registration</h2>
              <p className="text-sm text-slate-400">Apply for admission and pay initial registration fees.</p>
            </button>
            
            <button onClick={() => setPortalMode('TUITION')} className="w-full bg-white text-slate-900 p-6 rounded-xl text-left hover:bg-slate-50 transition border-2 border-slate-200 group">
              <h2 className="text-xl font-black mb-1 text-emerald-700 group-hover:translate-x-1 transition-transform">Pay Tuition Fees</h2>
              <p className="text-sm text-slate-500">Requires student matricule from your registration receipt.</p>
            </button>

            <button onClick={() => setPortalMode('RECOVER')} className="w-full text-center py-3 text-sm font-bold text-slate-400 hover:text-slate-700 transition">
              Lost your matricule? Recover it here.
            </button>
          </div>
        )}

        {/* --- RECOVERY PIPELINE --- */}
        {portalMode === 'RECOVER' && (
          <div className="space-y-6 animate-fadeIn">
            <form onSubmit={handleRecoverMatricule} className="space-y-4">
              <p className="text-slate-600 text-sm">Enter the phone number used during registration to recover the student matricule.</p>
              <input type="tel" className="border p-4 w-full rounded-xl text-center font-bold text-lg text-slate-900" placeholder="e.g. 670 00 00 00" value={recoveryPhone} onChange={e=>setRecoveryPhone(e.target.value)} required />
              <button className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold hover:bg-slate-800 transition shadow">Search Records</button>
            </form>

            {recoveredStudents.length > 0 && (
              <div className="space-y-3 mt-6 border-t pt-6">
                <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Identified Students</p>
                {recoveredStudents.map((s, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900">{s.full_name}</p>
                    <p className="text-sm text-slate-600">Class: {s.classes?.name}</p>
                    <div className="mt-2 bg-white p-2 rounded border border-dashed border-slate-300 text-center">
                      <span className="font-mono font-black text-emerald-700 tracking-widest">{s.matricule}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REGISTRATION AND TUITION CODE BLOCK REMAINS IDENTICAL TO PREVIOUS... */}
        {portalMode === 'REGISTER' && (
          <>
            {!currentAppId && (
              <form onSubmit={handleSubmitRegistration} className="space-y-4 animate-fadeIn">
                <h2 className="font-bold text-emerald-700 mb-2 uppercase text-xs tracking-wider">1. Academic Info</h2>
                <input className="border p-3 w-full rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition" placeholder="Student Full Name" value={fullName} onChange={e=>setFullName(e.target.value)} required />
                <select className="border p-3 w-full rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition bg-white" value={classId} onChange={e=>setClassId(e.target.value)} required>
                  <option value="" disabled>Select Desired Class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                
                <h2 className="font-bold text-emerald-700 mt-4 mb-2 uppercase text-xs tracking-wider">2. Demographics</h2>
                <div className="grid grid-cols-2 gap-3">
                  <select className="border p-3 w-full rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500 transition" value={gender} onChange={e=>setGender(e.target.value)} required>
                    <option value="" disabled>Gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                  <input className="border p-3 w-full rounded-lg text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500 transition" type="date" value={dob} onChange={e=>setDob(e.target.value)} required />
                </div>
                <input className="border p-3 w-full rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition" placeholder="Place of Birth" value={pob} onChange={e=>setPob(e.target.value)} required />

                <h2 className="font-bold text-emerald-700 mt-4 mb-2 uppercase text-xs tracking-wider">3. Guardian Protocol</h2>
                <input className="border p-3 w-full rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition" placeholder="Parent Mobile Money Number" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} required />

                <button className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold mt-4 hover:bg-slate-800 transition shadow">Submit Application</button>
              </form>
            )}

            {appStatus === 'PENDING_REVIEW' && (
              <div className="text-center py-8 space-y-4 animate-fadeIn">
                <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <h2 className="text-xl font-bold text-slate-800">Application Under Review</h2>
                <p className="text-slate-500 text-sm">The Bursar is currently verifying your details. **Do not refresh.**</p>
              </div>
            )}

            {appStatus === 'APPROVED' && (
              <div className="text-center py-4 space-y-4 animate-fadeIn">
                <div className="bg-emerald-100 text-emerald-800 p-4 rounded-lg mb-6 shadow-inner"><h2 className="text-lg font-black flex items-center justify-center gap-2">✓ Application Approved!</h2></div>
                <div className="bg-slate-50 p-4 rounded-xl border text-left mb-6 shadow-sm">
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Required Registration Fee</p>
                  <p className="text-3xl font-black text-slate-900">{feeStructure.toLocaleString()} <span className="text-lg text-slate-500">XAF</span></p>
                </div>
                <button onClick={() => handleMoMoPayment('REGISTRATION')} className="w-full bg-emerald-600 text-white p-4 rounded-xl font-black text-lg hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
                  Pay Registration via MoMo
                </button>
              </div>
            )}

            {appStatus === 'REJECTED' && (
              <div className="text-center py-8 animate-fadeIn">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-black">X</div>
                <h2 className="text-xl font-bold text-rose-600 mb-2">Application Declined</h2>
                <p className="text-sm text-slate-500 mb-6">Please contact school administration.</p>
                <button onClick={() => {localStorage.removeItem('edu_app_id'); setCurrentAppId(null);}} className="bg-slate-200 text-slate-700 px-6 py-2 rounded-lg font-bold hover:bg-slate-300 transition">Start New Application</button>
              </div>
            )}
          </>
        )}

        {portalMode === 'TUITION' && (
          <div className="space-y-6 animate-fadeIn">
            {!foundStudent ? (
              <form onSubmit={handleFindStudentForTuition} className="space-y-4">
                <p className="text-slate-600 text-sm mb-4">Enter the official matricule assigned to the student to retrieve their financial ledger.</p>
                <input className="border-2 border-slate-200 p-4 w-full rounded-xl text-center font-mono text-lg font-bold tracking-widest uppercase text-slate-900 focus:border-emerald-500 outline-none transition" placeholder="e.g. MAT-2026-001" value={searchMatricule} onChange={e=>setSearchMatricule(e.target.value)} required />
                <button className="w-full bg-slate-900 text-white p-3.5 rounded-xl font-bold hover:bg-slate-800 transition shadow-lg">Locate Student</button>
              </form>
            ) : (
              <div className="space-y-6 animate-fadeIn">
                <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl shadow-inner">
                  <p className="text-xs font-black text-emerald-600 uppercase tracking-wider mb-1 flex items-center gap-1">✓ Identity Verified</p>
                  <p className="text-xl font-black text-slate-900">{foundStudent.full_name}</p>
                  <div className="flex justify-between mt-3 text-sm border-t pt-3 border-slate-200">
                    <span className="text-slate-600 font-medium">{foundStudent.classes?.name}</span>
                    <span className="text-slate-600 font-medium">Paid: <span className="font-bold text-emerald-600">{Number(foundStudent.tuition_paid || 0).toLocaleString()} XAF</span></span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Deposit Amount (XAF)</label>
                  <input type="number" className="border-2 border-slate-200 focus:border-emerald-500 p-4 w-full rounded-xl text-2xl font-black text-slate-900 text-center outline-none transition" placeholder="0" value={tuitionAmountToPay} onChange={e=>setTuitionAmountToPay(e.target.value)} required />
                </div>

                <button onClick={() => handleMoMoPayment('TUITION')} disabled={!tuitionAmountToPay || tuitionAmountToPay <= 0} className="w-full bg-emerald-600 disabled:bg-slate-300 disabled:shadow-none text-white p-4 rounded-xl font-black text-lg hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30">
                  Execute Digital Payment
                </button>
                
                <button onClick={() => {setFoundStudent(null); setTuitionAmountToPay('');}} className="w-full text-sm font-bold text-slate-400 hover:text-slate-600 transition">Cancel & Search Again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}