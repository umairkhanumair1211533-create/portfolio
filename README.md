# Umair Khan — Portfolio + AI Voice Assistant

Static portfolio (HTML / CSS / JS) with a secure Groq-powered voice assistant.
The backend hosts the site **and** the `/api/voice/*` endpoints, so nothing ever
needs `localhost` in production.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css`, `script.js` | Existing portfolio (no sections removed or redesigned) |
| `voice-agent.css`, `voice-agent.js` | Voice assistant UI (launcher, chat/voice panel, states) |
| `server/index.js` | **Backend entry point** — Express app, static hosting, API routes |
| `server/lib/groq.js` | Official `groq-sdk` client (chat, transcription, text-to-speech) |
| `server/knowledge.js` | Portfolio knowledge base — the only facts the assistant may state |
| `server/lib/` | Validation, rate limiting, security headers, safe error mapping |
| `.env` | Secrets (gitignored) · `.env.example` | Template |
| `package.json` | `npm start` / `npm run dev` scripts |

## Local setup

```bash
npm install
# open .env and replace the placeholder with your real Groq API key
npm run dev        # auto-restart on changes (node --watch)
# or
npm start          # plain start
```

Then open **http://localhost:3000** (or the port printed in the terminal).

> **Using VS Code Live Server (port 5500)?** Live Server is static-only, so `POST` to
> it returns `405`. Keep `npm start` running: `index.html` auto-points API calls at
> `http://127.0.0.1:3000` when the page is on port `5500`, and `.env` already allows
> that origin in `ALLOWED_ORIGINS`. Opening **http://localhost:3000** directly needs
> no extra setup.

### Restarting the backend

- **Local:** stop the process with `Ctrl+C`, then run `npm start` again.
  With `npm run dev` the server restarts itself whenever files in `server/` change.
- **Railway:** Dashboard → your service → **⋯ → Restart**, or push a commit /
  use **Deploy**. Environment variables live under **Variables**.

## Environment variables (`.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | **Yes** | – | Groq API key from <https://console.groq.com/keys>. Server-side only — never sent to the browser. |
| `PORT` | No | `3000` | HTTP port (Railway injects its own `PORT`). |
| `ALLOWED_ORIGINS` | No | empty | Comma-separated origins allowed by CORS — only needed if the site is hosted somewhere other than this server. |
| `GROQ_CHAT_MODEL` | No | `openai/gpt-oss-120b` | Answer model (falls back to `openai/gpt-oss-20b`, `llama-3.3-70b-versatile`). |
| `GROQ_STT_MODEL` | No | `whisper-large-v3-turbo` | Speech-to-text model. |
| `GROQ_TTS_MODEL` | No | `canopylabs/orpheus-v1-english` | Text-to-speech model. |
| `GROQ_TTS_VOICE` | No | `troy` | Orpheus voice (`troy`, `hannah`, `austin`, `daniel`, `autumn`, `diana`). |
| `VOICE_TTS` | No | `groq` | `groq` = server TTS with automatic browser fallback · `browser` = Web Speech synthesis only · `silent` = text only. |

**Missing/placeholder key:** the server still runs, voice endpoints answer
`503 not_configured` with a generic message — the key value is never echoed in
responses or logs.

## API endpoints

| Method | Route | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/voice/ask` | `{ message, history? }` | `{ ok, reply, tts }` |
| `POST` | `/api/voice/transcribe` | multipart `audio` (≤ 6 MB) | `{ ok, text }` |
| `POST` | `/api/voice/speak` | `{ text }` (≤ 900 chars) | `{ ok, provider, format, audio[] }` (base64 WAV) |
| `GET` | `/api/health` | – | `{ ok, service, tts }` |

Security: per-IP rate limiting (ask 12/min, transcribe 8/min, speak 6/min),
body/file size limits, strict input validation, allow-listed file types,
sanitized error responses, `.env`/`server/`/`node_modules/` blocked from the
static server, no secrets in logs or responses.

## Keeping answers truthful

`server/knowledge.js` contains only facts that appear on the website (skills,
education, projects, contact links). The prompt instructs the model to say
information isn't listed when it isn't — no invented experience or clients.

## Deploying to Railway (production)

1. Push this folder to GitHub (`.env` is gitignored — confirm with `git status`).
2. Railway → **New Project** → deploy the repo (Root Directory = repo root).
3. **Variables** → add `GROQ_API_KEY=your_real_key` (plus any optional vars above).
4. **Start command:** `npm start` (Railway supplies `PORT`).
5. Your site is then served from `https://<service>.up.railway.app` — the
   frontend calls the API on the same origin, so **no localhost is used**.
6. Only if you host the static site separately: set
   `window.VOICE_API_BASE = "https://<service>.up.railway.app"` in `index.html`
   before `voice-agent.js`, and set `ALLOWED_ORIGINS` on Railway.

## Verification performed

- **API suite — 26/26 passed:** static hosting, blocked secret/server files,
  validation (400/413/415), rate limiting (429), safe 503 with placeholder key,
  no key material in responses, security headers.
- **Browser suite — 33/33 passed (Chrome):** open/close (button, ✕, Esc),
  greeting, typed questions, listening → processing → speaking → idle states,
  stop-speaking and mute controls, error state + Retry, microphone permission
  denied (typed chat still works), privacy notice, dark theme, mobile 390×844
  layout, no console/page errors.

Voice requests are only made to the same origin (or `VOICE_API_BASE`); no API
key ever appears in HTML, CSS, JavaScript, or the repository.
