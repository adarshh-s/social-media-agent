import { mediaUrl } from '../media.js';

// Instagram API with Instagram Login (Business/Creator accounts).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
const GRAPH = `https://graph.instagram.com/${process.env.INSTAGRAM_API_VERSION || 'v23.0'}`;
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
];

const redirectUri = () => `${process.env.SERVER_URL}/api/accounts/instagram/callback`;

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function exchangeCode(code) {
  const short = await json(
    await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(),
        code,
      }),
    }),
    'Instagram token exchange'
  );

  // Swap the 1-hour token for a 60-day one.
  const long = await json(
    await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        access_token: short.access_token,
      })}`
    ),
    'Instagram long-lived token'
  );

  const me = await json(
    await fetch(`${GRAPH}/me?fields=user_id,username,profile_picture_url&access_token=${long.access_token}`),
    'Instagram profile'
  );

  return {
    external_id: me.user_id,
    name: me.username,
    avatar: me.profile_picture_url ?? null,
    access_token: long.access_token,
    expires_at: Date.now() + long.expires_in * 1000,
  };
}

/** Long-lived tokens can be refreshed once they are at least 24h old. */
export async function refreshToken(account) {
  const res = await json(
    await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.access_token}`
    ),
    'Instagram token refresh'
  );
  return { access_token: res.access_token, expires_at: Date.now() + res.expires_in * 1000 };
}

async function waitUntilReady(account, containerId) {
  for (let i = 0; i < 60; i++) {
    const s = await json(
      await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${account.access_token}`),
      'Instagram container status'
    );
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Instagram could not process the media: ${s.status || s.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Instagram media processing timed out');
}

export async function publish(account, { content, media }) {
  if (!media) throw new Error('Instagram posts need an image or video. Attach a poster or video first.');

  // Instagram fetches media from a public URL, so PUBLIC_MEDIA_URL must be reachable from the internet.
  const params = { caption: content, access_token: account.access_token };
  if (media.kind === 'video') Object.assign(params, { media_type: 'REELS', video_url: mediaUrl(media) });
  else params.image_url = mediaUrl(media);

  const container = await json(
    await fetch(`${GRAPH}/${account.external_id}/media`, { method: 'POST', body: new URLSearchParams(params) }),
    'Instagram media container'
  );
  await waitUntilReady(account, container.id);

  const published = await json(
    await fetch(`${GRAPH}/${account.external_id}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: container.id, access_token: account.access_token }),
    }),
    'Instagram publish'
  );
  return published.id;
}

export async function recentMediaWithComments(account, limit = 10) {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,' +
    'comments.limit(25){id,text,username,timestamp,replies{id,text,username,timestamp}}';
  const res = await json(
    await fetch(`${GRAPH}/${account.external_id}/media?fields=${fields}&limit=${limit}&access_token=${account.access_token}`),
    'Instagram media'
  );
  return res.data;
}

export async function reply(account, commentId, message) {
  const res = await json(
    await fetch(`${GRAPH}/${commentId}/replies`, {
      method: 'POST',
      body: new URLSearchParams({ message, access_token: account.access_token }),
    }),
    'Instagram reply'
  );
  return res.id;
}

async function json(res, what) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${body}`);
  return JSON.parse(body);
}
