import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { PlatformBadge, Spinner, copy, toast } from '../components/ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/** weekStart (YYYY-MM-DD, a Monday) + "Wednesday" + "09:30" -> local timestamp */
function slotTime(weekStart, day, time) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const [hh, mm] = (time || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d + DAYS.indexOf(day), hh || 9, mm || 0).getTime();
}

export default function Planner() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    goal: '', weekStart: nextMonday(), postsPerWeek: 5, platforms: ['linkedin', 'instagram'], notes: '',
  });
  const [plan, setPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState('');
  const [added, setAdded] = useState({});

  useEffect(() => { api.get('/plans').then(setHistory).catch(() => {}); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const togglePlatform = (p) =>
    setForm({ ...form, platforms: form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p] });

  const generate = async () => {
    if (!form.goal.trim()) return toast('What do you want to achieve this week?', 'err');
    if (!form.platforms.length) return toast('Pick at least one platform', 'err');
    setBusy('plan');
    try {
      const p = await api.post('/plans', { ...form, postsPerWeek: Number(form.postsPerWeek) });
      setPlan(p);
      setAdded({});
      setHistory((h) => [p, ...h]);
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  // Instagram needs media, so those posts go in as drafts until a poster/video is attached.
  const addItem = async (item, i) => {
    const needsMedia = item.platform === 'instagram' || item.format !== 'text';
    const at = slotTime(plan.week_start, item.day, item.time);
    const scheduled_at = !needsMedia && at > Date.now() ? at : null;
    await api.post('/posts', { platform: item.platform, content: item.content, scheduled_at, plan_id: plan.id });
    setAdded((a) => ({ ...a, [i]: scheduled_at ? 'scheduled' : 'draft' }));
  };

  const addAll = async () => {
    setBusy('all');
    try {
      for (const [i, item] of plan.items.entries()) if (!added[i]) await addItem(item, i);
      toast('Added to your queue. Text posts are scheduled; posts needing visuals are saved as drafts.');
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const byDay = plan ? DAYS.map((d) => [d, plan.items.map((it, i) => ({ ...it, i })).filter((it) => it.day === d)]) : [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Weekly plan</h1>
          <p className="muted">Tell the AI your goal — get a full week of ready-to-publish posts.</p>
        </div>
      </header>

      <section className="card">
        <label>Goal for the week
          <input value={form.goal} onChange={set('goal')} placeholder="e.g. Grow awareness for our new AI analytics feature among startup founders" />
        </label>
        <div className="row gap wrap">
          <label>Week starting
            <input type="date" value={form.weekStart} onChange={set('weekStart')} />
          </label>
          <label>Posts this week
            <input type="number" min={1} max={21} value={form.postsPerWeek} onChange={set('postsPerWeek')} />
          </label>
          <div className="field">
            <span>Platforms</span>
            <div className="row gap-sm">
              {['linkedin', 'instagram'].map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={form.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                  {p === 'linkedin' ? 'LinkedIn' : 'Instagram'}
                </label>
              ))}
            </div>
          </div>
        </div>
        <label>Anything else? (launches, events, stories to include)
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </label>
        <button className="btn" onClick={generate} disabled={busy === 'plan'}>
          {busy === 'plan' ? <><Spinner /> Planning your week… (this can take a minute)</> : 'Generate weekly plan'}
        </button>
      </section>

      {plan && (
        <>
          <section className="card">
            <div className="row between wrap gap">
              <div>
                <h2>{plan.theme}</h2>
                <p className="muted">{plan.strategy}</p>
              </div>
              <button className="btn" onClick={addAll} disabled={busy === 'all'}>
                {busy === 'all' ? <Spinner /> : 'Add all to queue'}
              </button>
            </div>
          </section>

          <div className="week">
            {byDay.map(([day, items]) => (
              <div className="day" key={day}>
                <h3>{day}</h3>
                {items.length === 0 && <p className="muted small">Rest day</p>}
                {items.map((it) => (
                  <article className="plan-item" key={it.i}>
                    <div className="row between">
                      <PlatformBadge platform={it.platform} />
                      <span className="muted small">{it.time} · {it.format}</span>
                    </div>
                    <b>{it.title}</b>
                    <p className="prewrap small clamp">{it.content}</p>
                    {it.visual && <p className="small visual">🎨 {it.visual}</p>}
                    <div className="row gap-sm wrap">
                      <button className="btn ghost sm" onClick={() => copy(it.content)}>Copy</button>
                      <button className="btn ghost sm" onClick={() => navigate('/compose', { state: { platform: it.platform, content: it.content } })}>Edit</button>
                      {it.visual && (
                        <button className="btn ghost sm" onClick={() => navigate(it.format === 'video' ? '/videos' : '/posters', { state: { idea: it.visual, caption: it.content, platform: it.platform } })}>
                          {it.format === 'video' ? 'Make video' : 'Make poster'}
                        </button>
                      )}
                      {added[it.i]
                        ? <span className="small ok-text">✓ {added[it.i]}</span>
                        : <button className="btn sm" onClick={() => addItem(it, it.i).catch((e) => toast(e.message, 'err'))}>Add</button>}
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>

          {plan.engagement?.length > 0 && (
            <section className="card">
              <h2>Engagement routine</h2>
              <ul className="bullets">{plan.engagement.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </section>
          )}
        </>
      )}

      {!plan && history.length > 0 && (
        <section className="card">
          <h2>Previous plans</h2>
          <ul className="list">
            {history.map((h) => (
              <li key={h.id}>
                <span className="nowrap muted">Week of {h.week_start}</span>
                <span className="truncate">{h.theme} — {h.goal}</span>
                <button className="btn ghost sm" onClick={() => { setPlan(h); setAdded({}); }}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
