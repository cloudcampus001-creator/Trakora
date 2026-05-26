import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ParentPortal({ schoolSlug }) {
  const [school, setSchool] = useState(null);
  const [classes, setClasses] = useState([]);
  
  // PORTAL ROUTING STATE
  const [portalMode, setPortalMode] = useState('SELECTION'); // 'SELECTION', 'REGISTER', 'TUITION'

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

  // --- TUITION PAYMENT STATE ---
  const [searchMatricule, setSearchMatricule] = useState('');
  const [foundStudent, setFoundStudent] = useState(null);
  const [tuitionAmountToPay, setTuitionAmountToPay] = useState('');

  // Load initial school structure
  useEffect(() => {
    loadSchoolData();
  }, [schoolSlug]);

  // Real-time listener for Registration Approvals
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

  // --- REGISTRATION LOGIC ---

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

    const { data, error } = await supabase.from('students').insert([{
      school_id: school.id,
      class_id: classId,
      full_name: fullName,
      gender: gender,
      date_of_birth: dob,
      place_of_birth: pob,
      matricule: tempMatricule,
      parent_phone: phone,
      application_status: 'PENDING_REVIEW'
    }]).select().single();

    if (error) return alert("Submission error: " + error.message);

    localStorage.setItem('edu_app_id', data.id);
    setCurrentAppId(data.id);
    setAppStatus('PENDING_REVIEW');
  }

  // --- TUITION LOGIC ---

  async function handleFindStudentForTuition(e) {
    e.preventDefault();
    const { data, error } = await supabase
      .from('students')
      .select('*, classes(name)')
      .eq('school_id', school.id)
      .eq('matricule', searchMatricule)
      .single();

    if (data) {
      if (data.application_status !== 'COMPLETED') {
        alert("This student's registration is not yet finalized. Please complete registration first.");
        return;
      }
      setFoundStudent(data);
    } else {
      alert('Invalid Matricule. Please check your receipt and try again.');
    }
  }

  async function handleMoMoPayment(type) {
  const amount = type === 'REGISTRATION' ? feeStructure : tuitionAmountToPay;
  const targetPhone = type === 'REGISTRATION' ? phone : foundStudent.parent_phone;
  const targetStudentId = currentAppId || foundStudent.id;

  try {
    // 1. Instantly inject a successful transaction row into Supabase
    const { data: txn, error: txError } = await supabase
      .from('financial_transactions')
      .insert([{
        school_id: school.id,
        student_id: targetStudentId,
        amount: Number(amount),
        type: type, // 'REGISTRATION' or 'TUITION'
        payment_method: 'MTN_MOMO_SIMULATED',
        status: 'COMPLETED' // Automatically mark as completed for simulation
      }])
      .select()
      .single();

    if (txError) throw txError;

    // 2. Automatically update the student state engine depending on what they paid
    if (type === 'REGISTRATION') {
      const { error: regError } = await supabase
        .from('students')
        .update({
          application_status: 'COMPLETED',
          is_registered: true
        })
        .eq('id', targetStudentId);

      if (regError) throw regError;
      alert("✨ [SIMULATION] Mobile Money Payment Successful! Your registration is complete.");
      
    } else if (type === 'TUITION') {
      // Fetch current balance to calculate new balance safely
      const currentPaid = Number(foundStudent.tuition_paid || 0);
      const newTotalPaid = currentPaid + Number(amount);

      const { error: tuiError } = await supabase
        .from('students')
        .update({ tuition_paid: newTotalPaid })
        .eq('id', targetStudentId);

      if (tuiError) throw tuiError;
      alert(`✨ [SIMULATION] XAF ${amount} Tuition Payment Successfully credited to student ledger.`);
    }

  } catch (error) {
    console.error("Simulation engine failed:", error.message);
    alert("Simulation Error: Could not write tracking values to your database.");
  }
}

  if (!school) return <div className="min-h-screen flex items-center justify-center font-bold text-slate-500">Connecting to Institution...</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full relative">
        
        {/* Navigation Header */}
        {portalMode !== 'SELECTION' && !currentAppId && (
          <button onClick={() => setPortalMode('SELECTION')} className="absolute top-6 left-6 text-sm font-bold text-slate-400 hover:text-slate-800">
            ← Back
          </button>
        )}

        <div className="text-center mb-8 border-b pb-6 mt-4">
          <h1 className="text-2xl font-black text-slate-900 uppercase">{school.name}</h1>
          <p className="text-slate-500 font-medium">Official Admissions & Finance Portal</p>
        </div>

        {/* ==========================================
            VIEW 1: GATEWAY SELECTION
            ========================================== */}
        {portalMode === 'SELECTION' && !currentAppId && (
          <div className="space-y-4">
            <button 
              onClick={() => setPortalMode('REGISTER')}
              className="w-full bg-slate-900 text-white p-6 rounded-xl text-left hover:bg-slate-800 transition group border border-slate-900">
              <h2 className="text-xl font-black mb-1 group-hover:translate-x-1 transition-transform">New Registration</h2>
              <p className="text-sm text-slate-400">Apply for admission and pay initial registration fees.</p>
            </button>
            
            <button 
              onClick={() => setPortalMode('TUITION')}
              className="w-full bg-white text-slate-900 p-6 rounded-xl text-left hover:bg-slate-50 transition border-2 border-slate-200 group">
              <h2 className="text-xl font-black mb-1 text-emerald-700 group-hover:translate-x-1 transition-transform">Pay Tuition Fees</h2>
              <p className="text-sm text-slate-500">Requires student matricule from your registration receipt.</p>
            </button>
          </div>
        )}

        {/* ==========================================
            VIEW 2: REGISTRATION PIPELINE
            ========================================== */}
        {portalMode === 'REGISTER' && (
          <>
            {!currentAppId && (
              <form onSubmit={handleSubmitRegistration} className="space-y-4">
                <h2 className="font-bold text-emerald-700 mb-2 uppercase text-xs tracking-wider">1. Academic Info</h2>
                <input className="border p-3 w-full rounded-lg" placeholder="Student Full Name" value={fullName} onChange={e=>setFullName(e.target.value)} required />
                <select className="border p-3 w-full rounded-lg" value={classId} onChange={e=>setClassId(e.target.value)} required>
                  <option value="" disabled>Select Desired Class</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                
                <h2 className="font-bold text-emerald-700 mt-4 mb-2 uppercase text-xs tracking-wider">2. Demographics</h2>
                <div className="grid grid-cols-2 gap-3">
                  <select className="border p-3 w-full rounded-lg" value={gender} onChange={e=>setGender(e.target.value)} required>
                    <option value="" disabled>Gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                  <input className="border p-3 w-full rounded-lg text-slate-500" type="date" value={dob} onChange={e=>setDob(e.target.value)} required />
                </div>
                <input className="border p-3 w-full rounded-lg" placeholder="Place of Birth" value={pob} onChange={e=>setPob(e.target.value)} required />

                <h2 className="font-bold text-emerald-700 mt-4 mb-2 uppercase text-xs tracking-wider">3. Guardian Protocol</h2>
                <input className="border p-3 w-full rounded-lg" placeholder="Parent Mobile Money Number" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} required />

                <button className="w-full bg-slate-900 text-white p-3 rounded-lg font-bold mt-4 hover:bg-slate-800 transition shadow">
                  Submit Application
                </button>
              </form>
            )}

            {/* Application States */}
            {appStatus === 'PENDING_REVIEW' && (
              <div className="text-center py-8 space-y-4">
                <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <h2 className="text-xl font-bold text-slate-800">Application Under Review</h2>
                <p className="text-slate-500 text-sm">The Bursar is currently verifying your details. **Do not refresh.**</p>
              </div>
            )}

            {appStatus === 'APPROVED' && (
              <div className="text-center py-4 space-y-4">
                <div className="bg-emerald-100 text-emerald-800 p-4 rounded-lg mb-6"><h2 className="text-lg font-black">Application Approved!</h2></div>
                <div className="bg-slate-50 p-4 rounded-lg border text-left mb-6">
                  <p className="text-xs text-slate-500 font-bold uppercase">Required Registration Fee</p>
                  <p className="text-3xl font-black text-slate-900">{feeStructure.toLocaleString()} <span className="text-lg">XAF</span></p>
                </div>
                <button onClick={() => handleMoMoPayment('REGISTRATION')} className="w-full bg-emerald-600 text-white p-4 rounded-lg font-black text-lg hover:bg-emerald-700 transition shadow-lg">
                  Pay Registration via MoMo
                </button>
              </div>
            )}

            {appStatus === 'REJECTED' && (
              <div className="text-center py-8">
                <h2 className="text-xl font-bold text-rose-600 mb-2">Application Declined</h2>
                <button onClick={() => {localStorage.removeItem('edu_app_id'); setCurrentAppId(null);}} className="mt-6 bg-slate-200 text-slate-700 px-4 py-2 rounded font-bold">Start New Application</button>
              </div>
            )}
          </>
        )}

        {/* ==========================================
            VIEW 3: TUITION PAYMENT PIPELINE
            ========================================== */}
        {portalMode === 'TUITION' && (
          <div className="space-y-6">
            {!foundStudent ? (
              <form onSubmit={handleFindStudentForTuition} className="space-y-4">
                <p className="text-slate-600 text-sm mb-4">Enter the official matricule assigned to the student to retrieve their financial ledger.</p>
                <input 
                  className="border-2 border-slate-200 p-4 w-full rounded-xl text-center font-mono text-lg font-bold tracking-widest uppercase text-slate-900" 
                  placeholder="e.g. MAT-2026-001" 
                  value={searchMatricule} 
                  onChange={e=>setSearchMatricule(e.target.value)} 
                  required 
                />
                <button className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold hover:bg-slate-800 transition">
                  Locate Student
                </button>
              </form>
            ) : (
              <div className="space-y-6 animate-fadeIn">
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Identity Verified</p>
                  <p className="text-xl font-black text-slate-900">{foundStudent.full_name}</p>
                  <div className="flex justify-between mt-2 text-sm">
                    <span className="text-slate-600 font-medium">Class: {foundStudent.classes?.name}</span>
                    <span className="text-slate-600 font-medium">Paid to Date: <span className="font-bold text-emerald-600">{Number(foundStudent.tuition_paid || 0).toLocaleString()} XAF</span></span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Tuition Amount to Pay (XAF)</label>
                  <input 
                    type="number" 
                    className="border p-4 w-full rounded-xl text-xl font-black text-slate-900 text-center" 
                    placeholder="Enter Amount" 
                    value={tuitionAmountToPay} 
                    onChange={e=>setTuitionAmountToPay(e.target.value)} 
                    required 
                  />
                </div>

                <button 
                  onClick={() => handleMoMoPayment('TUITION')} 
                  disabled={!tuitionAmountToPay || tuitionAmountToPay <= 0}
                  className="w-full bg-emerald-600 disabled:bg-slate-300 text-white p-4 rounded-xl font-black text-lg hover:bg-emerald-700 transition shadow-lg">
                  Execute Digital Payment
                </button>
                
                <button onClick={() => setFoundStudent(null)} className="w-full text-sm font-bold text-slate-400 hover:text-slate-600">
                  Cancel & Search Again
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}