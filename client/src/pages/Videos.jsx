import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useJob } from '../lib/jobs';
import { SIZES } from '../lib/render';
import { PlatformToggle, Spinner, toast } from '../components/ui';

const VIDEO_SIZES = ['story', 'square', 'portrait'];

export default function Videos() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const [idea, setIdea] = useState(state?.idea ?? '');
  const [platform, setPlatform] = useState(state?.platform ?? 'instagram');
  const [seconds, setSeconds] = useState(30);
  const [script, setScript] = useState(null);
  const [caption, setCaption] = useState(state?.caption ?? '');
  const [size, setSize] = useState(state?.platform === 'linkedin' ? 'square' : 'story');
  const [voice, setVoice] = useState('af_heart');
  const [music, setMusic] = useState(null); // media row
  const [caps, setCaps] = useState(null);
  const [busy, setBusy] = useState('');
  const [jobId, setJobId] = useState(null);
  const job = useJob(jobId);

  useEffect(() => {
    api.get('/capabilities').then(setCaps).catch(() => {});
    api.get('/settings/prefs').then((p) => setVoice(p.voice)).catch(() => {});
  }, []);

  useEffect(() => {
    if (job?.status === 'done') toast('Video rendered and saved to your library');
    if (job?.status === 'failed') toast(job.error, 'err');
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeScript = async () => {
    if (!idea.trim()) return toast('Describe the video idea', 'err');
    setBusy('ai');
    try {
      const r = await api.post('/ai/video-script', { idea, platform, seconds: Number(seconds) });
      setScript(r);
      if (!caption) setCaption(r.caption);
      setJobId(null);
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const updateScene = (i, k, v) => setScript({ ...script, scenes: script.scenes.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const removeScene = (i) => setScript({ ...script, scenes: script.scenes.filter((_, j) => j !== i) });
  const addScene = () => setScript({ ...script, scenes: [...script.scenes, { narration: '', broll: '', image_prompt: '' }] });
  const move = (i, dir) => {
    const scenes = [...script.scenes];
    [scenes[i], scenes[i + dir]] = [scenes[i + dir], scenes[i]];
    setScript({ ...script, scenes });
  };

  const uploadMusic = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', file.name);
    try { setMusic(await api.post('/media', fd)); } catch (e) { toast(e.message, 'err'); }
  };

  const render = async () => {
    setBusy('render');
    try {
      const j = await api.post('/reels', { script, size, voice, music_id: music?.id ?? null });
      setJobId(j.id);
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const words = script?.scenes.reduce((a, s) => a + s.narration.split(/\s+/).filter(Boolean).length, 0) ?? 0;
  const rendering = job && (job.status === 'queued' || job.status === 'running');
  const video = job?.status === 'done' ? job.result.media : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Video studio</h1>
          <p className="muted">Faceless reels: AI script → natural voiceover → matching footage → bold animated captions.</p>
        </div>
      </header>

      {caps && (!caps.stockVideo || caps.images === 'pollinations') && (
        <div className="callout small">
          {!caps.stockVideo && <>Add a free <b>PIXABAY_API_KEY</b> (or Pexels) for real video footage — otherwise scenes use AI images with a slow zoom. </>}
          {caps.images === 'pollinations' && <>Add free <b>Cloudflare Workers AI</b> keys for reliable AI images. </>}
          See the README.
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>1. Idea</h2>
          <PlatformToggle value={platform} onChange={(p) => { setPlatform(p); setSize(p === 'linkedin' ? 'square' : 'story'); }} />
          <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. 3 signs your startup is ready to hire its first salesperson" />
          <label>Length (seconds)
            <input type="number" min={10} max={90} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </label>
          <button className="btn" onClick={writeScript} disabled={busy === 'ai'}>{busy === 'ai' ? <><Spinner /> Writing script…</> : 'Write script'}</button>
        </section>

        <section className="card">
          <h2>2. Style</h2>
          <label>Format
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {VIDEO_SIZES.map((k) => <option key={k} value={k}>{SIZES[k].label}</option>)}
            </select>
          </label>
          <label>Voice
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {Object.entries(caps?.voices ?? { af_heart: 'Heart' }).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Background music (optional — an MP3 you have rights to)
            <input type="file" accept="audio/mpeg" onChange={(e) => e.target.files[0] && uploadMusic(e.target.files[0])} />
          </label>
          {music && <span className="small ok-text">♪ {music.label} <button className="link" onClick={() => setMusic(null)}>remove</button></span>}
        </section>
      </div>

      {script && (
        <section className="card">
          <div className="row between wrap gap-sm">
            <h2>3. Script — {script.title} <span className="muted small">≈ {Math.round(words / 2.5)}s</span></h2>
            <button className="btn ghost sm" onClick={addScene}>+ Add scene</button>
          </div>
          <div className="script">
            {script.scenes.map((s, i) => (
              <div className="script-row" key={i}>
                <span className="scene-n">{i + 1}</span>
                <div className="grow col gap-sm">
                  <textarea rows={2} value={s.narration} placeholder="What the voice says" onChange={(e) => updateScene(i, 'narration', e.target.value)} />
                  <input value={s.broll} placeholder="Footage search, e.g. 'team meeting whiteboard'" onChange={(e) => updateScene(i, 'broll', e.target.value)} />
                </div>
                <div className="col gap-sm">
                  <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn ghost sm" disabled={i === script.scenes.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="btn ghost sm danger" onClick={() => removeScene(i)}>✕</button>
                </div>
              </div>
            ))}
          </div>
          <label>Caption
            <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <button className="btn" onClick={render} disabled={busy === 'render' || rendering || script.scenes.length === 0}>
            {rendering ? <><Spinner /> {job.progress || 'Queued…'}</> : 'Render video'}
          </button>
          {rendering && <p className="muted small">You can leave this page — the video keeps rendering and lands in your <Link to="/library">media library</Link>.</p>}
        </section>
      )}

      {video && (
        <section className="card center-col">
          <video className="video-preview" src={video.url} controls autoPlay playsInline />
          {job.result.credits?.length > 0 && <p className="muted small">Footage: {job.result.credits.join(', ')}</p>}
          <div className="row gap-sm">
            <a className="btn ghost" href={video.url} download>Download MP4</a>
            <button className="btn" onClick={() => navigate('/compose', { state: { media: video, content: caption, platform } })}>Use in a post →</button>
          </div>
        </section>
      )}
    </div>
  );
}
