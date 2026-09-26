/* Tests for the relay handler, run with plain Node:
 *
 *   node --test relay/test/
 *
 * The handler takes `fetch` as an injection point precisely so this can run
 * without Cloudflare, without network access and without a real token.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";

import { handleUpload, handleModerate } from "../src/handler.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const ENV = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPO: "USYD-Astro/USYD-Astro",
  ALLOWED_ORIGIN: "https://usyd-astro.github.io",
  SUBMISSIONS_BRANCH: "submissions",
  BASE_BRANCH: "main",
};

const ORIGIN = "https://usyd-astro.github.io";

function fakeFile(name, type, bytes = [0xff, 0xd8, 0xff]) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

/* A minimal stand-in for a Request: the handler only reads the method, the
   origin header and the parsed form body. */
function stubRequest({ method = "POST", origin = ORIGIN, meta, photos = [] } = {}) {
  const form = new Map();
  form.set("meta", JSON.stringify({ consent: true, name: "Jane", email: "jane@example.com", ...meta }));
  form.set("photos", photos);
  return {
    method,
    headers: { get: (key) => (key.toLowerCase() === "origin" ? origin : null) },
    formData: async () => ({
      get: (key) => (key === "photos" ? null : form.get(key)),
      getAll: (key) => (key === "photos" ? photos : []),
    }),
  };
}

