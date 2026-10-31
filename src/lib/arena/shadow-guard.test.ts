// Read-only guard used by the shadow-validation scripts (scripts/arena/lib-ro-guard.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalMongoUri, evaluateGuard, readOnly, type ConnectionStatus, type Privilege } from "../../../scripts/arena/lib-ro-guard.ts";

const status = (user: string, privileges: Privilege[] | undefined, db = "admin"): ConnectionStatus => ({
  authInfo: { authenticatedUsers: [{ user, db }], authenticatedUserRoles: [], authenticatedUserPrivileges: privileges },
});
const on = (collection: string, actions: string[], db = "ag"): Privilege => ({ resource: { db, collection }, actions });

// What MongoDB reports for the built-in roles on "ag" (actions abbreviated to the decisive ones).
const READ_WRITE = [on("", ["find", "insert", "update", "remove", "createIndex", "dropCollection", "listCollections"])];
const DB_OWNER = [on("", ["find", "insert", "update", "remove", "dropDatabase", "createUser", "grantRole"])];

test("guard: find-only on CRM collections passes", () => {
  const v = evaluateGuard(status("arena_shadow_ro", [on("Job", ["find"]), on("Technician", ["find"]), on("TechNameMapping", ["find"])]));
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.deepEqual(v.findOn, ["Job", "TechNameMapping", "Technician"]);
  assert.equal(v.canFind("Job"), true);
  assert.equal(v.canFind("User"), false);
});

test("guard: listCollections / listIndexes are tolerated; db-wide find covers every collection", () => {
  const v = evaluateGuard(status("ro", [on("", ["find", "listCollections", "listIndexes"])]));
  assert.equal(v.ok, true);
  assert.equal(v.canFind("User"), true);
});

test("guard: readWrite is refused", () => {
  const v = evaluateGuard(status("someone", READ_WRITE));
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(), /non-read action\(s\): createIndex, dropCollection, insert, remove, update on ag\.<any collection>/);
});

test("guard: dbOwner is refused", () => {
  assert.equal(evaluateGuard(status("owner", DB_OWNER)).ok, false);
});

test("guard: shared app/ops users are refused by name, even if read-only", () => {
  for (const u of ["lbs_ops", "lbs_crm_app", "LBS_OPS"]) {
    const v = evaluateGuard(status(u, [on("Job", ["find"])]));
    assert.equal(v.ok, false, u);
    assert.match(v.reasons.join(), /shared read-write account/);
  }
});

test("guard: ANY single write action anywhere is refused", () => {
  for (const a of ["insert", "update", "remove", "createIndex", "dropIndex", "dropCollection", "createCollection", "renameCollectionSameDB", "bypassDocumentValidation", "changeStream", "killCursors"]) {
    const v = evaluateGuard(status("ro", [on("Job", ["find"]), on("Technician", ["find", a])]));
    assert.equal(v.ok, false, a);
  }
  // a write privilege on another database or the cluster is refused too
  assert.equal(evaluateGuard(status("ro", [on("Job", ["find"]), on("x", ["insert"], "scratch")])).ok, false);
  assert.equal(evaluateGuard(status("ro", [on("Job", ["find"]), { resource: { cluster: true }, actions: ["shutdown"] }])).ok, false);
  assert.equal(evaluateGuard(status("ro", [{ resource: { anyResource: true }, actions: ["anyAction"] }])).ok, false);
});

test("guard: unauthenticated, no privileges reported, or no find on the CRM db → refused", () => {
  assert.equal(evaluateGuard({ authInfo: { authenticatedUsers: [], authenticatedUserPrivileges: [] } }).ok, false);
  assert.equal(evaluateGuard(status("ro", undefined)).ok, false);
  const other = evaluateGuard(status("ro", [on("Job", ["find"], "elsewhere")]));
  assert.equal(other.ok, false);
  assert.match(other.reasons.join(), /no find privilege on the CRM database "ag"/);
});

test("in-process proxy: write methods throw before reaching the driver; reads pass", async () => {
  const calls: string[] = [];
  const col = {
    findOne: async () => (calls.push("findOne"), { ok: 1 }),
    updateOne: async () => (calls.push("updateOne"), null),
    insertMany: async () => (calls.push("insertMany"), null),
    aggregate: (p: unknown[]) => (calls.push(`aggregate:${p.length}`), { toArray: async () => [] }),
  };
  const blocked: string[] = [];
  const db = readOnly({ collection: () => col }, "db", blocked);
  const c = (db as { collection: (n: string) => typeof col }).collection("Job");
  assert.deepEqual(await c.findOne(), { ok: 1 });
  assert.throws(() => c.updateOne(), /READ-ONLY: Job\.updateOne blocked/);
  assert.throws(() => c.insertMany(), /READ-ONLY/);
  assert.throws(() => c.aggregate([{ $match: {} }, { $merge: "x" }]), /\$out\/\$merge/);
  c.aggregate([{ $match: {} }]);
  assert.deepEqual(calls, ["findOne", "aggregate:1"]);
  assert.deepEqual(blocked, ["Job.updateOne", "Job.insertMany", "Job.aggregate($out/$merge)"]);
});

test("local Arena state must be on 127.0.0.1", () => {
  assert.doesNotThrow(() => assertLocalMongoUri("mongodb://127.0.0.1:27031"));
  assert.doesNotThrow(() => assertLocalMongoUri("mongodb://u:p@127.0.0.1:27031/arena_shadow?authSource=admin"));
  for (const bad of ["mongodb+srv://cluster0.example.mongodb.net", "mongodb://localhost:27017", "mongodb://127.0.0.1:1,10.0.0.5:27017", "mongodb://u:p@db.example.com/x"])
    assert.throws(() => assertLocalMongoUri(bad), /127\.0\.0\.1/, bad);
});
