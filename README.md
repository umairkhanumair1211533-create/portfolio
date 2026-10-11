# Umair Khan — Portfolio + AI Voice Assistant

Static portfolio (HTML / CSS / JS) with a secure Groq-powered voice assistant.
The backend hosts the frontend **and** the `/api/voice/*` endpoints, so nothing
ever needs `localhost` in production.

## Project structure

```
fortfolio/
├── frontend/                 # Everything the browser loads
│   ├── index.html            # Portfolio page + voice assistant panel
│   ├── project-detail.html   # Project deep-link redirect page
│   ├── css/                  # style.css, voice-agent.css
│   ├── js/                   # script.js, projects-data.js, project-detail.js, voice-agent.js
│   ├── images/               # Portraits, project screenshots
│   └── assets/               # Reserved for fonts/icons
├── backend/                  # Node.js / Express — never served to browsers
│   ├── index.js              # Entry point — app setup, static hosting, listen
│   ├── routes/voice.js       # /api/health + /api/voice/* routes (rate limits, upload)
│   ├── controllers/voiceController.js  # Request handlers
│   ├── middleware/           # CORS, rate limiting, security headers, errors
│   ├── lib/                  # Groq SDK wrapper, input validation
│   ├── config/env.js         # Loads backend/.env, exports PORT
│   ├── knowledge.js          # Portfolio knowledge base (assistant's only facts)
│   ├── package.json          # npm start / npm run dev
│   ├── .env                  # Secrets (gitignored)
│   └── .env.example          # Template
├── .gitignore
└── README.md
```

## Local setup

```bash
cd backend
npm install
# open backend/.env and replace the placeholder with your real Groq API key
npm run dev        # auto-restart on changes (node --watch)
# or
npm start          # plain start
```

Then open **http://localhost:3000** (or the port printed in the terminal). The
server serves `frontend/` and the API from the same origin.

### Running the frontend alone

The frontend is plain static HTML/CSS/JS — no build step. You can open it with
any static server (e.g. VS Code Live Server) from the `frontend/` folder, but
the voice agent needs the backend for transcription and AI replies.

> **Using VS Code Live Server (port 5500)?** Live Server is static-only, so `POST` to
> it returns `405`. Keep `npm run dev` running in `backend/`: `frontend/index.html`
> auto-points API calls at `http://127.0.0.1:3000` when the page is on port `5500`,
> and `backend/.env` already allows that origin in `ALLOWED_ORIGINS`. Opening
> **http://localhost:3000** directly needs no extra setup.

### Restarting the backend

- **Local:** stop the process with `Ctrl+C`, then run `npm start` again (from `backend/`).
  With `npm run dev` the server restarts itself whenever backend files change.
- **Railway:** Dashboard → your service → **⋯ → Restart**, or push a commit /
  use **Deploy**. Environment variables live under **Variables**.

## Environment variables (`backend/.env`)

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
sanitized error responses, `backend/`/`.env`/`node_modules/` blocked from the
static server, no secrets in logs or responses.

## Keeping answers truthful

`backend/knowledge.js` contains only facts that appear on the website (skills,
education, projects, contact links). The prompt instructs the model to say
information isn't listed when it isn't — no invented experience or clients.

## Deploying to Railway (production)

1. Push this folder to GitHub (`.env` is gitignored — confirm with `git status`).
2. Railway → **New Project** → deploy the repo.
3. **Root Directory:** `backend` (Railway runs `npm start` inside it).
4. **Variables** → add `GROQ_API_KEY=your_real_key` (plus any optional vars above).
5. **Start command:** `npm start` (Railway supplies `PORT`).
6. Your site is then served from `https://<service>.up.railway.app` — the
   frontend calls the API on the same origin, so **no localhost is used**.
7. Only if you host the static site separately: set
   `window.VOICE_API_BASE = "https://<service>.up.railway.app"` in
   `frontend/index.html` before `voice-agent.js`, and set `ALLOWED_ORIGINS` on
   Railway.

## Verification performed

- **Structure:** all browser assets in `frontend/` (html, css, js, images);
  all server code, `.env`, and `node_modules` in `backend/`. No duplicates —
  files were moved with `git mv` (history preserved).
- **Backend:** starts with `node backend/index.js`, loads `backend/.env`.
  `/api/health` → 200; `POST /api/voice/ask` with empty body → 400
  `invalid_request`; unknown `/api/*` → JSON 404.
- **Static hosting:** `/`, both HTML pages, both stylesheets, all four scripts,
  and every image path (including `images/projects/*`) return 200.
- **Security:** `/backend/*`, `/.env`, `/node_modules/*`, `/package.json`
  return 404; SPA fallback serves `index.html` for unknown paths.

Voice requests are only made to the same origin (or `VOICE_API_BASE`); no API
key ever appears in HTML, CSS, JavaScript, or the repository.
