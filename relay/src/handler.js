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
 * the free plan, so the page sends the photo as it was chosen and the
 * publishing Action re-encodes it when it derives the web-sized copy. The
 * relay's job is to refuse junk and commit. Nothing here strips EXIF: the
 * files committed to the submissions branch still carry it, and only the
 * re-encoded copies that reach the published branch do not. There is
 * deliberately no captcha: nothing uploads until the
 * submitter ticks the consent box and gives a reply address, and the cheapest
 * real deterrents are already here -- origin checking, strict size and type
 * limits, and a hard 8-photo cap. If spam ever becomes a problem, a Turnstile
 * widget verified here (or a WAF rate-limit rule on the route) slots in
 * without changing anything downstream.
 */

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_FIELD = 400;

/* Must match `on: repository_dispatch: types:` in
   .github/workflows/publish-submission.yml. */
const PUBLISH_EVENT = "photo-submitted";

/* The only shape of thing this relay will agree to unpublish: a gallery
   number and an extension. Anything containing a slash, a dot-segment or any
   other path syntax is refused here rather than further down, because the
   value below is the only thing standing between this endpoint and the
   repository token. It is matched against the manifests before it is queued as
   well, so a name that is not a published photo is a no-op rather than a
   lookup.

   The extension is not pinned to .jpg because the gallery is not all .jpg:
   assets/data/gallery.yml lists 03.png, and a photo nobody can take down is
   worse than one that is merely hard to. tools/gallery.py uses the same rule. */
const GALLERY_FILE = /^\d{2,}\.[A-Za-z0-9]+$/;

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

/* Nudge the publishing workflow into running now, rather than waiting for the
   next tick of its five-minute schedule. This is an optimisation and not the
   mechanism: the schedule is what actually guarantees a submission is picked
   up, which is why a dispatch GitHub refuses costs a submitter a few minutes
   of waiting and nothing else.

   Contents: write covers this endpoint, which is the same permission the
   commits above already need, so the token does not grow a new power. */
async function requestPublish({ repo, token, id, branch }, doFetch) {
  const response = await doFetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "suas-photo-relay",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_type: PUBLISH_EVENT,
      client_payload: { id, branch },
    }),
  });
  if (!response.ok) {
    throw new Error(`dispatch failed (${response.status})`);
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

/* ---- removing a photo -------------------------------------------------- */

/* Compared in a way that does not leak the answer through timing. A plain
   === on a secret is a side channel, and this is the only thing standing
   between a stranger and the repository. */
function secretMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) {
    return false;
  }
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  // Compare a fixed number of bytes so the loop length does not depend on
  // which of the two was longer.
  const length = Math.max(a.length, b.length, 32);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

/* The published manifests, and so the only names that mean anything. Read
   through the Contents API rather than assumed, so that a request naming a
   photo which was never published is refused instead of queued. */
async function publishedPhotos({ repo, token, branch }, doFetch) {
  const names = new Set();
  for (const file of ["assets/data/submissions.yml", "assets/data/gallery.yml"]) {
    const response = await doFetch(
      `https://api.github.com/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "suas-photo-relay",
        },
      }
    );
    if (!response.ok) {
      continue;
    }
    const found = await response.json().catch(() => null);
    if (!found || !found.content) {
      continue;
    }
    const text = atob(String(found.content).replace(/\s/g, ""));
    // Deliberately not a YAML parse: this only needs the `file:` keys, and a
    // manifest we cannot read should not be able to fail a takedown request.
    for (const match of text.matchAll(/^\s*-\s*file:\s*"?([0-9]+\.[A-Za-z0-9]+)"?\s*$/gm)) {
      names.add(match[1].trim());
    }
  }
  return names;
}

/* POST /moderate
 *
 * Queues a takedown. It does not delete anything itself, and that is the
 * whole design: this Worker holds a contents:write token, so an endpoint that
 * removed files would turn a guessed password into a write primitive on the
 * repository. Instead it authenticates, checks the name against the published
 * manifests, and writes a request to the submissions branch -- which Pages
 * does not serve. tools/publish_submissions.py does the removal, with the
 * repository's own tooling, and `gallery.py check` gates it.
 *
 * The cost of that choice is that removal is a workflow run rather than
 * instant. The dispatch below makes it about a minute, and the five-minute
 * schedule is the floor if the dispatch does not land. */
export async function handleModerate(request, env, deps = {}) {
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
  if (!env.ADMIN_SECRET) {
    return json(
      { ok: false, error: "Removal is not set up on this relay yet." },
      503,
      origin
    );
  }

  const given = request.headers.get("x-admin-secret") || "";
  if (!secretMatches(given, env.ADMIN_SECRET)) {
    // Deliberately vague: a wrong secret and no secret are the same answer, so
    // this cannot be used to confirm that a guess was close.
    return json({ ok: false, error: "Not authorised." }, 401, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400, origin);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "Malformed request." }, 400, origin);
  }

  const filename = clean(body.filename, 40);
  if (!GALLERY_FILE.test(filename)) {
    return json(
      { ok: false, error: "That is not a gallery photo." },
      400,
      origin
    );
  }
  const reason = clean(body.reason, 300);

  const branch = env.BASE_BRANCH || "main";
  const queue = env.SUBMISSIONS_BRANCH || "submissions";
  const config = { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, branch };

  try {
    const known = await publishedPhotos(config, doFetch);
    if (!known.has(filename)) {
      return json(
        { ok: false, error: "That photo is not in the gallery." },
        404,
        origin
      );
    }

    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    await commitFile(
      {
        ...config,
        branch: queue,
        path: `moderate/${id}.json`,
        base64: toBase64(
          new TextEncoder().encode(
            JSON.stringify(
              {
                id,
                requested: new Date().toISOString(),
                filename,
                reason,
              },
              null,
              2
            )
          )
        ),
        message: `Removal request ${id}: ${filename}`,
      },
      doFetch
    );

    try {
      await requestPublish({ repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, id, branch: queue }, doFetch);
    } catch {
      // The schedule picks it up within five minutes instead.
    }

    return json(
      {
        ok: true,
        id,
        message:
          "That photo is off the site. It takes about a minute, and the request is " +
          "recorded in the repository's removal log.",
      },
      200,
      origin
    );
  } catch (error) {
    return json(
      { ok: false, error: `We could not queue the removal: ${error.message}` },
      502,
      origin
    );
  }
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
       Pages does not serve. They never reach the published manifests: the
       publishing workflow copies the name and email to the `contacts` branch,
       which Pages does not deploy either, and leaves them out of everything
       under assets/data/. Nothing about them may land on main -- Pages serves
       every path there, dot-directories included. */
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

  /* The photos are committed and the queue is safe, so this is deliberately
     outside the block above and cannot change the answer: reporting a stored
     submission as failed because a convenience call afterwards bounced would
     be a lie the submitter would act on. */
  try {
    await requestPublish(
      { repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN, id, branch },
      doFetch
    );
  } catch {
    // The schedule in the publishing workflow picks this up instead.
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
