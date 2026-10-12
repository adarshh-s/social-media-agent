import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../lib/api';
import { MediaThumb, PlatformBadge, ScoreBadge, Spinner, StatusBadge, toast } from '../components/ui';

const FILTERS = ['all', 'needs_approval', 'scheduled', 'draft', 'published', 'failed'];

export default function Queue() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const { search } = useLocation();
  const [filter, setFilter] = useState(new URLSearchParams(search).get('filter') || 'all');
  const [view, setView] = useState('list');
  const [busy, setBusy] = useState(null);

  const load = () => api.get('/posts').then(setPosts).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const shown = filter === 'all' ? posts : posts.filter((p) => p.status === filter);

  const publish = async (p) => {
    setBusy(p.id);
    try {
      await api.post(`/posts/${p.id}/publish`);
      toast('Published 🎉');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(null);
    load();
  };

  const approve = async (p) => {
    try {
      await api.post(`/posts/${p.id}/approve`);
      toast('Approved — it will publish on schedule');
    } catch (e) { toast(e.message, 'err'); }
    load();
  };

  const remove = async (p) => {
    if (!confirm('Delete this post?')) return;
    await api.del(`/posts/${p.id}`);
    load();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Posts & queue</h1>
        <div className="segmented">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
          <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendar</button>
        </div>
      </header>

      {view === 'calendar' ? <Calendar posts={posts} onOpen={(p) => navigate('/compose', { state: { post: p } })} /> : (
        <>
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f.replace('_', ' ')} <span className="muted">{f === 'all' ? posts.length : posts.filter((p) => p.status === f).length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="muted">No posts here yet.</p>}
          <div className="post-list">
            {shown.map((p) => (
              <article className="post-row" key={p.id}>
                <MediaThumb media={p.media} />
                <div className="grow col gap-sm">
                  <div className="row gap-sm wrap">
                    <PlatformBadge platform={p.platform} />
                    <StatusBadge status={p.status} />
                    <ScoreBadge score={p.quality_score} />
                    <span className="muted small">
                      {p.status === 'published' ? `Published ${fmtDate(p.published_at)}` : p.scheduled_at ? fmtDate(p.scheduled_at) : 'Not scheduled'}
                    </span>
                  </div>
                  <p className="prewrap clamp">{p.content}</p>
                  {p.error && <p className="error-text small">{p.error}</p>}
                  {p.status === 'needs_approval' && p.quality_notes && (
                    <div className="small muted">
                      {p.quality_notes.error && <p className="error-text">{p.quality_notes.error}</p>}
                      {p.quality_notes.problems?.length > 0 && <>Editor notes: {p.quality_notes.problems.slice(0, 3).join(' · ')}</>}
                    </div>
                  )}
                </div>
                <div className="col gap-sm">
                  {p.status === 'needs_approval' && (
                    <button className="btn sm" onClick={() => approve(p)}>Approve</button>
                  )}
                  {p.status !== 'published' && p.status !== 'publishing' && (
                    <>
                      <button className={`btn sm ${p.status === 'needs_approval' ? 'ghost' : ''}`} disabled={busy === p.id} onClick={() => publish(p)}>
                        {busy === p.id ? <Spinner /> : p.status === 'failed' ? 'Retry' : 'Publish now'}
                      </button>
                      <button className="btn ghost sm" onClick={() => navigate('/compose', { state: { post: p } })}>Edit</button>
                    </>
                  )}
                  <button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Calendar({ posts, onOpen }) {
  const [offset, setOffset] = useState(0);
  const start = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // Monday
    return d;
  }, [offset]);

  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const at = (p) => p.scheduled_at ?? p.published_at;

  return (
    <>
      <div className="row between">
        <button className="btn ghost sm" onClick={() => setOffset(offset - 1)}>← Prev</button>
        <b>Week of {start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</b>
        <button className="btn ghost sm" onClick={() => setOffset(offset + 1)}>Next →</button>
      </div>
      <div className="week">
        {days.map((d) => {
          const items = posts
            .filter((p) => at(p) && new Date(at(p)).toDateString() === d.toDateString())
            .sort((a, b) => at(a) - at(b));
          return (
            <div className="day" key={d.toISOString()}>
              <h3>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</h3>
              {items.map((p) => (
                <button key={p.id} className={`cal-item ${p.status}`} onClick={() => p.status !== 'published' && onOpen(p)}>
                  <span className="small">{new Date(at(p)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  <PlatformBadge platform={p.platform} />
                  <span className="small clamp-2">{p.content}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
