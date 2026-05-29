import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Toaster, toast } from 'react-hot-toast';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import PrincipalDashboard from './components/PrincipalDashboard';
import BursarDashboard from './components/BursarDashboard';
import ParentPortal from './components/ParentPortal';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Extract explicit routes or paths for the Parent Portal QR Landing View
  const path = window.location.pathname;
  const isParentPortal = path.startsWith('/portal/');
  const schoolSlug = isParentPortal ? path.split('/')[2] : null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserProfile(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserProfile(uid) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (error) {
      toast.error("Failed to load user profile.");
    } else {
      setProfile(data);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setIsAuthenticating(true);
    const toastId = toast.loading('Authorizing secure session...');
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    setIsAuthenticating(false);
    if (error) {
      toast.error(error.message, { id: toastId });
    } else {
      toast.success('Access Granted.', { id: toastId });
    }
  }

  if (isParentPortal) {
    return (
      <>
        <Toaster position="top-center" />
        <ParentPortal schoolSlug={schoolSlug} />
      </>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <Toaster position="top-center" />
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-4">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-slate-900">AuraLedger</h2>
            <p className="text-slate-500 text-sm font-medium">Institutional Node Login</p>
          </div>
          <input className="border p-3 w-full rounded-xl transition focus:ring-2 focus:ring-slate-900 outline-none" type="email" placeholder="Staff Email Address" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="border p-3 w-full rounded-xl transition focus:ring-2 focus:ring-slate-900 outline-none" type="password" placeholder="Access Password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button type="submit" disabled={isAuthenticating} className="w-full bg-slate-900 text-white p-3.5 rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {isAuthenticating ? 'Decrypting...' : 'Authorize Session'}
          </button>
        </form>
      </div>
    );
  }

  if (!profile) return (
    <div className="min-h-screen bg-slate-50 p-12 flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-slate-300 border-t-slate-900 rounded-full animate-spin"></div>
      <div className="text-slate-500 font-bold animate-pulse">Parsing Authorization Profile Structure...</div>
    </div>
  );

return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-right" />
      <nav className="bg-white border-b p-4 px-8 flex justify-between items-center shadow-sm sticky top-0 z-50">
        <span className="font-black text-slate-900 text-xl tracking-tight">AuraLedger Core</span>
        <div className="flex items-center gap-6">
          <div className="flex flex-col text-right hidden sm:flex">
            <span className="text-sm font-bold text-slate-900">{profile.full_name}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">{profile.role}</span>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-rose-100 transition">Log Out</button>
        </div>
      </nav>

      <main className="pb-12">
        {profile.role === 'super_admin' && <SuperAdminDashboard />}
        {profile.role === 'principal' && <PrincipalDashboard userProfile={profile} />}
        {profile.role === 'bursar' && <BursarDashboard userProfile={profile} />}
      </main>
    </div>
  );
}