import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../lib/api';
import { PlatformBadge, toast } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.get('/stats').then(setStats).catch((e) => toast(e.message, 'err'));
    api.get('/accounts').then((r) => setAccounts(r.accounts)).catch(() => {});
  }, []);

  const c = stats?.counts ?? {};
  const connected = (p) => accounts.some((a) => a.platform === p);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Welcome back, {user.name.split(' ')[0]}</h1>
          <p className="muted">Write, plan, design and auto-publish to LinkedIn and Instagram.</p>
        </div>
        <div className="row gap-sm">
          {c.needs_approval > 0 && <Link className="btn secondary" to="/queue?filter=needs_approval">Review {c.needs_approval}</Link>}
          <Link className="btn" to="/compose">New post</Link>
        </div>
      </header>

      {stats && stats.usage.used >= stats.usage.limit && (
        <div className="callout warn">You've used all {stats.usage.limit} AI generations for today. They reset at midnight UTC.</div>
      )}
      {(!connected('linkedin') || !connected('instagram')) && (
        <div className="callout">
          Connect your accounts to publish automatically. <Link to="/accounts">Go to Accounts →</Link>
        </div>
      )}

      <div className="stats">
        {[['Needs approval', c.needs_approval], ['Scheduled', c.scheduled], ['Published', c.published], ['Failed', c.failed]].map(([label, n]) => (
          <div className="stat" key={label}>
            <span className="stat-n">{n ?? 0}</span>
            <span className="muted">{label}</span>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="row between"><h2>Up next</h2><Link to="/queue">View queue</Link></div>
          {stats?.upcoming.length === 0 && <p className="muted">Nothing scheduled. <Link to="/planner">Plan your week</Link>.</p>}
          <ul className="list">
            {stats?.upcoming.map((p) => (
              <li key={p.id}>
                <PlatformBadge platform={p.platform} />
                <span className="truncate">{p.content.split('\n')[0]}</span>
                <span className="muted nowrap">{fmtDate(p.scheduled_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Quick actions</h2>
          <div className="quick">
            <Link to="/autopilot" className="quick-tile"><b>Autopilot</b><span>A full week of posts, posters & videos — scheduled</span></Link>
            <Link to="/engage" className="quick-tile"><b>Write comments</b><span>Thoughtful comments & replies</span></Link>
            <Link to="/posters" className="quick-tile"><b>Design a poster</b><span>AI copy + templates</span></Link>
            <Link to="/videos" className="quick-tile"><b>Make a video</b><span>Text reels from an idea</span></Link>
          </div>
        </section>
      </div>

      {stats?.failed.length > 0 && (
        <section className="card">
          <h2>Needs attention</h2>
          <ul className="list">
            {stats.failed.map((p) => (
              <li key={p.id}>
                <PlatformBadge platform={p.platform} />
                <span className="truncate">{p.content.split('\n')[0]}</span>
                <span className="error-text truncate">{p.error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
