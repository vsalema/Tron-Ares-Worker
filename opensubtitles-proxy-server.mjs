/**
 * OpenSubtitles backend proxy (sans dépendances)
 *
 * Objectif:
 * - Éviter les erreurs CORS dans le navigateur (préflights OPTIONS bloqués / 429).
 * - Protéger ta clé API et tes identifiants (ils restent côté serveur).
 * - Centraliser le token et limiter /login (1 req/sec max).
 *
 * Usage:
 * 1) Node.js >= 18
 * 2) Variables d'environnement:
 *    OS_API_KEY      (obligatoire)
 *    OS_USERNAME     (obligatoire si tu veux /download)
 *    OS_PASSWORD     (obligatoire si tu veux /download)
 *    OS_USER_AGENT   (optionnel, ex: "TronAresSub v1.0.0")
 *    OS_API_BASE     (optionnel, défaut: https://api.opensubtitles.com/api/v1)
 *    PORT            (optionnel, défaut: 8787)
 *
 * 3) Lancer:
 *    OS_API_KEY="..." OS_USERNAME="..." OS_PASSWORD="..." node opensubtitles-proxy-server.mjs
 *
 * Endpoints:
 *  - GET  /os/subtitles?query=...&languages=fr,en&tmdb_id=...&page=1
 *  - POST /os/download   { "file_id": 123, "sub_format": "srt" }  -> renvoie le texte (SRT/VTT)
 *
 * CORS:
 *  - Autorise * (pratique en dev). Si tu veux restreindre, remplace "*" par ton origin.
 */

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const OS_API_BASE = (process.env.OS_API_BASE || "https://api.opensubtitles.com/api/v1").replace(/\/+$/, "");
const OS_API_KEY = (process.env.OS_API_KEY || "").trim();
const OS_USERNAME = (process.env.OS_USERNAME || "").trim();
const OS_PASSWORD = (process.env.OS_PASSWORD || "");
const OS_USER_AGENT = (process.env.OS_USER_AGENT || "TronAresSub v1.0.0").trim();

if (!OS_API_KEY) {
  console.error("❌ OS_API_KEY manquant.");
  process.exit(1);
}

let cachedToken = null;        // string
let tokenSetAtMs = 0;          // number
let loginInFlight = null;      // Promise<string> | null
let lastLoginAtMs = 0;         // number

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJson(res, status, obj) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function sendText(res, status, txt) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(txt);
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function osHeaders({ authToken } = {}) {
  const h = {
    "Accept": "application/json",
    "Api-Key": OS_API_KEY,
    "X-User-Agent": OS_USER_AGENT,
  };
  if (authToken) h["Authorization"] = `Bearer ${authToken}`;
  return h;
}

async function osFetch(path, init = {}) {
  const url = OS_API_BASE + (path.startsWith("/") ? path : ("/" + path));
  const res = await fetch(url, init);
  const txt = await res.text().catch(() => "");
  let json = null;
  try { json = JSON.parse(txt); } catch { json = null; }
  return { res, txt, json };
}

async function osLogin() {
  if (!OS_USERNAME || !OS_PASSWORD) {
    throw new Error("OS_USERNAME/OS_PASSWORD manquants (nécessaires pour /download).");
  }

  // Réutilise un token "récent" (durée conservative: 8h)
  const ageMs = Date.now() - tokenSetAtMs;
  if (cachedToken && ageMs < 8 * 60 * 60 * 1000) return cachedToken;

  if (loginInFlight) return await loginInFlight;

  loginInFlight = (async () => {
    // Respect 1 req/sec (best practice)
    const now = Date.now();
    const delta = now - lastLoginAtMs;
    if (delta < 1100) await new Promise(r => setTimeout(r, 1100 - delta));
    lastLoginAtMs = Date.now();

    const payload = JSON.stringify({ username: OS_USERNAME, password: OS_PASSWORD });
    const { res, txt, json } = await osFetch("/login", {
      method: "POST",
      headers: { ...osHeaders(), "Content-Type": "application/json" },
      body: payload,
    });

    if (!res.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : (txt || "");
      const err = new Error(`Login OpenSubtitles (${res.status}): ${msg}`);
      err.status = res.status;
      throw err;
    }

    const token = json && (json.token || json.data?.token);
    if (!token) throw new Error("Login OpenSubtitles: token absent dans la réponse.");
    cachedToken = String(token);
    tokenSetAtMs = Date.now();
    return cachedToken;
  })().finally(() => {
    loginInFlight = null;
  });

  return await loginInFlight;
}

async function handleSubtitles(reqUrl, res) {
  const qs = reqUrl.searchParams.toString();
  const { res: osRes, txt, json } = await osFetch("/subtitles" + (qs ? "?" + qs : ""), {
    method: "GET",
    headers: osHeaders(),
  });

  // Propage un message utile si présent
  const osMsg = osRes.headers.get("X-OpenSubtitles-Message");
  if (osMsg && json && typeof json === "object") json.__osMessage = osMsg;

  if (!osRes.ok) {
    const msg = (json && (json.message || json.error)) ? (json.message || json.error) : (txt || "");
    return sendJson(res, osRes.status, { error: msg || "OpenSubtitles error" });
  }

  setCors(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(json || {}));
}

async function handleDownload(req, res) {
  const bodyTxt = await readBody(req);
  let body;
  try { body = JSON.parse(bodyTxt || "{}"); } catch { body = {}; }

  const fileId = Number(body.file_id);
  const subFormat = String(body.sub_format || "srt");

  if (!Number.isFinite(fileId) || fileId <= 0) {
    return sendJson(res, 400, { error: "file_id invalide" });
  }

  let token = await osLogin();

  // 1) obtenir un lien de téléchargement
  let out = await osFetch("/download", {
    method: "POST",
    headers: { ...osHeaders({ authToken: token }), "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, sub_format: subFormat }),
  });

  // Si token expiré, retente 1 fois
  if (out.res.status === 401) {
    cachedToken = null;
    tokenSetAtMs = 0;
    token = await osLogin();
    out = await osFetch("/download", {
      method: "POST",
      headers: { ...osHeaders({ authToken: token }), "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, sub_format: subFormat }),
    });
  }

  if (!out.res.ok || !out.json || !out.json.link) {
    const msg = (out.json && (out.json.message || out.json.error)) ? (out.json.message || out.json.error) : (out.txt || "");
    return sendJson(res, out.res.status || 500, { error: msg || "OpenSubtitles download error" });
  }

  // 2) télécharger le fichier via le lien
  const link = String(out.json.link);
  const fileRes = await fetch(link, { method: "GET" });
  if (!fileRes.ok) {
    const t = await fileRes.text().catch(() => "");
    return sendJson(res, fileRes.status, { error: t || "Téléchargement du fichier échoué" });
  }
  const subtitleTxt = await fileRes.text();

  // Renvoie le texte brut (le front le convertit en VTT si besoin)
  sendText(res, 200, subtitleTxt);
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Préflight CORS
    if (req.method === "OPTIONS") {
      setCors(res);
      res.statusCode = 204;
      return res.end();
    }

    if (reqUrl.pathname === "/os/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (reqUrl.pathname === "/os/subtitles" && req.method === "GET") {
      return await handleSubtitles(reqUrl, res);
    }

    if (reqUrl.pathname === "/os/download" && req.method === "POST") {
      return await handleDownload(req, res);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: e && e.message ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`✅ OpenSubtitles proxy prêt: http://localhost:${PORT}/os/health`);
});
