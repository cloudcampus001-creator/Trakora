import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { CheckCircle, Printer, ArrowLeft } from 'lucide-react';

export default function ParentPortal({ schoolSlug }) {
  const [school, setSchool] = useState(null);
  const [classes, setClasses] = useState([]);
  const [portalMode, setPortalMode] = useState('SELECTION');
  const [isSuccess, setIsSuccess] = useState(false); 
  const [lastTransaction, setLastTransaction] = useState(null);

  const [currentAppId, setCurrentAppId] = useState(localStorage.getItem('edu_app_id') || null);
  const [appStatus, setAppStatus] = useState(null);
  const [feeStructure, setFeeStructure] = useState(0);
  
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [pob, setPob] = useState('');
  const [phone, setPhone] = useState('');

  const [searchMatricule, setSearchMatricule] = useState('');
  const [foundStudent, setFoundStudent] = useState(null);
  const [tuitionAmountToPay, setTuitionAmountToPay] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveredStudents, setRecoveredStudents] = useState([]);

  useEffect(() => { loadSchoolData(); }, [schoolSlug]);

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
    }
  }

  async function handleSubmitRegistration(e) {
    e.preventDefault();
    if (!school?.id) return;
    const toastId = toast.loading('Submitting application...');
    
    try {
        const { data, error } = await supabase.from('students').insert([{
          school_id: school.id,
          full_name: fullName,
          class_id: classId,
          gender: gender,
          date_of_birth: dob, 
          place_of_birth: pob,
          parent_phone: phone,
          application_status: 'PENDING_REVIEW',
          matricule: `APP-${Math.floor(1000 + Math.random() * 9000)}`
        }]).select().single();

        if (error) throw error;
        localStorage.setItem('edu_app_id', data.id);
        setCurrentAppId(data.id);
        toast.success('Application submitted!', { id: toastId });
    } catch (err) {
        toast.error(`Error: ${err.message}`, { id: toastId });
    }
  }

  async function handlePrintReceipt(txData) {
    const toastId = toast.loading('Sending to Bursar office...');
    try {
      const receiptContent = {
        id: txData.id,
        student_name: txData.student_name || fullName,
        matricule: txData.matricule || 'N/A',
        amount: txData.amount,
        type: txData.type,
        payment_method: 'MOBILE MONEY',
        created_at: new Date().toISOString()
      };

      await supabase.from('print_jobs').insert([{
        school_id: school.id,
        transaction_id: txData.id,
        content: receiptContent
      }]);
      
      toast.success("Receipt sent to School Printer!", { id: toastId });
    } catch (err) {
      toast.error("Printer connection failed.");
    }
  }

  async function handleMoMoPayment(type) {
    const amount = type === 'REGISTRATION' ? feeStructure : tuitionAmountToPay;
    const targetStudentId = currentAppId || foundStudent.id;
    const studentName = currentAppId ? fullName : foundStudent.full_name;
    const toastId = toast.loading('Initializing MoMo Gateway...');

    try {
      const { data: tx, error: txError } = await supabase.from('financial_transactions').insert([{
        school_id: school.id, 
        student_id: targetStudentId, 
        amount: Number(amount), 
        type: type, 
        payment_method: 'MTN_MOMO', 
        status: 'COMPLETED'
      }]).select().single();

      if (txError) throw txError;

      if (type === 'REGISTRATION') {
        await supabase.from('students').update({ application_status: 'COMPLETED', is_registered: true }).eq('id', targetStudentId);
      } else {
        const newTotalPaid = Number(foundStudent.tuition_paid || 0) + Number(amount);
        await supabase.from('students').update({ tuition_paid: newTotalPaid }).eq('id', targetStudentId);
      }
      
      setLastTransaction({ ...tx, student_name: studentName });
      setIsSuccess(true);
      toast.dismiss(toastId);
    } catch (error) {
      toast.error("Payment failed.");
    }
  }

  if (isSuccess) return (
     <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
       <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center space-y-6">
         <CheckCircle className="w-20 h-20 text-emerald-500 mx-auto" />
         <h2 className="text-2xl font-black">Payment Successful!</h2>
         <p className="text-slate-500">Your receipt has been sent to the school office.</p>
         <button onClick={() => handlePrintReceipt(lastTransaction)} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl font-bold">
           <Printer className="w-5 h-5" /> Print at School Office
         </button>
         <button onClick={() => window.location.reload()} className="w-full text-slate-400 font-bold">Done</button>
       </div>
     </div>
  );

  if (!school) return <div className="min-h-screen flex items-center justify-center">Loading School...</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-slate-900 uppercase">{school.name}</h1>
          <p className="text-slate-500">Admissions & Payments</p>
        </div>

        {portalMode === 'SELECTION' && !currentAppId && (
          <div className="space-y-4">
            <button onClick={() => setPortalMode('REGISTER')} className="w-full bg-slate-900 text-white p-6 rounded-xl text-left border border-slate-900 shadow-lg">
              <h2 className="text-xl font-black">New Registration</h2>
              <p className="text-sm text-slate-400">Apply for admission.</p>
            </button>
            <button onClick={() => setPortalMode('TUITION')} className="w-full bg-white text-slate-900 p-6 rounded-xl text-left border-2 border-slate-200">
              <h2 className="text-xl font-black text-emerald-700">Pay Tuition Fees</h2>
              <p className="text-sm text-slate-500">Existing students.</p>
            </button>
          </div>
        )}

        {portalMode === 'REGISTER' && !currentAppId && (
          <form onSubmit={handleSubmitRegistration} className="space-y-4">
            <input className="border p-3 w-full rounded-lg" placeholder="Student Full Name" value={fullName} onChange={e=>setFullName(e.target.value)} required />
            <select className="border p-3 w-full rounded-lg" value={classId} onChange={e=>setClassId(e.target.value)} required>
              <option value="">Select Class</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
                <select className="border p-3 rounded-lg" value={gender} onChange={e=>setGender(e.target.value)} required>
                    <option value="">Gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                </select>
                <input className="border p-3 rounded-lg" type="date" value={dob} onChange={e=>setDob(e.target.value)} required />
            </div>
            <input className="border p-3 w-full rounded-lg" placeholder="Parent MoMo Number" value={phone} onChange={e=>setPhone(e.target.value)} required />
            <button type="submit" className="w-full bg-slate-900 text-white p-4 rounded-xl font-bold">Submit Application</button>
          </form>
        )}

        {appStatus === 'PENDING_REVIEW' && (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <h2 className="text-xl font-bold">Under Review</h2>
            <p className="text-slate-500">The Bursar is checking your application.</p>
          </div>
        )}

        {appStatus === 'APPROVED' && (
          <div className="text-center space-y-4">
            <div className="bg-emerald-100 text-emerald-800 p-4 rounded-lg font-black">✓ Approved!</div>
            <p className="text-2xl font-black">{feeStructure.toLocaleString()} XAF</p>
            <button onClick={() => handleMoMoPayment('REGISTRATION')} className="w-full bg-emerald-600 text-white p-4 rounded-xl font-black">Pay via MoMo</button>
          </div>
        )}

        {portalMode === 'TUITION' && (
            <div className="space-y-4">
                <input className="border-2 p-4 w-full rounded-xl text-center font-bold" placeholder="Student Matricule" value={searchMatricule} onChange={e=>setSearchMatricule(e.target.value)} />
                <button onClick={async () => {
                    const {data} = await supabase.from('students').select('*, classes(*)').eq('matricule', searchMatricule).single();
                    if(data) setFoundStudent(data); else toast.error("Not found");
                }} className="w-full bg-slate-900 text-white p-4 rounded-xl">Find Student</button>
                
                {foundStudent && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-xl border">
                        <p className="font-bold">{foundStudent.full_name}</p>
                        <input type="number" className="border w-full p-2 mt-2" placeholder="Amount" value={tuitionAmountToPay} onChange={e=>setTuitionAmountToPay(e.target.value)} />
                        <button onClick={() => handleMoMoPayment('TUITION')} className="w-full bg-emerald-600 text-white p-4 mt-2 rounded-xl">Pay Now</button>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
}