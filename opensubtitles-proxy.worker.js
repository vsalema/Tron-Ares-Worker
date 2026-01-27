/**
 * Cloudflare Worker - OpenSubtitles proxy (CORS-friendly) for GitHub Pages
 *
 * Required secrets / vars (Workers -> Settings -> Variables):
 * - OS_API_KEY          (mandatory)
 * - OS_APP_UA           ex: "TronAresSubProxy v1.0.0" (mandatory)
 *
 * Optional (recommended for /download):
 * - OS_USERNAME
 * - OS_PASSWORD
 *
 * Endpoints:
 * - GET  /search?query=...&languages=fr,en&tmdb_id=...&imdb_id=...&season_number=...&episode_number=...
 * - GET  /download-file?file_id=12345&format=srt
 *
 * Notes:
 * - OpenSubtitles REST API is https://api.opensubtitles.com/api/v1/...
 * - We add CORS headers so the browser can call this from your GitHub Pages site.
 */

const OS_API_BASE = "https://api.opensubtitles.com/api/v1";

let cachedToken = null;
let tokenExpMs = 0;

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

async function ensureToken(env) {
  const now = Date.now();
  if (cachedToken && tokenExpMs - now > 60_000) return cachedToken;

  if (!env.OS_USERNAME || !env.OS_PASSWORD) return null;

  const res = await fetch(OS_API_BASE + "/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Api-Key": env.OS_API_KEY,
      "User-Agent": env.OS_APP_UA,
    },
    body: JSON.stringify({
      username: env.OS_USERNAME,
      password: env.OS_PASSWORD,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.message) ? data.message : ("Login failed (" + res.status + ")"));
  }

  cachedToken = data && data.token ? data.token : null;
  // token is JWT; simplest: cache for 12h (or until error)
  tokenExpMs = now + 12 * 60 * 60 * 1000;
  return cachedToken;
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj.get(k);
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/search" && request.method === "GET") {
        const query = pick(url.searchParams, ["query"]);
        const languages = pick(url.searchParams, ["languages", "langs"]);
        const tmdb_id = pick(url.searchParams, ["tmdb_id"]);
        const imdb_id = pick(url.searchParams, ["imdb_id"]);
        const season_number = pick(url.searchParams, ["season_number"]);
        const episode_number = pick(url.searchParams, ["episode_number"]);

        const apiUrl = new URL(OS_API_BASE + "/subtitles");
        if (query) apiUrl.searchParams.set("query", query);
        if (languages) apiUrl.searchParams.set("languages", languages);
        if (tmdb_id) apiUrl.searchParams.set("tmdb_id", tmdb_id);
        if (imdb_id) apiUrl.searchParams.set("imdb_id", imdb_id);
        if (season_number) apiUrl.searchParams.set("season_number", season_number);
        if (episode_number) apiUrl.searchParams.set("episode_number", episode_number);

        const res = await fetch(apiUrl.toString(), {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Api-Key": env.OS_API_KEY,
            "User-Agent": env.OS_APP_UA,
          },
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          return jsonResponse({ message: (data && data.message) ? data.message : "Search failed", status: res.status }, res.status);
        }
        return jsonResponse(data, 200);
      }

      if (url.pathname === "/download-file" && request.method === "GET") {
        const file_id = pick(url.searchParams, ["file_id"]);
        const format = pick(url.searchParams, ["format"]) || "srt";
        if (!file_id) return jsonResponse({ message: "Missing file_id", status: 400 }, 400);

        const token = await ensureToken(env); // may be null (no creds)
        // Get a temporary download link
        const dlRes = await fetch(OS_API_BASE + "/download", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Api-Key": env.OS_API_KEY,
            "User-Agent": env.OS_APP_UA,
            ...(token ? { "Authorization": "Bearer " + token } : {}),
          },
          body: JSON.stringify({ file_id: Number(file_id), sub_format: format }),
        });

        const dlData = await dlRes.json().catch(() => null);
        if (!dlRes.ok) {
          return jsonResponse({ message: (dlData && dlData.message) ? dlData.message : "Download request failed", status: dlRes.status }, dlRes.status);
        }

        const link = dlData && dlData.link ? dlData.link : null;
        const fileName = dlData && dlData.file_name ? dlData.file_name : ("subtitle-" + file_id + "." + format);
        if (!link) return jsonResponse({ message: "No link returned by API", status: 502 }, 502);

        // Fetch subtitle file content (usually no special headers needed)
        const fileRes = await fetch(link, { method: "GET" });
        if (!fileRes.ok) {
          return jsonResponse({ message: "Failed to fetch file", status: fileRes.status }, fileRes.status);
        }

        const contentType = (format === "vtt") ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8";
        return new Response(fileRes.body, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
          },
        });
      }

      return jsonResponse({ message: "Not found", status: 404 }, 404);
    } catch (err) {
      return jsonResponse({ message: String(err && err.message ? err.message : err), status: 500 }, 500);
    }
  },
};
