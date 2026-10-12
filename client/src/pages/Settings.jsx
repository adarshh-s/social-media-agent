import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { toast } from '../components/ui';

export default function Settings() {
  const { user, clear } = useAuth();
  const [usage, setUsage] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [del, setDel] = useState('');

  useEffect(() => { api.get('/ai/usage').then(setUsage).catch(() => {}); }, []);

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/change-password', pw);
      setPw({ current: '', next: '' });
      toast('Password changed. Other devices were signed out.');
    } catch (err) { toast(err.message, 'err'); }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!confirm('Permanently delete your account, connected accounts, posts and media? This cannot be undone.')) return;
    try {
      await api.del('/auth/account', { password: del });
      clear();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Account settings</h1></header>

      <section className="card">
        <h2>Profile</h2>
        <p><b>{user.name}</b> <span className="muted">· {user.email}</span></p>
        {usage && (
          <div className="col gap-sm">
            <span className="small muted">AI generations today: {usage.used} / {usage.limit}</span>
            <div className="meter"><div style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }} /></div>
          </div>
        )}
      </section>

      <form className="card" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></label>
        <button className="btn">Update password</button>
      </form>

      <form className="card danger-zone" onSubmit={deleteAccount}>
        <h2>Delete account</h2>
        <p className="muted small">Deletes your profile, disconnects LinkedIn and Instagram, and removes all your posts, plans and media from Postpilot. Posts already published on LinkedIn or Instagram stay there.</p>
        <label>Confirm with your password<input type="password" autoComplete="current-password" value={del} onChange={(e) => setDel(e.target.value)} required /></label>
        <button className="btn danger-solid">Delete my account</button>
      </form>
    </div>
  );
}
