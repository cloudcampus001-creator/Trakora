import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function SuperAdminDashboard() {
  const [schools, setSchools] = useState([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPassword, setPPassword] = useState('');
  const [pName, setPName] = useState('');

  useEffect(() => { loadSchools(); }, []);

  async function loadSchools() {
    const { data } = await supabase.from('schools').select('*');
    setSchools(data || []);
  }

  async function handleProvisionSchool(e) {
    e.preventDefault();
    // 1. Create School Instance
    const { data: newSchool, error: sErr } = await supabase
      .from('schools').insert([{ name, slug }]).select().single();
    if (sErr) return alert(sErr.message);

    // 2. Provision Auth Core Node for Principal
    const { data: authData, error: aErr } = await supabase.auth.signUp({
      email: pEmail, password: pPassword
    });
    if (aErr) return alert(aErr.message);

    // 3. Link metadata profile mapping with administrative permissions
    const { error: pErr } = await supabase.from('profiles').insert([{
      id: authData.user.id, school_id: newSchool.id, role: 'principal', full_name: pName
    }]);
    if (pErr) return alert(pErr.message);

    // 4. Instantiate Configuration Default Record Space
    await supabase.from('school_configs').insert([{ school_id: newSchool.id }]);

    alert('School and Administrative Principal Successfully Instantiated!');
    loadSchools();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-800">Platform Core Infrastructure Admin</h1>
      <form onSubmit={handleProvisionSchool} className="bg-white p-6 rounded-xl shadow-md mb-8 grid grid-cols-2 gap-4">
        <h2 className="text-xl font-bold col-span-2 text-blue-600">Provision New Institutional Node</h2>
        <input className="border p-2 rounded" placeholder="School Name" value={name} onChange={e=>setName(e.target.value)} required />
        <input className="border p-2 rounded" placeholder="Subdomain/Slug" value={slug} onChange={e=>setSlug(e.target.value)} required />
        <input className="border p-2 rounded" placeholder="Principal Name" value={pName} onChange={e=>setPName(e.target.value)} required />
        <input className="border p-2 rounded" placeholder="Principal Email" type="email" value={pEmail} onChange={e=>setPEmail(e.target.value)} required />
        <input className="border p-2 rounded" placeholder="Security Password" type="password" value={pPassword} onChange={e=>setPPassword(e.target.value)} required />
        <button type="submit" className="bg-blue-600 text-white p-2 rounded font-bold hover:bg-blue-700 transition">Spin Up Node</button>
      </form>
      <div className="bg-white p-6 rounded-xl shadow-md">
        <h2 className="text-xl font-bold mb-4">Active Institutional Networks</h2>
        <ul>{schools.map(s => <li key={s.id} className="border-b py-2 text-slate-700">{s.name} ({s.slug})</li>)}</ul>
      </div>
    </div>
  );
}