/* A fake GitHub API. Records every call so tests can assert on them. */
function fakeFetch({ failCommit = false, failDispatch = false, branchExists = true } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });

    if (String(url).endsWith("/dispatches")) {
      if (failDispatch) return new Response("nope", { status: 403 });
      return new Response("", { status: 204 });
    }
    if (String(url).includes("/git/ref/heads/")) {
      // Only the submissions branch may be missing; main always exists.
      const isSubmissions = String(url).includes("/heads/submissions");
      if (isSubmissions && !branchExists) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 });
    }
    if (String(url).endsWith("/git/refs")) {
      return new Response(JSON.stringify({ ref: "refs/heads/submissions" }), { status: 201 });
    }
    if (String(url).includes("/contents/")) {
      if (failCommit) return new Response("boom", { status: 500 });
      // GET lookups for an existing blob answer 404; PUTs answer 201.
      if (!init.method || init.method === "GET") return new Response("Not Found", { status: 404 });
      return new Response(JSON.stringify({ content: { sha: "new" } }), { status: 201 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const body = async (response) => response.json();

/* A stand-in for the removal request: the handler reads the method, the
   origin header and a JSON body, and nothing else. */
function stubModerate({
  method = "POST",
  origin = ORIGIN,
  payload = { filename: "22.jpg", reason: "withdrawn at the member's request" },
  raw = null,
} = {}) {
  return {
    method,
    headers: { get: (key) => (key.toLowerCase() === "origin" ? origin : null) },
    json: async () => {
      if (raw !== null) throw new SyntaxError("bad json");
      return payload;
    },
  };
}

test("removal: queues a takedown, with no password like the upload", async () => {
  const fetchStub = fakeFetch();
  const response = await handleModerate(stubModerate(), ENV, { fetch: fetchStub });
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
  // commitFile probes for an existing blob before writing, so the queued
  // request is the PUT under contents/moderate/, not the GET beside it.
  const queued = fetchStub.calls.find(
    (c) => c.method === "PUT" && c.url.includes("/contents/moderate/")
  );
  assert.ok(queued, "a removal request was committed to the queue branch");
  const sent = JSON.parse(queued.body);
  assert.equal(sent.branch, "submissions", "queued off the served branch");
  const written = JSON.parse(atob(sent.content));
  assert.equal(written.filename, "22.jpg");
  assert.match(written.reason, /withdrawn/);
});

test("removal: refuses a name that is not a bare gallery filename", async () => {
  // Not authentication -- there is none. Path safety: this value is
  // interpolated into a path on the queue branch, so a slash or a dot-segment
  // has to die here rather than at the far end.
  const hostile = [
    "../../.github/workflows/gallery.yml",
    "assets/data/gallery.yml",
    "../secrets.txt",
    "22.jpg/../../x",
    "22.JPG",
    "22.jpg?ref=main",
    "22.jpg#x",
    "/etc/passwd",
    "22",
    "",
  ];
  for (const filename of hostile) {
    const fetchStub = fakeFetch();
    const response = await handleModerate(
      stubModerate({ payload: { filename } }),
      ENV,
      { fetch: fetchStub }
    );
    assert.equal(
      response.status,
      400,
      `${JSON.stringify(filename)} must be refused, got ${response.status}`
    );
    assert.equal(
      fetchStub.calls.some(
        (c) => c.method === "PUT" && c.url.includes("/contents/moderate/")
      ),
      false,
      `${JSON.stringify(filename)} must not queue anything`
    );
  }
});

test("removal: a curated non-jpg photo is removable too", async () => {
  const fetchStub = fakeFetch();
  const response = await handleModerate(
    stubModerate({ payload: { filename: "03.png" } }),
    ENV,
    { fetch: fetchStub }
  );
  assert.equal(response.status, 200);
});

test("removal: refuses a different origin and non-POST, like the upload", async () => {
  const other = await handleModerate(
    stubModerate({ origin: "https://evil.example" }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(other.status, 403);
  const wrongMethod = await handleModerate(
    stubModerate({ method: "GET" }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(wrongMethod.status, 405);
});

test("removal: a malformed body does not become a queued file", async () => {
  const fetchStub = fakeFetch();
  const response = await handleModerate(stubModerate({ raw: "{" }), ENV, {
    fetch: fetchStub,
  });
  assert.equal(response.status, 400);
  assert.equal(
    fetchStub.calls.some(
      (c) => c.method === "PUT" && c.url.includes("/contents/moderate/")
    ),
    false
  );
});

test("removal: a refused dispatch still reports the request as queued", async () => {
  // It is committed either way; the dispatch is only what makes it fast, and
  // the five-minute schedule is the floor.
  const fetchStub = fakeFetch({ failDispatch: true });
  const response = await handleModerate(stubModerate(), ENV, { fetch: fetchStub });
  assert.equal(response.status, 200);
  assert.ok(
    fetchStub.calls.some(
      (c) => c.method === "PUT" && c.url.includes("/contents/moderate/")
    )
  );
});

test("rejects anything that is not POST", async () => {
  const response = await handleUpload(stubRequest({ method: "GET" }), ENV, { fetch: fakeFetch() });
  assert.equal(response.status, 405);
});

test("answers the CORS preflight", async () => {
  const response = await handleUpload(stubRequest({ method: "OPTIONS" }), ENV, { fetch: fakeFetch() });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
});

test("refuses a different origin", async () => {
  const response = await handleUpload(
    stubRequest({ origin: "https://evil.example" }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(response.status, 403);
});

test("says so plainly when it has not been configured", async () => {
  const response = await handleUpload(stubRequest(), { ...ENV, GITHUB_TOKEN: "" }, {
    fetch: fakeFetch(),
  });
  assert.equal(response.status, 500);
  assert.match((await body(response)).error, /not configured/i);
});

test("requires the consent box", async () => {
  const response = await handleUpload(
    stubRequest({ meta: { consent: false }, photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(response.status, 400);
  assert.match((await body(response)).error, /consent/i);
});

test("requires a name and a plausible email", async () => {
  const photos = [fakeFile("a.jpg", "image/jpeg")];
  const noName = await handleUpload(stubRequest({ meta: { name: "" }, photos }), ENV, {
    fetch: fakeFetch(),
  });
  assert.equal(noName.status, 400);
  assert.match((await body(noName)).error, /name/i);

  const noEmail = await handleUpload(stubRequest({ meta: { email: "nope" }, photos }), ENV, {
    fetch: fakeFetch(),
  });
  assert.equal(noEmail.status, 400);
  assert.match((await body(noEmail)).error, /email/i);
});

test("requires at least one photo", async () => {
  const response = await handleUpload(stubRequest({ photos: [] }), ENV, { fetch: fakeFetch() });
  assert.equal(response.status, 400);
  assert.match((await body(response)).error, /no photos/i);
});

test("caps the number of photos", async () => {
  const photos = Array.from({ length: 9 }, (_, i) => fakeFile(`${i}.jpg`, "image/jpeg"));
  const response = await handleUpload(stubRequest({ photos }), ENV, { fetch: fakeFetch() });
  assert.equal(response.status, 400);
  assert.match((await body(response)).error, /at most 8/i);
});

test("refuses a file over the size cap, by name", async () => {
  const huge = { ...fakeFile("enormous.jpg", "image/jpeg"), size: 13 * 1024 * 1024 };
  const response = await handleUpload(stubRequest({ photos: [huge] }), ENV, {
    fetch: fakeFetch(),
  });
  assert.equal(response.status, 413);
  assert.match((await body(response)).error, /enormous\.jpg/);
});

test("refuses something that is not a photo", async () => {
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("payload.exe", "application/octet-stream")] }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(response.status, 415);
  assert.match((await body(response)).error, /payload\.exe/);
});

test("accepts a photo by extension when the browser sends no type", async () => {
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("IMG_2004.HEIC", "")] }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(response.status, 200);
});

test("commits straight through when it is configured", async () => {
  const github = fakeFetch();
  const response = await handleUpload(
    stubRequest({
      meta: { name: "Jane Citizen", email: "jane@example.com", credit: "Jane C.", caption: "Trivia night" },
      photos: [fakeFile("a.jpg", "image/jpeg"), fakeFile("b.png", "image/png")],
    }),
    ENV,
    { fetch: github }
  );

  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.count, 2);
  assert.match(payload.id, /^[0-9a-z]+-[0-9a-f]{8}$/);

  const writes = github.calls.filter((c) => c.method === "PUT");
  assert.equal(writes.length, 3, "two photos plus one details file");
  assert.ok(writes.some((c) => c.url.endsWith("01.jpg")), "photo 1 committed");
  assert.ok(writes.some((c) => c.url.endsWith("02.png")), "photo 2 committed");
  assert.ok(writes.some((c) => c.url.endsWith("submission.json")), "details committed");

  // Everything must land on the submissions branch, never on main.
  for (const call of writes) {
    assert.match(call.url, /contents\//);
  }
  assert.ok(
    github.calls.some((c) => c.url.includes("heads/submissions")),
    "the submissions branch is checked"
  );
  assert.equal(
    github.calls.filter((c) => c.url.endsWith("/git/refs")).length,
    0,
    "an existing branch must not be recreated"
  );
});

test("creates the submissions branch when it does not exist", async () => {
  const github = fakeFetch({ branchExists: false });
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: github }
  );
  assert.equal(response.status, 200);
  assert.ok(
    github.calls.some((c) => c.url.endsWith("/git/refs") && c.method === "POST"),
    "the branch is created"
  );
  assert.ok(
    github.calls.some((c) => c.url.includes("/heads/main")),
    "the new branch is based on main"
  );
  assert.ok(
    github.calls.some((c) => c.url.endsWith("submission.json")),
    "the details are still committed after creating the branch"
  );
});

test("reports a repository failure instead of claiming success", async () => {
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: fakeFetch({ failCommit: true }) }
  );
  assert.equal(response.status, 502);
  assert.match((await body(response)).error, /could not store/i);
});

test("an upload with no origin header is refused, so it cannot be posted from nowhere", async () => {
  const response = await handleUpload(
    stubRequest({ origin: "" , photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: fakeFetch() }
  );
  assert.equal(response.status, 403);
});

test("asks the publishing workflow to run as soon as the photos are committed", async () => {
  const github = fakeFetch();
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: github }
  );
  assert.equal(response.status, 200);
  const { id } = await body(response);

  const dispatch = github.calls.find((c) => c.url.endsWith("/dispatches"));
  assert.ok(dispatch, "a dispatch is sent");
  assert.equal(dispatch.method, "POST");

  const event = JSON.parse(dispatch.body);
  assert.equal(event.event_type, "photo-submitted", "matches the workflow trigger");
  assert.equal(event.client_payload.id, id, "names the submission that was just committed");
  assert.equal(event.client_payload.branch, "submissions", "the queue branch the photos landed on");

  /* The dispatch is only worth anything once the photos are safely on the
     queue, so it has to come last rather than in the middle of the commits. */
  const writes = github.calls.filter((c) => c.method === "PUT");
  assert.ok(
    github.calls.indexOf(dispatch) > github.calls.indexOf(writes[writes.length - 1]),
    "dispatched after the last commit"
  );
});

test("a refused dispatch does not turn a stored submission into a failure", async () => {
  const github = fakeFetch({ failDispatch: true });
  const response = await handleUpload(
    stubRequest({ photos: [fakeFile("a.jpg", "image/jpeg")] }),
    ENV,
    { fetch: github }
  );
  /* The photos are on the queue branch, where the schedule will find them.
     Failing the request here would only tell the submitter something untrue,
     and make them send the same photos again. */
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
});
