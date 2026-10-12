import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PlatformToggle, Spinner, Variants, toast } from '../components/ui';

export default function Engage() {
  const [tab, setTab] = useState('comment');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Comments & replies</h1>
          <p className="muted">Write thoughtful comments on others' posts and reply to people on yours.</p>
        </div>
      </header>
      <div className="tabs">
        <button className={tab === 'comment' ? 'active' : ''} onClick={() => setTab('comment')}>Comment on a post</button>
        <button className={tab === 'reply' ? 'active' : ''} onClick={() => setTab('reply')}>Reply to a comment</button>
        <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>Instagram inbox</button>
      </div>
      {tab === 'comment' && <CommentWriter />}
      {tab === 'reply' && <ReplyWriter />}
      {tab === 'inbox' && <InstagramInbox />}
    </div>
  );
}

function CommentWriter() {
  const [platform, setPlatform] = useState('linkedin');
  const [postText, setPostText] = useState('');
  const [author, setAuthor] = useState('');
  const [goal, setGoal] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [variants, setVariants] = useState([]);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!postText.trim()) return toast('Paste the post text first', 'err');
    setBusy(true);
    try {
      setVariants((await api.post('/ai/comments', { platform, postText, author, goal })).variants);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const postComment = async (text) => {
    if (!postUrl.trim()) return toast('Paste the LinkedIn post URL to comment directly — or use Copy', 'err');
    try {
      await api.post('/linkedin/comment', { post: postUrl, text });
      toast('Comment posted on LinkedIn');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="grid-2">
      <section className="card">
        <PlatformToggle value={platform} onChange={setPlatform} />
        <label>Their post
          <textarea rows={8} value={postText} onChange={(e) => setPostText(e.target.value)} placeholder="Paste the post you want to comment on" />
        </label>
        <div className="row gap wrap">
          <label className="grow">Author (optional)
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Jane Doe, CTO at Acme" />
          </label>
          <label className="grow">Your goal (optional)
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. start a conversation about hiring" />
          </label>
        </div>
        {platform === 'linkedin' && (
          <label>Post URL (to comment directly from here)
            <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://www.linkedin.com/posts/…activity-7…" />
          </label>
        )}
        <button className="btn" onClick={generate} disabled={busy}>{busy ? <><Spinner /> Writing…</> : 'Write comments'}</button>
      </section>
      <section className="card">
        <h2>Suggestions</h2>
        {variants.length === 0 && <p className="muted">Comments will appear here.</p>}
        <Variants items={variants} onUse={platform === 'linkedin' ? postComment : undefined} useLabel="Post comment" />
      </section>
    </div>
  );
}

function ReplyWriter() {
  const [platform, setPlatform] = useState('linkedin');
  const [myPost, setMyPost] = useState('');
  const [comment, setComment] = useState('');
  const [commenter, setCommenter] = useState('');
  const [variants, setVariants] = useState([]);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!comment.trim()) return toast('Paste the comment you are replying to', 'err');
    setBusy(true);
    try {
      setVariants((await api.post('/ai/replies', { platform, myPost, comment, commenter })).variants);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="grid-2">
      <section className="card">
        <PlatformToggle value={platform} onChange={setPlatform} />
        <label>Their comment
          <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <label>Who wrote it (optional)
          <input value={commenter} onChange={(e) => setCommenter(e.target.value)} />
        </label>
        <label>Your original post (optional, for context)
          <textarea rows={5} value={myPost} onChange={(e) => setMyPost(e.target.value)} />
        </label>
        <button className="btn" onClick={generate} disabled={busy}>{busy ? <><Spinner /> Writing…</> : 'Write replies'}</button>
      </section>
      <section className="card">
        <h2>Suggestions</h2>
        {variants.length === 0 && <p className="muted">Replies will appear here.</p>}
        <Variants items={variants} />
      </section>
    </div>
  );
}

function InstagramInbox() {
  const [media, setMedia] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

  const load = () => api.get('/instagram/comments').then(setMedia).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const suggest = async (post, c) => {
    setBusy(c.id);
    try {
      const r = await api.post('/ai/replies', { platform: 'instagram', myPost: post.caption, comment: c.text, commenter: c.username, variants: 1 });
      setDrafts((d) => ({ ...d, [c.id]: r.variants[0]?.text ?? '' }));
    } catch (e) { toast(e.message, 'err'); }
    setBusy(null);
  };

  const send = async (c) => {
    setBusy(c.id);
    try {
      await api.post(`/instagram/comments/${c.id}/reply`, { message: drafts[c.id] });
      toast(`Replied to @${c.username}`);
      setDrafts((d) => ({ ...d, [c.id]: undefined }));
      load();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(null);
  };

  if (error) return <div className="callout warn">{error}</div>;
  if (!media) return <p className="muted"><Spinner /> Loading your recent posts…</p>;
  if (media.length === 0) return <p className="muted">No Instagram posts yet.</p>;

  return (
    <div className="col gap">
      {media.map((post) => (
        <section className="card" key={post.id}>
          <div className="row gap">
            <img className="thumb" src={post.thumbnail_url || post.media_url} alt="" />
            <div className="grow">
              <p className="clamp-2 small">{post.caption}</p>
              <a className="small" href={post.permalink} target="_blank" rel="noreferrer">Open on Instagram ↗</a>
            </div>
            <span className="muted small nowrap">{post.comments_count} comments</span>
          </div>
          {(post.comments?.data ?? []).map((c) => {
            const replied = c.replies?.data?.length > 0;
            return (
              <div className="comment" key={c.id}>
                <p><b>@{c.username}</b> {c.text} {replied && <span className="ok-text small">· replied</span>}</p>
                {drafts[c.id] !== undefined ? (
                  <div className="row gap-sm">
                    <input className="grow" value={drafts[c.id]} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} />
                    <button className="btn sm" disabled={busy === c.id} onClick={() => send(c)}>Send</button>
                  </div>
                ) : (
                  <button className="btn ghost sm" disabled={busy === c.id} onClick={() => suggest(post, c)}>
                    {busy === c.id ? <Spinner /> : 'AI reply'}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
