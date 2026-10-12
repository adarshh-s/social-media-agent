import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { toast } from '../components/ui';

const INFO = {
  linkedin: {
    name: 'LinkedIn',
    can: ['Publish text, image and video posts to your profile', 'Comment on posts (where LinkedIn grants access)'],
    setup: 'Create an app at linkedin.com/developers, add the "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" products, then set LINKEDIN_CLIENT_ID / SECRET in server/.env.',
  },
  instagram: {
    name: 'Instagram',
    can: ['Publish image posts and Reels', 'Read comments and reply from the Comments page'],
    setup: 'Requires an Instagram Business or Creator account. Create a Meta app with "Instagram API with Instagram Login", then set INSTAGRAM_APP_ID / SECRET and a public PUBLIC_MEDIA_URL in server/.env.',
  },
};

export default function Accounts() {
  const [data, setData] = useState({ accounts: [], configured: {} });
  const [params, setParams] = useSearchParams();

  const load = () => api.get('/accounts').then(setData).catch((e) => toast(e.message, 'err'));
  useEffect(() => {
    load();
    if (params.get('connected')) toast(`${INFO[params.get('connected')]?.name} connected`);
    if (params.get('error')) toast(params.get('error'), 'err');
    if (params.size) setParams({}, { replace: true });
  }, []);

  const disconnect = async (p) => {
    await api.del(`/accounts/${p}`);
    load();
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Accounts</h1></header>
      <div className="grid-2">
        {Object.entries(INFO).map(([p, info]) => {
          const acc = data.accounts.find((a) => a.platform === p);
          const expired = acc?.expires_at && acc.expires_at < Date.now();
          return (
            <section className="card" key={p}>
              <div className="row between">
                <h2>{info.name}</h2>
                {acc && <span className={`status ${expired ? 'failed' : 'published'}`}>{expired ? 'expired' : 'connected'}</span>}
              </div>
              {acc ? (
                <div className="row gap">
                  {acc.avatar && <img className="avatar" src={acc.avatar} alt="" />}
                  <div className="col">
                    <b>{acc.name}</b>
                    {acc.expires_at && <span className="muted small">Access until {new Date(acc.expires_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              ) : <p className="muted">Not connected.</p>}
              <ul className="bullets small">{info.can.map((c) => <li key={c}>{c}</li>)}</ul>
              {data.configured[p] ? (
                <div className="row gap-sm">
                  <a className="btn" href={`/api/accounts/${p}/connect`}>{acc ? 'Reconnect' : `Connect ${info.name}`}</a>
                  {acc && <button className="btn ghost danger" onClick={() => disconnect(p)}>Disconnect</button>}
                </div>
              ) : (
                <div className="callout warn small">{info.setup}</div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
