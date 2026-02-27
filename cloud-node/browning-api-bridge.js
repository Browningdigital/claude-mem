// browning-api-bridge — Cloudflare Worker
// General-purpose API proxy for environments with egress restrictions.
// Routes: /fb/* → graph.facebook.com, /api/* → passthrough to any URL
// Auth: Bearer token in X-Bridge-Key header must match BRIDGE_SECRET env var

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bridgeKey = request.headers.get("X-Bridge-Key");

    // Auth check
    if (bridgeKey !== env.BRIDGE_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Route: /fb/* → graph.facebook.com
    if (url.pathname.startsWith("/fb/")) {
      const fbPath = url.pathname.slice(3); // strip "/fb"
      const fbUrl = new URL(`https://graph.facebook.com${fbPath}`);
      // Forward query params
      url.searchParams.forEach((v, k) => fbUrl.searchParams.set(v, k));
      // Inject stored FB token if not provided
      if (!fbUrl.searchParams.has("access_token") && env.FB_USER_TOKEN) {
        fbUrl.searchParams.set("access_token", env.FB_USER_TOKEN);
      }
      const resp = await fetch(fbUrl.toString(), {
        method: request.method,
        headers: passHeaders(request),
        body: request.method !== "GET" ? await request.text() : undefined,
      });
      return proxy(resp);
    }

    // Route: /proxy?url=<encoded_url> → any URL
    if (url.pathname === "/proxy") {
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "missing ?url= param" }, 400);
      const resp = await fetch(target, {
        method: request.method,
        headers: passHeaders(request),
        body: request.method !== "GET" ? await request.text() : undefined,
      });
      return proxy(resp);
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, worker: "browning-api-bridge", ts: Date.now() });
    }

    return json({ error: "not found", routes: ["/fb/*", "/proxy?url=", "/health"] }, 404);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bridge-Key",
  };
}

function passHeaders(request) {
  const h = new Headers();
  const pass = ["content-type", "authorization", "accept"];
  for (const key of pass) {
    const val = request.headers.get(key);
    if (val) h.set(key, val);
  }
  return h;
}

function proxy(resp) {
  const headers = new Headers(resp.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(resp.body, { status: resp.status, headers });
}
