import { HttpError } from "./errors.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=()");
  next();
}

// Cross-origin API access only when the site is hosted separately from this
// server and an allow-list has been configured. Same-origin needs no CORS.
export function cors(req, res, next) {
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const origin = req.headers.origin;

  if (origin && allowed.includes(origin.replace(/\/$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}

// Small in-memory sliding-window limiter (per client IP).
const stores = new Map();

export function rateLimit({ name, windowMs, max }) {
  if (!stores.has(name)) stores.set(name, new Map());

  const timer = setInterval(() => {
    const store = stores.get(name);
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.start >= windowMs) store.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  timer.unref?.();

  return (req, res, next) => {
    const store = stores.get(name);
    const key = clientIp(req);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      store.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
      return next(
        new HttpError(
          429,
          "rate_limited",
          "Too many requests. Please wait a moment and try again."
        )
      );
    }
    next();
  };
}

export function notFoundHandler(req, res) {
  const url = req.originalUrl || req.url || "";
  if (url.startsWith("/api/")) {
    return res
      .status(404)
      .json({ ok: false, error: { code: "not_found", message: "Unknown endpoint." } });
  }
  res.status(404).type("text/plain").send("Not found");
}

// Final error boundary. Responses carry safe messages only; logs never include
// request bodies, headers, or credentials.
export function errorHandler(err, _req, res, _next) {
  const status =
    typeof err?.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  const code = err?.code || (status === 500 ? "server_error" : "error");
  const message =
    err instanceof HttpError
      ? err.message
      : status === 413
        ? "Payload too large."
        : status === 400
          ? "Invalid request."
          : "Something went wrong. Please try again.";

  if (status >= 500) {
    console.error(
      `[voice] ${status} ${err?.name || "Error"}: ${String(err?.message || "")
        .slice(0, 200)}`
    );
  }
  if (!res.headersSent) {
    res.status(status).json({ ok: false, error: { code, message } });
  }
}
