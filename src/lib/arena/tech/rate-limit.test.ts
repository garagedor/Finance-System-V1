// Shared (Mongo-backed) exchange rate limiting: atomic counting under
// concurrency, per user+IP and per IP windows, window rollover, TTL.
//
// The second half runs against a REAL local MongoDB when ARENA_MONGO_TEST_URI is
// set (e.g. mongodb://127.0.0.1:27031 on the dev stack); it uses a throwaway
// database and drops it afterwards. Set ARENA_MONGO_TTL_WAIT=1 to also wait for
// the TTL monitor to delete an expired window (~60–120 s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MemoryRateLimiter, MongoRateLimiter, RATE_LIMIT_TTL_INDEX, type RateLimitCollection, type RateLimitDoc } from "./rate-limit.ts";
import { exchange, type AccessDeps } from "./access.ts";

/** Atomic in-memory stand-in for findOneAndUpdate($inc, upsert). */
function fakeCollection() {
  const docs = new Map<string, RateLimitDoc>();
  const coll: RateLimitCollection = {
    async findOneAndUpdate(filter, update) {
      await new Promise((r) => setImmediate(r)); // interleave like real I/O
      const cur = docs.get(filter._id) ?? { _id: filter._id, count: 0, expiresAt: update.$setOnInsert.expiresAt };
      cur.count += update.$inc.count;
      docs.set(filter._id, cur);
      return { ...cur };
    },
  };
  return { coll, docs };
}

test("Mongo limiter: exactly `limit` requests pass in a window, even all at once", async () => {
  const { coll } = fakeCollection();
  const l = new MongoRateLimiter(coll, 10, 60_000, () => 1_000_000);
  const r = await Promise.all(Array.from({ length: 50 }, () => l.take("u:a|1.2.3.4")));
  assert.equal(r.filter(Boolean).length, 10);
});

test("Mongo limiter: keys are independent (per user+IP vs per IP), and a new window starts fresh", async () => {
  const { coll, docs } = fakeCollection();
  let t = 120_000;
  const l = new MongoRateLimiter(coll, 2, 60_000, () => t);
  assert.deepEqual([await l.take("a"), await l.take("a"), await l.take("a"), await l.take("b")], [true, true, false, true]);
  t += 60_000;
  assert.equal(await l.take("a"), true, "next window");
  const d = docs.get(`a|120000`)!;
  assert.equal(d.expiresAt.getTime(), 120_000 + 60_000 + 60_000, "expires one grace minute after its window ends");
});

test("Mongo limiter: a counter failure is an error (the exchange then fails closed)", async () => {
  const l = new MongoRateLimiter({ findOneAndUpdate: async () => null }, 5, 60_000);
  await assert.rejects(l.take("x"));
});

test("exchange uses the limiter asynchronously: the 11th attempt from one user+IP is rate_limited", async () => {
  const { coll } = fakeCollection();
  const deps = {
    enabled: true,
    verifyWbToken: async () => ({ userId: "u1" }),
    verifier: { verify: async () => ({ active: false, approved: false, role: "technician" }) },
    findCompetitor: async () => ({ ok: false }),
    passKeys: null as never,
    passTtlSeconds: 300,
    limiters: { ip: new MongoRateLimiter(coll, 60, 60_000), userIp: new MongoRateLimiter(coll, 10, 60_000) },
  } as unknown as AccessDeps;
  const codes: string[] = [];
  for (let i = 0; i < 11; i++) codes.push(((await exchange(deps, "Bearer a.b.c", "9.9.9.9")).body as { code: string }).code);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill("account_inactive"));
  assert.equal(codes[10], "rate_limited");
});

test("Memory limiter (unit tests only) keeps its behaviour", () => {
  let t = 0;
  const m = new MemoryRateLimiter(1, 1000, () => t);
  assert.equal(m.take("k"), true);
  assert.equal(m.take("k"), false);
  t = 1000;
  assert.equal(m.take("k"), true);
});

const URI = process.env.ARENA_MONGO_TEST_URI;
test("REAL Mongo: atomic across two limiter instances (two serverless instances), TTL index, expiry", { skip: !URI && "set ARENA_MONGO_TEST_URI" }, async () => {
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URI!)) throw new Error("local MongoDB only");
  const { MongoClient } = createRequire(import.meta.url)("mongodb");
  const client = await MongoClient.connect(URI);
  const db = client.db(`arena_rl_test_${process.pid}`);
  try {
    const c = db.collection("arena_rate_limit");
    await c.createIndex(RATE_LIMIT_TTL_INDEX.key, RATE_LIMIT_TTL_INDEX.options);
    const now = Date.now();
    const a = new MongoRateLimiter(c, 10, 60_000, () => now);
    const b = new MongoRateLimiter(c, 10, 60_000, () => now);
    const r = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).take("u:x|1.1.1.1")));
    assert.equal(r.filter(Boolean).length, 10, "exactly 10 across both instances");
    const docs = await c.find({}).toArray();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].count, 40);
    const idx = (await c.indexes()).find((i: { name: string }) => i.name === "ttl_expiresAt");
    assert.equal(idx?.expireAfterSeconds, 0);
    if (process.env.ARENA_MONGO_TTL_WAIT === "1") {
      const old = new MongoRateLimiter(c, 10, 1000, () => Date.now() - 3 * 60_000); // a window that ended minutes ago
      await old.take("expired");
      const deadline = Date.now() + 150_000;
      let left = 1;
      while (Date.now() < deadline && (left = await c.countDocuments({ _id: { $regex: /^expired\|/ } })) > 0) await new Promise((x) => setTimeout(x, 5000));
      assert.equal(left, 0, "the TTL monitor removed the expired window");
    }
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
