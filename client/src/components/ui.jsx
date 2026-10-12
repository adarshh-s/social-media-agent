import { useEffect, useState } from 'react';
import { api, LIMITS } from '../lib/api';

/* ---------- Toasts ---------- */

const listeners = new Set();
export function toast(message, type = 'ok') {
  listeners.forEach((fn) => fn({ id: Math.random(), message, type }));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 5000);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
      ))}
    </div>
  );
}

/* ---------- Small building blocks ---------- */

export function PlatformBadge({ platform }) {
  return <span className={`badge ${platform}`}>{platform === 'linkedin' ? 'LinkedIn' : 'Instagram'}</span>;
}

export function StatusBadge({ status }) {
  return <span className={`status ${status}`}>{status === 'needs_approval' ? 'needs approval' : status}</span>;
}

export function ScoreBadge({ score }) {
  if (score == null) return null;
  const tone = score >= 8.5 ? 'great' : score >= 7 ? 'good' : 'weak';
  return <span className={`score ${tone}`} title="AI quality score">★ {Number(score).toFixed(1)}</span>;
}

const RUBRIC = ['hook', 'specificity', 'value', 'voice', 'format', 'engagement'];

/** Score breakdown + problems from the AI critic. */
export function QualityReport({ review, changes, sources }) {
  if (!review) return null;
  return (
    <div className="quality">
      <div className="row between wrap gap-sm">
        <b>Quality report</b>
        <ScoreBadge score={review.overall} />
      </div>
      <div className="rubric">
        {RUBRIC.map((k) => (
          <div key={k} className="rubric-row">
            <span>{k}</span>
            <div className="meter"><div style={{ width: `${(review[k] ?? 0) * 10}%` }} /></div>
            <span className="small">{review[k]}</span>
          </div>
        ))}
      </div>
      {changes && <p className="small"><b>Improved:</b> {changes}</p>}
      {review.problems?.length > 0 && (
        <ul className="bullets small">{review.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}
      {sources?.length > 0 && (
        <div className="small">
          <b>Research sources</b>
          <ul className="bullets">
            {sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PlatformToggle({ value, onChange }) {
  return (
    <div className="segmented">
      {['linkedin', 'instagram'].map((p) => (
        <button key={p} type="button" className={value === p ? 'active' : ''} onClick={() => onChange(p)}>
          {p === 'linkedin' ? 'LinkedIn' : 'Instagram'}
        </button>
      ))}
    </div>
  );
}

export function CharCount({ text, platform }) {
  const n = text.length, max = LIMITS[platform];
  return <span className={`charcount ${n > max ? 'over' : ''}`}>{n} / {max}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

/** AI variants list with "use" + "copy" actions. */
export function Variants({ items, onUse, useLabel = 'Use this' }) {
  if (!items?.length) return null;
  return (
    <div className="variants">
      {items.map((v, i) => (
        <div className="variant" key={i}>
          <div className="variant-head">
            <span className="angle">{v.angle}</span>
            <div className="row gap-sm">
              <button className="btn ghost sm" onClick={() => copy(v.text)}>Copy</button>
              {onUse && <button className="btn sm" onClick={() => onUse(v.text)}>{useLabel}</button>}
            </div>
          </div>
          <p className="prewrap">{v.text}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------- Media picker ---------- */

export function MediaThumb({ media, className = '' }) {
  if (!media) return null;
  if (media.kind === 'audio') return <span className={`thumb audio-thumb ${className}`}>♪</span>;
  return media.kind === 'video'
    ? <video className={`thumb ${className}`} src={media.url} muted playsInline />
    : <img className={`thumb ${className}`} src={media.url} alt={media.label || ''} />;
}

export function MediaPicker({ open, onClose, onPick }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (open) api.get('/media').then((m) => setItems(m.filter((x) => x.kind !== 'audio'))).catch((e) => toast(e.message, 'err'));
  }, [open]);

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name);
    try {
      const m = await api.post('/media', fd);
      onPick(m);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>Choose media</h3>
          <label className="btn ghost sm">
            Upload file
            <input type="file" accept="image/png,image/jpeg,video/mp4" hidden onChange={(e) => e.target.files[0] && uploadFile(e.target.files[0])} />
          </label>
        </div>
        {items.length === 0 && <p className="muted">No media yet — create a poster or video, or upload a file.</p>}
        <div className="media-grid">
          {items.map((m) => (
            <button key={m.id} className="media-tile" onClick={() => onPick(m)}>
              <MediaThumb media={m} />
              <span>{m.label || m.kind}</span>
            </button>
          ))}
        </div>
        <div className="row end"><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
