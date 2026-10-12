import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { IMAGE_TEMPLATES, PRESET_PALETTES, SIZES, TEMPLATES, canvasToBlob, drawDesign, ensureFonts, loadImage } from '../lib/render';
import { ScoreBadge, Spinner, toast } from '../components/ui';

export default function Posters() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const canvas = useRef(null);

  const [idea, setIdea] = useState(state?.idea ?? '');
  const [style, setStyle] = useState('');
  const [design, setDesign] = useState({
    template: 'bold',
    size: state?.platform === 'linkedin' ? 'square' : 'portrait',
    headline: 'Your big idea goes here',
    subheadline: 'A supporting line that explains why it matters to your audience.',
    cta: 'Learn more',
    brand: '',
    palette: PRESET_PALETTES[0],
    image: null,
  });
  const [busy, setBusy] = useState('');
  const [fontsReady, setFontsReady] = useState(false);
  // The AI-generated poster is already saved; reuse it unless the user edits the design.
  const [aiResult, setAiResult] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    ensureFonts().then(() => setFontsReady(true));
    api.get('/settings/brand').then((b) => b.name && setDesign((d) => ({ ...d, brand: d.brand || b.name }))).catch(() => {});
  }, []);

  useEffect(() => {
    if (canvas.current) drawDesign(canvas.current, design);
  }, [design, fontsReady]);

  const edit = (next) => { setDesign(next); setDirty(true); };
  const set = (k) => (e) => edit({ ...design, [k]: e.target.value });
  const setColor = (k) => (e) => edit({ ...design, palette: { ...design.palette, [k]: e.target.value } });

  const generate = async () => {
    if (!idea.trim()) return toast('Describe the poster idea', 'err');
    setBusy('ai');
    try {
      const r = await api.post('/posters/generate', { idea, style, size: design.size });
      const image = r.background ? await loadImage(r.background.url) : null;
      setDesign((d) => ({ ...d, ...r.design, brand: d.brand, image }));
      setAiResult(r);
      setDirty(false);
      toast('AI poster ready and saved to your library');
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const pickImage = async (file) => {
    const img = await loadImage(URL.createObjectURL(file));
    edit({ ...design, image: img, template: IMAGE_TEMPLATES.includes(design.template) ? design.template : 'photo' });
  };

  const save = async (andUse) => {
    if (aiResult && !dirty) {
      if (andUse) navigate('/compose', { state: { media: aiResult.media, content: state?.caption ?? '', platform: state?.platform ?? 'instagram' } });
      else toast('Already saved in your library');
      return;
    }
    setBusy('save');
    try {
      const fd = new FormData();
      fd.append('file', await canvasToBlob(canvas.current), 'poster.png');
      fd.append('label', design.headline.slice(0, 60));
      const media = await api.post('/media', fd);
      setAiResult({ media });
      setDirty(false);
      toast('Poster saved to your media library');
      if (andUse) navigate('/compose', { state: { media, content: state?.caption ?? '', platform: state?.platform ?? 'instagram' } });
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const download = async () => {
    const url = URL.createObjectURL(await canvasToBlob(canvas.current));
    Object.assign(document.createElement('a'), { href: url, download: 'poster.png' }).click();
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Poster studio</h1>
          <p className="muted">AI writes the copy and picks colours; you fine-tune the design.</p>
        </div>
      </header>

      <div className="studio">
        <section className="card controls">
          <h2>1. Idea</h2>
          <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Announce our free webinar on AI for small businesses, Oct 30" />
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Style (optional) — e.g. bold & dark, pastel, corporate" />
          <button className="btn" onClick={generate} disabled={busy === 'ai'}>{busy === 'ai' ? <><Spinner /> Designing, generating image & reviewing…</> : 'Generate with AI'}</button>
          <p className="muted small">AI picks the layout and copy, creates a background image when it helps, then an AI art director reviews the result and fixes it.</p>
          {aiResult?.review && (
            <div className="quality small">
              <div className="row between"><b>Art director review</b><ScoreBadge score={aiResult.review.score ?? aiResult.review.firstScore} /></div>
              {aiResult.review.score == null && <span className="muted">First draft scored {aiResult.review.firstScore}/10. Fixes applied:</span>}
              <ul className="bullets">{aiResult.review.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          <h2>2. Layout</h2>
          <div className="chips">
            {TEMPLATES.map((t) => (
              <button key={t} className={`chip ${design.template === t ? 'active' : ''}`} onClick={() => edit({ ...design, template: t })}>{t}</button>
            ))}
          </div>
          <select value={design.size} onChange={set('size')}>
            {Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          {IMAGE_TEMPLATES.includes(design.template) && (
            <label className="btn ghost sm">
              {design.image ? 'Change background photo' : 'Upload background photo'}
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && pickImage(e.target.files[0])} />
            </label>
          )}

          <h2>3. Text</h2>
          <label>Headline<input value={design.headline} onChange={set('headline')} /></label>
          <label>Subheadline<textarea rows={2} value={design.subheadline} onChange={set('subheadline')} /></label>
          <div className="row gap">
            <label className="grow">Button / CTA<input value={design.cta} onChange={set('cta')} /></label>
            <label className="grow">Brand / handle<input value={design.brand} onChange={set('brand')} placeholder="@yourname" /></label>
          </div>

          <h2>4. Colours</h2>
          <div className="row gap-sm wrap">
            {PRESET_PALETTES.map((p, i) => (
              <button key={i} className="swatch" title="Use palette" onClick={() => edit({ ...design, palette: p })}
                style={{ background: `linear-gradient(135deg, ${p.background} 50%, ${p.accent} 50%)` }} />
            ))}
          </div>
          <div className="row gap">
            {['background', 'accent', 'text'].map((k) => (
              <label key={k} className="color">{k}<input type="color" value={design.palette[k]} onChange={setColor(k)} /></label>
            ))}
          </div>
        </section>

        <section className="preview">
          <canvas ref={canvas} className="poster-canvas" />
          <div className="row gap-sm wrap center">
            <button className="btn ghost" onClick={download}>Download PNG</button>
            <button className="btn secondary" disabled={!!busy} onClick={() => save(false)}>Save to library</button>
            <button className="btn" disabled={!!busy} onClick={() => save(true)}>Use in a post →</button>
          </div>
        </section>
      </div>
    </div>
  );
}
