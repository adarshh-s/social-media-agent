import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../lib/api';
import { Spinner, toast } from '../components/ui';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function Autopilot() {
  const [prefs, setPrefs] = useState(null);
  const [caps, setCaps] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState('');

  const loadJobs = () => api.get('/jobs').then((js) => setJobs(js.filter((j) => j.kind === 'autopilot'))).catch(() => {});

  useEffect(() => {
    api.get('/settings/prefs').then(setPrefs).catch((e) => toast(e.message, 'err'));
    api.get('/capabilities').then(setCaps).catch(() => {});
    loadJobs();
  }, []);

  // Refresh progress while a run is active.
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [active]);

  if (!prefs) return null;
  const a = prefs.autopilot;
  const setA = (patch) => setPrefs({ ...prefs, autopilot: { ...a, ...patch } });
  const togglePlatform = (p) => setA({ platforms: a.platforms.includes(p) ? a.platforms.filter((x) => x !== p) : [...a.platforms, p] });

  const save = async () => {
    setBusy('save');
    try {
      setPrefs(await api.put('/settings/prefs', { ...prefs, timezone }));
      toast('Autopilot settings saved');
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const runNow = async () => {
    if (!a.goal.trim()) return toast('Set a goal first', 'err');
    setBusy('run');
    try {
      await api.put('/settings/prefs', { ...prefs, timezone });
      await api.post('/autopilot/run', {});
      toast('Autopilot is producing next week — this takes a few minutes');
      loadJobs();
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Autopilot</h1>
          <p className="muted">Every Friday, Postpilot plans next week, writes and edits every post, creates the posters and videos, and schedules them.</p>
        </div>
      </header>

      <section className="card">
        <label className="check toggle">
          <input type="checkbox" checked={a.enabled} onChange={(e) => setA({ enabled: e.target.checked })} />
          <b>Run automatically every week</b>
        </label>
        <label>What should your content achieve?
          <textarea rows={3} value={a.goal} onChange={(e) => setA({ goal: e.target.value })}
            placeholder="e.g. Build my reputation as the go-to expert on AI for small retailers, and get 10 demo requests a month" />
        </label>
        <div className="row gap wrap">
          <div className="field">
            <span>Platforms</span>
            <div className="row gap-sm">
              {['linkedin', 'instagram'].map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={a.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                  {p === 'linkedin' ? 'LinkedIn' : 'Instagram'}
                </label>
              ))}
            </div>
          </div>
          <label>Posts per week
            <input type="number" min={1} max={14} value={a.postsPerWeek} onChange={(e) => setA({ postsPerWeek: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={a.research} onChange={(e) => setA({ research: e.target.checked })} />
          Research each topic on the web for fresh facts and data
        </label>
      </section>

      <section className="card">
        <h2>Quality gate</h2>
        <p className="muted small">An AI editor scores every post from 1–10. Posts at or above the threshold publish automatically; the rest wait for your approval.</p>
        <label>Auto-publish posts scoring at least <b>{prefs.qualityThreshold}</b> / 10
          <input type="range" min={5} max={10} step={0.5} value={prefs.qualityThreshold} onChange={(e) => setPrefs({ ...prefs, qualityThreshold: Number(e.target.value) })} />
        </label>
        <label>Video voice
          <select value={prefs.voice} onChange={(e) => setPrefs({ ...prefs, voice: e.target.value })}>
            {Object.entries(caps?.voices ?? {}).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {caps && (
          <p className="muted small">
            Writing with <b>{caps.text === 'gemini' ? 'Gemini' : 'Claude'}</b> · images via <b>{caps.imageChain.join(' → ')}</b> · footage {caps.stockVideo ? <b>{caps.stockProviders.join(' + ')}</b> : 'off (AI images instead)'}
          </p>
        )}
        <p className="muted small">Times are scheduled in your time zone: {timezone}. For the best results, add your past posts on the <Link to="/brand">Brand voice</Link> page.</p>
        <div className="row gap-sm wrap">
          <button className="btn secondary" disabled={!!busy} onClick={save}>{busy === 'save' ? <Spinner /> : 'Save settings'}</button>
          <button className="btn" disabled={!!busy || active} onClick={runNow}>
            {busy === 'run' ? <Spinner /> : 'Produce next week now'}
          </button>
        </div>
      </section>

      {jobs.length > 0 && (
        <section className="card">
          <h2>Runs</h2>
          <ul className="list">
            {jobs.map((j) => (
              <li key={j.id} className="job">
                <span className={`status ${j.status === 'done' ? 'published' : j.status === 'failed' ? 'failed' : 'scheduled'}`}>{j.status}</span>
                <span className="grow">
                  Week of {j.input.weekStart}
                  {j.status === 'running' && <span className="muted small"> — <Spinner /> {j.progress}</span>}
                  {j.status === 'done' && (
                    <span className="small"> — {j.result.theme}: <b>{j.result.scheduled}</b> scheduled
                      {j.result.needs_approval > 0 && <>, <Link to="/queue?filter=needs_approval"><b>{j.result.needs_approval}</b> need approval</Link></>}
                    </span>
                  )}
                  {j.status === 'failed' && <span className="error-text small"> — {j.error}</span>}
                </span>
                <span className="muted small nowrap">{fmtDate(j.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
