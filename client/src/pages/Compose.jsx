import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, fromLocalInput, toLocalInput } from '../lib/api';
import { CharCount, MediaPicker, MediaThumb, PlatformToggle, QualityReport, ScoreBadge, Spinner, Variants, toast } from '../components/ui';

/**
 * Write a post with AI, attach media, then save as draft, schedule, or publish now.
 * Also used to edit an existing post: navigate here with { state: { post } }.
 */
export default function Compose() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const editing = state?.post ?? null;

  const [platform, setPlatform] = useState(editing?.platform ?? state?.platform ?? 'linkedin');
  const [content, setContent] = useState(editing?.content ?? state?.content ?? '');
  const [media, setMedia] = useState(editing?.media ?? state?.media ?? null);
  const [when, setWhen] = useState(toLocalInput(editing?.scheduled_at));
  const [picker, setPicker] = useState(false);

  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [length, setLength] = useState('medium');
  const [variants, setVariants] = useState([]);
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState('best');
  const [doResearch, setDoResearch] = useState(true);
  const [report, setReport] = useState(null); // { review, changes, sources }

  const generate = async () => {
    if (!topic.trim()) return toast('Describe what the post is about', 'err');
    setBusy('ai');
    try {
      if (mode === 'best') {
        const r = await api.post('/ai/best-post', { platform, topic, tone, length, research: doResearch });
        setContent(r.text);
        setReport({ review: r.review, changes: r.changes, sources: r.sources });
        setVariants(r.alternatives.map((a) => ({ ...a, angle: `${a.angle}${a.score != null ? ` · ★ ${a.score.toFixed(1)}` : ''}` })));
      } else {
        const r = await api.post('/ai/post', { platform, topic, tone, length });
        setVariants(r.variants);
        setReport(null);
      }
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const score = async () => {
    if (!content.trim()) return;
    setBusy('score');
    try {
      setReport({ review: await api.post('/ai/score', { platform, text: content }) });
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const improve = async (instruction) => {
    if (!content.trim()) return;
    setBusy('ai');
    try {
      const r = await api.post('/ai/improve', { platform, text: content, instruction });
      setVariants(r.variants);
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const save = async (mode) => {
    if (!content.trim()) return toast('Write something first', 'err');
    if (platform === 'instagram' && !media) return toast('Instagram posts need an image or video', 'err');
    const scheduled_at = mode === 'schedule' ? fromLocalInput(when) : null;
    if (mode === 'schedule' && (!scheduled_at || scheduled_at < Date.now())) return toast('Pick a future date and time', 'err');
    setBusy(mode);
    try {
      const body = { platform, content, media_id: media?.id ?? null, scheduled_at };
      const post = editing ? await api.patch(`/posts/${editing.id}`, body) : await api.post('/posts', body);
      if (mode === 'now') {
        await api.post(`/posts/${post.id}/publish`);
        toast(`Published to ${platform === 'linkedin' ? 'LinkedIn' : 'Instagram'} 🎉`);
      } else toast(mode === 'schedule' ? 'Scheduled' : 'Draft saved');
      navigate('/queue');
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy('');
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{editing ? 'Edit post' : 'Compose'}</h1>
        <PlatformToggle value={platform} onChange={setPlatform} />
      </header>

      <div className="grid-2">
        <section className="card">
          <h2>Write with AI</h2>
          <label>What's the post about?
            <textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. 3 lessons from shipping our first product in 30 days" />
          </label>
          <div className="row gap">
            <label className="grow">Tone
              <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. honest, energetic" />
            </label>
            <label>Length
              <select value={length} onChange={(e) => setLength(e.target.value)}>
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </label>
          </div>
          <div className="segmented">
            <button className={mode === 'best' ? 'active' : ''} onClick={() => setMode('best')}>Best version</button>
            <button className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>Quick variants</button>
          </div>
          {mode === 'best' && (
            <>
              <p className="muted small">Writes 4 drafts, has an AI editor score them, then rewrites the strongest. Takes about a minute.</p>
              <label className="check">
                <input type="checkbox" checked={doResearch} onChange={(e) => setDoResearch(e.target.checked)} />
                Research the topic on the web for fresh facts
              </label>
            </>
          )}
          <button className="btn" onClick={generate} disabled={busy === 'ai'}>
            {busy === 'ai'
              ? <><Spinner /> {mode === 'best' ? (doResearch ? 'Researching, drafting & editing…' : 'Drafting & editing…') : 'Writing…'}</>
              : mode === 'best' ? 'Write the best version' : 'Generate 3 variants'}
          </button>
          {report && <QualityReport {...report} />}
          {variants.length > 0 && mode === 'best' && <p className="muted small">Other drafts the editor considered:</p>}
          <Variants items={variants} onUse={(t) => { setContent(t); setReport(null); }} />
        </section>

        <section className="card">
          <div className="row between">
            <h2>Post</h2>
            <div className="row gap-sm">
              {report?.review && <ScoreBadge score={report.review.overall} />}
              <CharCount text={content} platform={platform} />
            </div>
          </div>
          <textarea className="editor" rows={14} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="Your post text…" />
          <div className="row gap-sm wrap">
            <button className="btn secondary sm" disabled={!content || !!busy} onClick={score}>
              {busy === 'score' ? <Spinner /> : 'Score my post'}
            </button>
            {['Stronger hook', 'Shorter', 'More personal', 'Add a question at the end'].map((i) => (
              <button key={i} className="btn ghost sm" disabled={!content || busy === 'ai'} onClick={() => improve(i)}>{i}</button>
            ))}
          </div>

          <div className="attach">
            {media ? (
              <div className="row gap">
                <MediaThumb media={media} className="lg" />
                <div className="col gap-sm">
                  <span>{media.label || media.kind}</span>
                  <div className="row gap-sm">
                    <button className="btn ghost sm" onClick={() => setPicker(true)}>Change</button>
                    <button className="btn ghost sm" onClick={() => setMedia(null)}>Remove</button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="btn ghost" onClick={() => setPicker(true)}>
                + Attach image or video{platform === 'instagram' ? ' (required)' : ''}
              </button>
            )}
          </div>

          <div className="publish-bar">
            <label>Schedule for
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <div className="row gap-sm wrap">
              <button className="btn ghost" disabled={!!busy} onClick={() => save('draft')}>Save draft</button>
              <button className="btn secondary" disabled={!!busy || !when} onClick={() => save('schedule')}>
                {busy === 'schedule' ? <Spinner /> : 'Schedule'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => save('now')}>
                {busy === 'now' ? <><Spinner /> Publishing…</> : 'Publish now'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={(m) => { setMedia(m); setPicker(false); }} />
    </div>
  );
}
