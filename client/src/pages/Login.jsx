import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await signup(form.name, form.email, form.password);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-intro">
        <div className="logo">Post<span>pilot</span></div>
        <h1>Your AI social media team.</h1>
        <ul className="bullets">
          <li>Write LinkedIn & Instagram posts, comments and replies in your voice</li>
          <li>Plan a full week of content in one click</li>
          <li>Design posters and short videos</li>
          <li>Schedule everything — it publishes automatically</li>
        </ul>
      </div>

      <form className="card auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Log in' : 'Create your account'}</h2>
        {mode === 'signup' && (
          <label>Name<input value={form.name} onChange={set('name')} autoComplete="name" required /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></label>
        <label>Password
          <input type="password" value={form.password} onChange={set('password')} minLength={mode === 'signup' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
        </label>
        {mode === 'signup' && <span className="muted small">At least 8 characters.</span>}
        {error && <div className="callout warn small">{error}</div>}
        <button className="btn" disabled={busy}>
          {busy ? <Spinner /> : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <p className="small muted center-text">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </form>
    </div>
  );
}
