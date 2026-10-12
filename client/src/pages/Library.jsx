import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { MediaThumb, toast } from '../components/ui';

export default function Library() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const load = () => api.get('/media').then(setItems).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const upload = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name);
    try { await api.post('/media', fd); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const remove = async (m) => {
    if (!confirm('Delete this file? Posts using it will lose their media.')) return;
    await api.del(`/media/${m.id}`);
    load();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Media library</h1>
        <label className="btn">
          Upload
          <input type="file" accept="image/png,image/jpeg,video/mp4" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        </label>
      </header>
      {items.length === 0 && <p className="muted">Posters and videos you create are saved here.</p>}
      <div className="media-grid lg">
        {items.map((m) => (
          <div className="media-card" key={m.id}>
            {m.kind === 'video' ? <video className="thumb" src={m.url} controls />
              : m.kind === 'audio' ? <audio src={m.url} controls className="audio" />
              : <MediaThumb media={m} />}
            <span className="small truncate">{m.label || m.kind}</span>
            <div className="row gap-sm">
              {m.kind !== 'audio' && <button className="btn sm" onClick={() => navigate('/compose', { state: { media: m } })}>Use</button>}
              <a className="btn ghost sm" href={m.url} download>Download</a>
              <button className="btn ghost sm danger" onClick={() => remove(m)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
