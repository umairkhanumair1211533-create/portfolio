import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { PORT } from "./config/env.js";
import {
  cors,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from "./middleware/index.js";
import { isConfigured } from "./lib/groq.js";
import apiRouter from "./routes/voice.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The browser app lives in frontend/ — this server hosts it and the /api routes.
const FRONTEND_DIR = path.resolve(__dirname, "..", "frontend");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(securityHeaders);
app.use(cors);

// Never expose backend files through the static server.
const BLOCKED_PATHS = [
  /^\/backend(\/|$)/i,
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

app.use("/api", apiRouter);

// ---------------------------------------------------------------------------
// Static portfolio hosting (same service in dev and production)
// ---------------------------------------------------------------------------
app.use(
  express.static(FRONTEND_DIR, {
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
    return res.sendFile(path.join(FRONTEND_DIR, "index.html"));
  }
  next();
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  if (!isConfigured()) {
    console.warn(
      "[voice] GROQ_API_KEY is missing or still a placeholder — voice endpoints return 503 until a real key is set in backend/.env"
    );
  }
  console.log(`Portfolio server running at http://localhost:${PORT}`);
  console.log(`Serving frontend from ${FRONTEND_DIR}`);
});

export default app;
