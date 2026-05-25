import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import PrincipalDashboard from './components/PrincipalDashboard';
import BursarLogs from './components/BursarLogs';
import ParentPortal from './components/ParentPortal';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    setProfile(data);
  }

  async function handleLogin(e) {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  }

  if (isParentPortal) {
    return <ParentPortal schoolSlug={schoolSlug} />;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-4">
          <h2 className="text-2xl font-black text-slate-900 text-center">Institutional Node Login</h2>
          <input className="border p-2.5 w-full rounded-xl" type="email" placeholder="Staff Email Address" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="border p-2.5 w-full rounded-xl" type="password" placeholder="Access Password" value={password} onChange={e=>setPassword(e.target.value)} required />
          <button type="submit" className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold hover:bg-slate-800 transition">Authorize Session</button>
        </form>
      </div>
    );
  }

  if (!profile) return <div className="p-12 text-center text-slate-500 font-bold">Parsing Authorization Profile Structure...</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b p-4 flex justify-between items-center shadow-sm">
        <span className="font-black text-slate-900 text-lg tracking-tight">EDU-LEDGER CORE</span>
        <div className="flex items-center gap-4">
          <span className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-bold uppercase tracking-wider">Role: {profile.role}</span>
          <button onClick={() => supabase.auth.signOut()} className="text-xs text-rose-600 font-bold hover:underline">Terminate Session</button>
        </div>
      </nav>

      {profile.role === 'super_admin' && <SuperAdminDashboard />}
      {profile.role === 'principal' && <PrincipalDashboard userProfile={profile} />}
      {profile.role === 'bursar' && <BursarLogs userProfile={profile} />}
    </div>
  );
}