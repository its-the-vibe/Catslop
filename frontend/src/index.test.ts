import { test } from "node:test";
import assert from "node:assert";
import worker, { verifyUserToken, Env } from "./index";

function createJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadBase64 = btoa(JSON.stringify(payload))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${payloadBase64}.mocksignature`;
}

function createMockDb() {
  const reactions: Array<{ cat_pic_id: number; user_id: string; emoji: string }> = [];
  return {
    prepare(query: string) {
      let boundParams: any[] = [];
      return {
        bind(...args: any[]) {
          boundParams = args;
          return this;
        },
        async run() {
          if (query.includes("INSERT INTO reactions")) {
            const [cat_pic_id, user_id, emoji] = boundParams;
            const exists = reactions.some(
              (r) => r.cat_pic_id === cat_pic_id && r.user_id === user_id && r.emoji === emoji
            );
            if (!exists) {
              reactions.push({ cat_pic_id, user_id, emoji });
            }
          }
          return { success: true };
        },
        async all<T = any>() {
          if (query.includes("FROM cat_pics")) {
            return { results: [{ id: 1, r2_key: "daily/test_cat.png" }] as T[] };
          }
          if (query.includes("FROM reactions")) {
            return { results: [{ cat_pic_id: 1, emoji: "❤️", count: 1 }] as T[] };
          }
          return { results: [] as T[] };
        },
      };
    },
    reactions,
  };
}

function createMockEnv(db = createMockDb()): Env {
  return {
    DB: db as any,
    MY_BUCKET: {
      get: async () => null,
    } as any,
    POLICY_AUD: "test-aud-12345",
  };
}

test("verifyUserToken returns invalid when CF_Authorization cookie is missing", () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/");
  const result = verifyUserToken(req, env);
  assert.strictEqual(result.valid, false);
});

test("verifyUserToken returns valid for valid JWT cookie", () => {
  const env = createMockEnv();
  const jwt = createJwt({
    sub: "user-123",
    aud: "test-aud-12345",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const req = new Request("https://example.com/", {
    headers: { Cookie: `CF_Authorization=${jwt}` },
  });
  const result = verifyUserToken(req, env);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.userId, "user-123");
});

test("verifyUserToken returns invalid for expired JWT", () => {
  const env = createMockEnv();
  const jwt = createJwt({
    sub: "user-123",
    aud: "test-aud-12345",
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
  const req = new Request("https://example.com/", {
    headers: { Cookie: `CF_Authorization=${jwt}` },
  });
  const result = verifyUserToken(req, env);
  assert.strictEqual(result.valid, false);
});

test("verifyUserToken returns invalid when AUD does not match POLICY_AUD", () => {
  const env = createMockEnv();
  const jwt = createJwt({
    sub: "user-123",
    aud: "wrong-aud",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const req = new Request("https://example.com/", {
    headers: { Cookie: `CF_Authorization=${jwt}` },
  });
  const result = verifyUserToken(req, env);
  assert.strictEqual(result.valid, false);
});

test("POST /api/react returns 401 when not logged in", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/api/react", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cat_pic_id: 1, emoji: "❤️" }),
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 401);
});

test("POST /api/react saves reaction to DB when logged in", async () => {
  const mockDb = createMockDb();
  const env = createMockEnv(mockDb);
  const jwt = createJwt({
    sub: "user-sub-abc",
    aud: "test-aud-12345",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const req = new Request("https://example.com/api/react", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `CF_Authorization=${jwt}`,
    },
    body: JSON.stringify({ cat_pic_id: 1, emoji: "🔥" }),
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const json = (await res.json()) as { success: boolean };
  assert.strictEqual(json.success, true);
  assert.strictEqual(mockDb.reactions.length, 1);
  assert.deepStrictEqual(mockDb.reactions[0], {
    cat_pic_id: 1,
    user_id: "user-sub-abc",
    emoji: "🔥",
  });
});

test("GET / does not render modal-reactions UI for unauthenticated requests", async () => {
  const env = createMockEnv();
  const req = new Request("https://example.com/");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.strictEqual(html.includes('id="modal-reactions"'), false);
});

test("GET / renders modal-reactions UI for authenticated requests", async () => {
  const env = createMockEnv();
  const jwt = createJwt({
    sub: "user-sub-abc",
    aud: "test-aud-12345",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const req = new Request("https://example.com/", {
    headers: { Cookie: `CF_Authorization=${jwt}` },
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.strictEqual(html.includes('id="modal-reactions"'), true);
  assert.strictEqual(html.includes('class="emoji-picker"'), true);
});
