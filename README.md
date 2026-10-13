# Postpilot — AI social media studio

Write LinkedIn & Instagram posts, comments and replies with Claude, plan a whole week,
design posters, render short videos, and auto-publish on a schedule.

```
client/   React (Vite) app — http://localhost:5173
server/   Node/Express API + SQLite + scheduler — http://localhost:4000
```

## Quick start

Requires Node 22.13+ (built-in SQLite) and `ffmpeg` (`brew install ffmpeg`).

```bash
npm run setup
cp server/.env.example server/.env   # then fill in the keys below
npm run dev
```

Only `ANTHROPIC_API_KEY` is needed to try the AI writing, planner, poster and video studio.
Publishing needs the platform apps below.

## Features

| Page | What it does |
|---|---|
| Autopilot | Every Friday: plans next week, writes and edits every post, makes the posters and videos, and schedules them. Posts below your quality threshold wait for approval |
| Compose | **Best version**: optional web research, then 4 drafts, then an AI editor scores them, then the best is rewritten and re-scored. Also quick variants, "Score my post" and one-click rewrites |
| Weekly plan | Goal → a full week of posts with times, formats and visual ideas |
| Posts & queue | List and calendar, an approval queue with quality scores and editor notes, retries |
| Comments & replies | AI comments (post directly to LinkedIn by URL), reply suggestions, Instagram comment inbox |
| Poster studio | AI picks the layout and copy, generates a background image, then an AI art director reviews the render and fixes it. 7 layouts, fully editable |
| Video studio | Faceless reels: AI script, then a natural voiceover, matching stock footage (or AI images), bold timed captions and optional music |
| Brand voice | Your profile plus **your best past posts**. All writing imitates them, which is the single biggest quality lever |

## Free media setup (for testing)

Everything works without these, but quality is much better with them. All are free.

| What | Setup | Without it |
|---|---|---|
| **Writing AI**: Claude or Gemini | `ANTHROPIC_API_KEY` (paid, best quality) or a free `GEMINI_API_KEY` from aistudio.google.com/apikey. With only a Gemini key, Gemini does all writing, research and reviews. Its free tier has small daily limits; when the main model runs out it switches to Flash-Lite automatically | Nothing AI works |
| **Voiceover** | Nothing. Kokoro runs locally (~90 MB model downloads on first video) | — |
| **AI images**: Cloudflare Workers AI (FLUX), then Gemini, then Pollinations | Free account at dash.cloudflare.com → Workers AI → "Use REST API". Copy your account ID and create an API token with *Workers AI* permission. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. About 170 images/day free | Falls back to Pollinations' keyless tier: watermarked, rate-limited, often fails |
| **Stock footage**: Pixabay and/or Pexels | Pixabay: sign up, then your key is shown at pixabay.com/api/docs → `PIXABAY_API_KEY`. Pexels (new keys sometimes paused): pexels.com/api → `PEXELS_API_KEY` | Reels use AI images with a slow zoom instead |

Every provider sits behind one function in `server/src/providers.js`, so moving to paid
providers later (e.g. fal.ai for AI video, ElevenLabs for voice) is a contained change.

## Connecting platforms

### LinkedIn
1. Create an app at https://www.linkedin.com/developers/apps (needs a company page to attach it to).
2. Products tab → add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**.
3. Auth tab → redirect URL `http://localhost:4000/api/accounts/linkedin/callback`.
4. Put the client ID and secret in `server/.env`, then click Connect on the Accounts page.

Tokens last 60 days; reconnect when the Accounts page says expired.
Posting comments on *other people's* posts through the API needs LinkedIn's restricted
Community Management API. Without it, use **Copy** and paste the comment in LinkedIn.

### Instagram
1. The Instagram account must be a **Business or Creator** account.
2. Create a Meta app at https://developers.facebook.com/apps → use case
   **Manage messaging & content on Instagram** (Instagram API with Instagram Login).
3. Add the permissions `instagram_business_basic`, `instagram_business_content_publish`,
   `instagram_business_manage_comments`, and add yourself as an Instagram tester.
4. Meta requires https and downloads your media from a public URL, so in development run
   `ngrok http 4000` and set **both** `SERVER_URL` and `PUBLIC_MEDIA_URL` to the ngrok URL.
   Register `<ngrok-url>/api/accounts/instagram/callback` as the redirect URL.

