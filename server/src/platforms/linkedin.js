import fs from 'node:fs';
import { mediaPath } from '../media.js';

// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
const API = 'https://api.linkedin.com/rest';
const VERSION = process.env.LINKEDIN_API_VERSION || '202608';
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

const redirectUri = () => `${process.env.SERVER_URL}/api/accounts/linkedin/callback`;

export function authUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES.join(' '),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeCode(code) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET,
    }),
  });
  const token = await json(res, 'LinkedIn token exchange');

  const me = await json(
    await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }),
    'LinkedIn profile'
  );

  return {
    external_id: me.sub,
    name: me.name,
    avatar: me.picture ?? null,
    access_token: token.access_token,
    expires_at: Date.now() + token.expires_in * 1000,
  };
}

function headers(account, extra = {}) {
  return {
    Authorization: `Bearer ${account.access_token}`,
    'LinkedIn-Version': VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

const author = (account) => `urn:li:person:${account.external_id}`;

async function uploadImage(account, media) {
  const init = await json(
    await fetch(`${API}/images?action=initializeUpload`, {
      method: 'POST',
      headers: headers(account, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner: author(account) } }),
    }),
    'LinkedIn image init'
  );
  const { uploadUrl, image } = init.value;
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${account.access_token}` },
    body: fs.readFileSync(mediaPath(media)),
  });
  if (!put.ok) throw new Error(`LinkedIn image upload failed (${put.status})`);
  return image;
}

async function uploadVideo(account, media) {
  const bytes = fs.readFileSync(mediaPath(media));
  const init = await json(
    await fetch(`${API}/videos?action=initializeUpload`, {
      method: 'POST',
      headers: headers(account, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: author(account),
          fileSizeBytes: bytes.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    }),
    'LinkedIn video init'
  );
  const { video, uploadInstructions, uploadToken } = init.value;

  const etags = [];
  for (const part of uploadInstructions) {
    const res = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes.subarray(part.firstByte, part.lastByte + 1),
    });
    if (!res.ok) throw new Error(`LinkedIn video part upload failed (${res.status})`);
    etags.push(res.headers.get('etag'));
  }

  const fin = await fetch(`${API}/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: headers(account, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      finalizeUploadRequest: { video, uploadToken: uploadToken ?? '', uploadedPartIds: etags },
    }),
  });
  if (!fin.ok) throw new Error(`LinkedIn video finalize failed (${fin.status}): ${await fin.text()}`);
  return video;
}

export async function publish(account, { content, media }) {
  const body = {
    author: author(account),
    commentary: escapeCommentary(content),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  if (media) {
    const id = media.kind === 'video' ? await uploadVideo(account, media) : await uploadImage(account, media);
    body.content = { media: { id, title: media.label || 'Post media' } };
  }

  const res = await fetch(`${API}/posts`, {
    method: 'POST',
    headers: headers(account, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (res.status !== 201) {
    throw new Error(`LinkedIn publish failed (${res.status}): ${await res.text()}`);
  }
  return res.headers.get('x-restli-id');
}

/**
 * Comment on a post. Requires the post's URN (urn:li:share:... or urn:li:ugcPost:...).
 * Note: LinkedIn only allows this for apps that have the relevant API product access.
 */
export async function comment(account, postUrn, text) {
  const res = await fetch(`${API}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: 'POST',
    headers: headers(account, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actor: author(account), object: postUrn, message: { text } }),
  });
  if (!res.ok) throw new Error(`LinkedIn comment failed (${res.status}): ${await res.text()}`);
  return res.headers.get('x-restli-id');
}

/** Extract a post URN from a LinkedIn post URL or a raw URN. */
export function postUrnFrom(input) {
  const m = String(input).match(/urn:li:(share|ugcPost|activity):\d+/) ||
    String(input).match(/(share|ugcPost|activity)[-:](\d{10,})/);
  if (!m) return null;
  return m[0].startsWith('urn:') ? m[0] : `urn:li:${m[1]}:${m[2]}`;
}

// LinkedIn "little text" format treats these characters as markup, so escape
// them and turn #words into real hashtag entities.
function escapeCommentary(text) {
  const tags = [];
  const withPlaceholders = text.replace(/#([\p{L}\p{N}_]+)/gu, (_, tag) => {
    tags.push(tag);
    return `\u0000${tags.length - 1}\u0000`;
  });
  return withPlaceholders
    .replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `{hashtag|\\#|${tags[i]}}`);
}

async function json(res, what) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${body}`);
  return JSON.parse(body);
}
