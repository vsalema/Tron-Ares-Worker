// Cloudflare Worker: tronapp-subproxy
// Routes:
//   GET  /                      -> health/info
//   GET  /search?query=...&languages=fr,en[&page=1]  -> OpenSubtitles subtitles search
//   POST /download              -> returns {link,file_name,...} from OpenSubtitles /download
//   GET  /download-file?file_id=12345[&sub_format=srt] -> fetches and returns the subtitle file content (CORS-friendly)
//
// Required secrets/vars in Cloudflare:
//   OS_API_KEY   (secret)  - your OpenSubtitles API key
//   OS_USERNAME  (secret)  - your OpenSubtitles username or email
//   OS_PASSWORD  (secret)  - your OpenSubtitles password
// Optional vars:
//   OS_APP_UA    (var)     - e.g. "tronapp v1.0.0"
//   OS_API_BASE  (var)     - default "https://api.opensubtitles.com/api/v1"

const DEFAULT_BASE = "https://api.opensubtitles.com/api/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,Api-Key,X-User-Agent,User-Agent",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { ...init, headers });
}

// In-memory token cache (per isolate)
let cachedToken = null;
let cachedTokenExpMs = 0;

function getEnvOrThrow(env, key) {
  const val = env[key];
  if (!val || (typeof val === "string" && val.trim() === "")) {
    throw new Error(`Missing env var/secret: ${key}`);
  }
  return val;
}

async function osFetch(env, path, init = {}) {
  const base = (env.OS_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  headers.set("Api-Key", getEnvOrThrow(env, "OS_API_KEY"));

  const ua = env.OS_APP_UA || "tronapp v1.0.0";
  headers.set("User-Agent", ua);
  headers.set("X-User-Agent", ua);

  return fetch(url, { ...init, headers });
}

async function login(env) {
  const now = Date.now();
  if (cachedToken && cachedTokenExpMs - now > 60_000) return cachedToken;

  const username = getEnvOrThrow(env, "OS_USERNAME");
  const password = getEnvOrThrow(env, "OS_PASSWORD");

  const resp = await osFetch(env, "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const txt = await resp.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = null; }

  if (!resp.ok || !json?.token) {
    throw new Error(`OpenSubtitles login failed (${resp.status}): ${txt}`);
  }

  cachedToken = json.token;
  cachedTokenExpMs = now + 10 * 60_000; // cache 10 minutes
  return cachedToken;
}

async function handleSearch(req, env) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") || "").trim();
  const languages = (searchParams.get("languages") || "").trim();
  const page = (searchParams.get("page") || "1").trim();

  if (!query) return jsonResponse({ error: "Missing query" }, { status: 400 });

  const params = new URLSearchParams();
  params.set("query", query);
  if (languages) params.set("languages", languages);
  if (page) params.set("page", page);

  const resp = await osFetch(env, `/subtitles?${params.toString()}`, { method: "GET" });
  const txt = await resp.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return jsonResponse(data, { status: resp.status });
}

async function handleDownload(req, env) {
  const body = await req.json().catch(() => null);
  const file_id = body?.file_id;
  const sub_format = body?.sub_format;

  if (!file_id) return jsonResponse({ error: "Missing file_id" }, { status: 400 });

  const token = await login(env);

  const payload = { file_id: Number(file_id) };
  if (sub_format) payload.sub_format = sub_format;

  const resp = await osFetch(env, "/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const txt = await resp.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return jsonResponse(data, { status: resp.status });
}

async function handleDownloadFile(req, env) {
  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("file_id");
  const legacyUrl = searchParams.get("url");
  const subFormat = searchParams.get("sub_format") || searchParams.get("format") || "srt";

  // Compat: ancien mode "url=" (on télécharge direct le lien pré-signé)
  if (!fileId && legacyUrl) {
    const target = decodeURIComponent(legacyUrl);
    const fileResp = await fetch(target, { method: "GET" });
    const headers = new Headers(fileResp.headers);
    if (!headers.get("Content-Type")) headers.set("Content-Type", "text/plain; charset=utf-8");
    headers.set("Content-Disposition", `attachment; filename="subtitle.${subFormat}"`);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(fileResp.body, { status: fileResp.status, headers });
  }

  if (!fileId) return jsonResponse({ error: "Missing file_id" }, { status: 400 });

  const token = await login(env);

  const dlResp = await osFetch(env, "/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ file_id: Number(fileId), sub_format: subFormat }),
  });

  const dlTxt = await dlResp.text();
  let dlJson;
  try { dlJson = JSON.parse(dlTxt); } catch { dlJson = null; }

  if (!dlResp.ok || !dlJson?.link) {
    return jsonResponse(
      { error: "OpenSubtitles download failed", status: dlResp.status, body: dlTxt },
      { status: dlResp.status || 500 }
    );
  }

  const fileResp = await fetch(dlJson.link, { method: "GET" });

  const headers = new Headers(fileResp.headers);
  if (!headers.get("Content-Type")) headers.set("Content-Type", "text/plain; charset=utf-8");

  const filename = (dlJson.file_name || `subtitle.${subFormat}`).replace(/"/g, "");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);

  return new Response(fileResp.body, { status: fileResp.status, headers });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (req.method === "GET" && path === "/") {
        return jsonResponse({ ok: true, routes: ["/search", "/download", "/download-file", "/health"] });
      }
      if (req.method === "GET" && path === "/health") {
        return jsonResponse({ ok: true, service: "tronapp-opensub-proxy", now: new Date().toISOString() });
      }
      if (req.method === "GET" && path === "/search") return await handleSearch(req, env);
      if (req.method === "POST" && path === "/download") return await handleDownload(req, env);
      if (req.method === "GET" && path === "/download-file") return await handleDownloadFile(req, env);

      return jsonResponse({ error: "Not Found", path }, { status: 404 });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, { status: 500 });
    }
  },
};
