import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import {
  HttpError,
  badRequest,
  notConfigured,
  tooLarge,
} from "./lib/errors.js";
import {
  asyncHandler,
  cors,
  errorHandler,
  notFoundHandler,
  rateLimit,
  securityHeaders,
} from "./lib/middleware.js";
import {
  createReply,
  isConfigured,
  speechMode,
  synthesizeSpeech,
  transcribeAudio,
} from "./lib/groq.js";
import {
  audioFilename,
  fileFilter,
  splitForTts,
  validateAsk,
  validateLanguage,
  validateSpeak,
  MAX_AUDIO_BYTES,
} from "./lib/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Backend secrets live in the repo-root .env (gitignored). Never expose them.
dotenv.config({ path: path.join(ROOT, ".env") });

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const jsonBody = (limit) => express.json({ limit, type: "application/json" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 4 },
  fileFilter,
});

function uploadAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(tooLarge("That recording is too large (maximum 6 MB)."));
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return next(badRequest("Send exactly one audio recording."));
    }
    if (err instanceof HttpError) return next(err);
    next(badRequest("The recording could not be read."));
  });
}

app.use(securityHeaders);
app.use(cors);

// Never expose repo/server files through the static server.
const BLOCKED_PATHS = [
  /^\/server(\/|$)/i,
  /^\/node_modules(\/|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/package(-lock)?\.json$/i,
  /^\/(\.env|\.env\..*|\.gitignore|\.gitattributes)$/i,
];
app.use((req, res, next) => {
  if (req.path !== "/" && BLOCKED_PATHS.some((pattern) => pattern.test(req.path))) {
    return res.status(404).end();
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "portfolio-voice-api", tts: speechMode() });
});

app.use("/api", rateLimit({ name: "api-all", windowMs: 60_000, max: 90 }));

// ---------------------------------------------------------------------------
// Voice assistant endpoints (all provider credentials stay on this server)
// ---------------------------------------------------------------------------

app.post(
  "/api/voice/ask",
  jsonBody("48kb"),
  rateLimit({ name: "ask", windowMs: 60_000, max: 12 }),
  asyncHandler(async (req, res) => {
    const { message, history } = validateAsk(req.body);
    const reply = await createReply({ message, history });
    res.json({ ok: true, reply, tts: speechMode() });
  })
);

app.post(
  "/api/voice/transcribe",
  rateLimit({ name: "transcribe", windowMs: 60_000, max: 8 }),
  uploadAudio,
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("An audio recording is required.");
    const language = validateLanguage(req.body?.language);
    const text = await transcribeAudio({
      buffer: req.file.buffer,
      filename: audioFilename(req.file.originalname, req.file.mimetype),
      contentType: req.file.mimetype,
      language,
    });
    res.json({ ok: true, text });
  })
);

app.post(
  "/api/voice/speak",
  jsonBody("16kb"),
  rateLimit({ name: "speak", windowMs: 60_000, max: 6 }),
  asyncHandler(async (req, res) => {
    if (speechMode() !== "groq") {
      throw new HttpError(503, "tts_unavailable", "Server text-to-speech is off.");
    }
    const { text } = validateSpeak(req.body);
    const chunks = splitForTts(text, 190);
    if (!chunks.length) throw badRequest("Text is required.");

    const audio = [];
    for (const chunk of chunks) {
      const wav = await synthesizeSpeech(chunk);
      audio.push(wav.toString("base64"));
    }
    res.json({ ok: true, provider: "groq", format: "wav", audio });
  })
);

app.use("/api", notFoundHandler);

// ---------------------------------------------------------------------------
// Static portfolio hosting (same service in dev and production)
// ---------------------------------------------------------------------------
app.use(
  express.static(ROOT, {
    dotfiles: "deny",
    index: false,
    etag: true,
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);

app.get("*", (req, res, next) => {
  if (req.accepts("html")) {
    return res.sendFile(path.join(ROOT, "index.html"));
  }
  next();
});

app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  if (!isConfigured()) {
    console.warn(
      "[voice] GROQ_API_KEY is missing or still a placeholder — voice endpoints return 503 until a real key is set in .env"
    );
  }
  console.log(`Portfolio server running at http://localhost:${port}`);
});

export default app;