Instagram posts always need an image or video (it has no text-only posts).
Long-lived tokens are refreshed automatically.

## Multi-user

Anyone can sign up with email + password. Each user has their own connected LinkedIn and
Instagram accounts, brand voice, posts, plans and media, and can only see their own data.

- Passwords are hashed with scrypt; sessions are HTTP-only cookies (only a hash is stored).
- Users' LinkedIn/Instagram tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`.
- Each user gets `AI_DAILY_LIMIT` AI generations per day, so nobody can run up your Claude bill.
- Set `ALLOW_SIGNUPS=false` to close sign-ups (e.g. invite-only beta).
- Settings → Delete account removes all of a user's data (Meta requires this for app review).

## Launching publicly

### Deploy (free): Vercel frontend + Oracle Cloud backend

```
Browser → Vercel (React app) → /api, /uploads forwarded → Oracle VM: Caddy (HTTPS) → Postpilot API
```
Everything is reached through the Vercel domain, so cookies, OAuth callbacks and Instagram media URLs all use one https address.

**1. Oracle Cloud server (Always Free)**
1. Sign up at oracle.com/cloud/free (needs a card for identity verification; Always Free resources aren't charged). Pick a home region near you.
2. Compute → Instances → Create instance:
   - Image: **Canonical Ubuntu 24.04** · Shape: **Ampere VM.Standard.A1.Flex**, 2 OCPU / 12 GB (Always Free eligible).
   - Add your SSH public key (`cat ~/.ssh/id_ed25519.pub`, or let Oracle generate one and download it).
   - If you get "Out of capacity", try another availability domain or retry later.
3. Open the web ports: Instance → Subnet → Default security list → **Add ingress rules** for TCP **80** and **443**, source `0.0.0.0/0`.
4. Note the instance's **public IP**.

**2. Free domain with HTTPS**: at duckdns.org, sign in, create a subdomain (e.g. `postpilot-api`) and set it to the server's public IP.

**3. Install on the server**
```bash
ssh ubuntu@<public-ip>
git clone https://github.com/adarshh-s/social-media-agent.git && cd social-media-agent
bash deploy/setup.sh postpilot-api.duckdns.org   # creates server/.env with a fresh encryption key
nano server/.env      # add API keys; SERVER_URL and CLIENT_URL = https://<your-app>.vercel.app
cd deploy && sudo docker compose up -d --build
```
Check: `https://postpilot-api.duckdns.org/api/auth/me` returns `{"error":"Not logged in"}`.
Update later with `git pull && cd deploy && sudo docker compose up -d --build`.

**4. Vercel**: set the DuckDNS domain in `vercel.json` (replace `BACKEND_DOMAIN`), then `vercel deploy --prod`.
Use `https://<your-app>.vercel.app/api/accounts/linkedin/callback` (and `/instagram/callback`) as the OAuth redirect URLs.

**Without Docker** (any server with Node 22.13+ and ffmpeg): `npm run setup && npm run build && npm start` serves the API and the web app from one process.

### LinkedIn: works for everyone right away
"Sign In with LinkedIn" and "Share on LinkedIn" are self-serve, so any LinkedIn member can connect
and publish with no review. Add your production callback URL in the app's Auth tab.
Commenting on other people's posts and posting as company pages need the
**Community Management API**, which you have to apply for separately.

### Instagram: needs Meta App Review
Until the app is approved, only people you add as testers in the Meta dashboard can connect.
To open it to everyone:
1. Complete **Business Verification** in Meta Business Manager.
2. Publish a privacy policy and terms of service, and add their URLs to the app. For the
   data-deletion URL, point to a page explaining Settings → Delete account.
3. Request **Advanced Access** for `instagram_business_basic`, `instagram_business_content_publish`
   and `instagram_business_manage_comments`. Each one needs a screen recording of the feature using it
   (connecting, publishing a post, replying to a comment).
4. Switch the app to **Live** mode.

### When you outgrow one server
Move to Postgres, put media in S3/R2, and run the scheduler as a separate worker with a job queue
(e.g. BullMQ). All of this is isolated in `db.js`, `media.js` and `publisher.js`.
