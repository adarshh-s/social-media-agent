import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui';
import Dashboard from './pages/Dashboard';
import Compose from './pages/Compose';
import Planner from './pages/Planner';
import Queue from './pages/Queue';
import Engage from './pages/Engage';
import Posters from './pages/Posters';
import Videos from './pages/Videos';
import Library from './pages/Library';
import Accounts from './pages/Accounts';
import Brand from './pages/Brand';
import Settings from './pages/Settings';
import Autopilot from './pages/Autopilot';
import Login from './pages/Login';
import { useAuth } from './lib/auth';

const NAV = [
  ['/', 'Dashboard', '◧'],
  ['/autopilot', 'Autopilot', '⚡'],
  ['/compose', 'Compose', '✎'],
  ['/planner', 'Weekly plan', '▦'],
  ['/queue', 'Posts & queue', '☰'],
  ['/engage', 'Comments & replies', '💬'],
  ['/posters', 'Poster studio', '▣'],
  ['/videos', 'Video studio', '▶'],
  ['/library', 'Media library', '▤'],
  ['/accounts', 'Accounts', '⚭'],
  ['/brand', 'Brand voice', '✦'],
];

export default function App() {
  const { user, logout } = useAuth();

  if (user === undefined) return <div className="boot"><span className="spinner" /></div>;
  if (!user) return <><Login /><Toaster /></>;

  return (
    <BrowserRouter>
      <div className="shell">
        <aside className="sidebar">
          <div className="logo">Post<span>pilot</span></div>
          <nav>
            {NAV.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <span className="nav-icon" aria-hidden>{icon}</span>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="me">
            <NavLink to="/settings" className="me-link">
              <span className="me-avatar">{user.name[0]?.toUpperCase()}</span>
              <span className="truncate">{user.name}</span>
            </NavLink>
            <button className="btn ghost sm" onClick={logout}>Log out</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/compose" element={<Compose />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/engage" element={<Engage />} />
            <Route path="/posters" element={<Posters />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/library" element={<Library />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/brand" element={<Brand />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/autopilot" element={<Autopilot />} />
          </Routes>
        </main>
      </div>
      <Toaster />
    </BrowserRouter>
  );
}
