/* Cloudflare Worker entry point. All the thinking lives in handler.js so it
   can be tested without this runtime; this file only routes. */

import { handleUpload } from "./handler.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/upload") {
      return handleUpload(request, env);
    }

    if (pathname === "/health") {
      const configured = Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);
      return new Response(
        JSON.stringify({ ok: configured, configured }),
        {
          status: configured ? 200 : 503,
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
