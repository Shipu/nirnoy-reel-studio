# Nirnoy Reel Studio

Browser-এ MCQ reel (1080×1920 MP4) বানানোর ছোট tool। Cloudflare Worker-এ চলে, কোনো AI token লাগে না।

```
Browser (আপনার Chrome)
  │  Cloudflare Access login (শুধু আপনার email)
  ▼
Cloudflare Worker  ── /api/* ──►  nirnoy-api  /api/v1/reel/questions/{random|id}
  │  static UI (dist/)             header: X-Reel-Key (Worker secret, browser কখনো দেখে না)
  │  D1: reels (কোন প্রশ্নের reel হয়েছে)
  ▼
Remotion Player (preview) + @remotion/web-renderer (MP4 render, browser-এই)
```

## Local-এ চালানো

```bash
npm install
cp .dev.vars.example .dev.vars        # REEL_API_KEY বসান
npm run db:migrate:local
npm run build
npx wrangler dev --var NIRNOY_API_BASE:https://<stage-api-url>
# http://localhost:8787
```

## Deploy (প্রথমবার)

```bash
npx wrangler login
npx wrangler d1 create nirnoy-reel-studio      # database_id → wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put REEL_API_KEY            # Laravel-এর REEL_API_KEY-এর মতো একই মান
npm run deploy
```

তারপর Cloudflare Zero Trust → Access → Applications → Self-hosted:
`nirnoy-reel-studio.<subdomain>.workers.dev` রক্ষা করুন, policy: শুধু আপনার email।
Application-এর **AUD tag** আর team domain `wrangler.jsonc`-এর `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN`-এ বসিয়ে আবার `npm run deploy`।
Access ঠিক না থাকলে Worker সব `/api` request 401 দেয় (fail closed)।

## Bangla voice-over

Studio পুরো reel-এর narration (প্রশ্ন, অপশন, চিন্তা করুন, উত্তর, ব্যাখ্যা, শেষ কথা) বাংলায় বানায়।
একই লেখা + কণ্ঠ + model আবার চাইলে Cloudflare cache থেকে আসে, নতুন credit খরচ হয় না।

### ElevenLabs

- Model: **`eleven_v3`** — ElevenLabs-এ বাংলা শুধু এই model-এ (`ELEVENLABS_MODEL` var দিয়ে বদলানো যায়)।
- কণ্ঠ: `worker/index.ts`-এর `ELEVENLABS_VOICES` (Syed, Rakib, Rayhan, Swati S — Voice Library-র বাংলা কণ্ঠ)।
  প্রতিটা কণ্ঠ আগে ElevenLabs-এ Voice Library → **Add to My Voices** করে নিন, না হলে 404 আসবে।
- Key: ElevenLabs → Settings → API Keys → নতুন key (শুধু Text to Speech permission দিলেই যথেষ্ট), তারপর
  `npx wrangler secret put ELEVENLABS_API_KEY`
- **Free plan-এ commercial license নেই** — test-এর জন্য ঠিক আছে, reel post করার আগে paid plan লাগবে।
- `eleven_v3`-এ speed setting নেই; "ধীর" বাছলে লেখার শুরুতে `[slowly]` tag যায়।

ElevenLabs ছাড়াও studio-তে প্রতিটা ধাপে "রেকর্ড" দিয়ে নিজের audio দেওয়া যায়।

## Template বদলানো

`src/remotion/MCQReel.tsx`: রং ও লোগো `nirnoy.pen` থেকে নেওয়া। লেখা লম্বা হলে ফন্ট নিজে ছোট হয় (`fit()`),
আর প্রতিটা ধাপের সময় `src/remotion/types.ts`-এর `timeline()` ঠিক করে:

প্রশ্ন (voice) → অপশন আসে (voice পড়ে) → "এবার চিন্তা করুন" (voice) → ৬ সেকেন্ড countdown →
সঠিক উত্তর (voice) → ব্যাখ্যা (থাকলে, voice) → শেষ পর্দা (voice: nirnoy.app)

প্রতিটা ধাপ ততক্ষণ চলে যতক্ষণ তার voice; voice না থাকলে পড়ার আন্দাজি সময় নেয়।
