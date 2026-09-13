/* The photo upload relay.
 *
 * GitHub Pages cannot accept an upload, and a public page cannot hold a
 * credential that writes to the repository: anything in the page is readable
 * by anyone, and a token committed to a public repo is revoked by GitHub's
 * secret scanning. So the token lives here instead -- in a secret on the
 * relay, which the browser never sees.
 *
 * This module is deliberately free of Cloudflare-specific APIs. It takes a
 * standard Request and an env object, and returns a standard Response, with
 * `fetch` injectable so the whole thing can be unit-tested under plain Node.
 * src/worker.js is the thin adapter that hands it those things.
 *
 * What it does NOT do: touch image bytes. Workers have no image pipeline on
 * the free plan, so the browser re-encodes the photo (which strips EXIF) and
 * the publishing Action strips it again. The relay's job is to refuse junk
 * and commit. There is deliberately no captcha: nothing uploads until the
 * submitter ticks the consent box and gives a reply address, and the cheapest
 * real deterrents are already here -- origin checking, strict size and type
 * limits, and a hard 8-photo cap. If spam ever becomes a problem, a Turnstile
 * widget verified here (or a WAF rate-limit rule on the route) slots in
 * without changing anything downstream.
 */

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_FIELD = 400;

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
]);

function cors(origin, extra = {}) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
    ...extra,
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(origin, { "content-type": "application/json; charset=utf-8" }),
  });
}

function clean(value, limit = MAX_FIELD) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

/* Fields arrive as JSON in `meta`, because the browser sends the photos and
   the form together as one multipart body and we want the metadata to survive
   intact rather than being smuggled through filename conventions. */
function readMeta(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

function extensionFor(file) {
  const byType = ALLOWED_TYPES.get(clean(file.type, 80).toLowerCase());
  if (byType) return byType;
  const name = clean(file.name, 200).toLowerCase();
  const match = name.match(/\.(jpe?g|png|webp|heic|heif)$/);
  return match ? `.${match[1] === "jpeg" ? "jpg" : match[1]}` : null;
}

/* Commit one file to a branch via the Contents API. The branch is created
   from the default branch's tip if it does not exist yet. */
async function commitFile({ repo, token, branch, path, base64, message }, doFetch) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "suas-photo-relay",
    "content-type": "application/json",
  };

  // Does it already exist on that branch? Then we need its blob sha to replace it.
  let sha;
  const existing = await doFetch(`${url}?ref=${encodeURIComponent(branch)}`, {
    headers,
  });
  if (existing.ok) {
    const found = await existing.json().catch(() => null);
    if (found && found.sha) sha = found.sha;
  } else if (existing.status !== 404) {
    throw new Error(`lookup failed (${existing.status})`);
  }

  const response = await doFetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message, content: base64, branch, ...(sha ? { sha } : {}) }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`commit failed (${response.status}) ${detail.slice(0, 200)}`);
  }
  return response.json();
}

async function ensureBranch({ repo, token, branch, from }, doFetch) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "suas-photo-relay",
  };
  const refUrl = `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const existing = await doFetch(refUrl, { headers });
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error(`branch lookup failed (${existing.status})`);

  const base = await doFetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(from)}`,
    { headers }
  );
  if (!base.ok) throw new Error(`cannot read base branch (${base.status})`);
  const { object } = await base.json();

  const created = await doFetch("https://api.github.com/repos/" + repo + "/git/refs", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }),
  });
  // 422 means it appeared underneath us, which is fine.
  if (!created.ok && created.status !== 422) {
    throw new Error(`cannot create branch (${created.status})`);
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function handleUpload(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const origin = request.headers.get("origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405, origin);
  }
  if (allowed && origin !== allowed) {
    return json({ ok: false, error: "Origin not allowed." }, 403, origin);
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json({ ok: false, error: "The relay is not configured yet." }, 500, origin);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400, origin);
  }

  const meta = readMeta(form.get("meta"));
  if (meta === null) {
    return json({ ok: false, error: "Malformed metadata." }, 400, origin);
  }

  const name = clean(meta.name);
  const email = clean(meta.email);
  const credit = clean(meta.credit);
  const caption = clean(meta.caption, 2000);
  const consent = meta.consent === true;

  if (!consent) {
    return json({ ok: false, error: "Please confirm the consent box." }, 400, origin);
  }
  if (!name) {
    return json({ ok: false, error: "Please give a name to credit." }, 400, origin);
  }
  if (!email.includes("@") || email.length < 3) {
    return json({ ok: false, error: "Please give an email address." }, 400, origin);
  }

  const files = form.getAll("photos").filter((f) => f && typeof f === "object" && f.size > 0);
  if (!files.length) {
    return json({ ok: false, error: "No photos were attached." }, 400, origin);
  }
  if (files.length > MAX_FILES) {
    return json(
      { ok: false, error: `Please send at most ${MAX_FILES} photos at a time.` },
      400,
      origin
    );
  }
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return json(
        { ok: false, error: `"${clean(file.name, 80)}" is larger than 12 MB.` },
        413,
        origin
      );
    }
    if (!extensionFor(file)) {
      return json(
        { ok: false, error: `"${clean(file.name, 80)}" is not a photo we can read.` },
        415,
        origin
      );
    }
  }

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const branch = env.SUBMISSIONS_BRANCH || "submissions";

  try {
    await ensureBranch(
      { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, branch, from: env.BASE_BRANCH || "main" },
      doFetch
    );

    const saved = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const extension = extensionFor(file);
      const filename = `${String(i + 1).padStart(2, "0")}${extension}`;
      await commitFile(
        {
          repo: env.GITHUB_REPO,
          token: env.GITHUB_TOKEN,
          branch,
          path: `submissions/${id}/${filename}`,
          base64: toBase64(await file.arrayBuffer()),
          message: `Photo submission ${id}: ${filename}`,
        },
        doFetch
      );
      saved.push(filename);
    }

    /* The contact details land here, on the submissions branch, which GitHub
       Pages does not serve. They never reach the published site. */
    await commitFile(
      {
        repo: env.GITHUB_REPO,
        token: env.GITHUB_TOKEN,
        branch,
        path: `submissions/${id}/submission.json`,
        base64: toBase64(
          new TextEncoder().encode(
            JSON.stringify(
              {
                id,
                received: new Date().toISOString(),
                name,
                email,
                credit: credit || "",
                caption: caption || "",
                consent: true,
                photos: saved,
              },
              null,
              2
            )
          )
        ),
        message: `Photo submission ${id}: details`,
      },
      doFetch
    );
  } catch (error) {
    return json(
      { ok: false, error: `We could not store your photos: ${error.message}` },
      502,
      origin
    );
  }

  return json(
    {
      ok: true,
      id,
      count: files.length,
      message:
        files.length === 1
          ? "Thanks — your photo is on its way to the gallery and should appear in a minute or two."
          : `Thanks — your ${files.length} photos are on their way to the gallery and should appear in a minute or two.`,
    },
    200,
    origin
  );
}
