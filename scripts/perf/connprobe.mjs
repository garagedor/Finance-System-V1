// Connection-reuse probe: mints an admin token, reads Atlas connection count,
// fires 30 parallel API requests, re-reads. With the shared pool, current
// should rise by at most ~poolSize (10), not ~30. READ-ONLY.
import { MongoClient } from "mongodb";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const uri = env.split("\n").find((l) => l.startsWith("MONGODB_URI=")).slice(12).trim().replace(/^["']|["']$/g, "");
const c = new MongoClient(uri); await c.connect();
const roles = await c.db("ag").collection("finance_role").find({}).toArray();
const perms = [...new Set(roles.flatMap((r) => r.permissions ?? []))];
const sec = new TextEncoder().encode(process.env.JWT_SECRET ?? "super-secret-key-for-development");
const tok = await new SignJWT({ _id: "perf-admin", name: "Perf Admin", type: "admin", permissions: perms, active: true })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(sec);
async function conns() { try { const s = await c.db("admin").command({ serverStatus: 1 }); return s.connections?.current; } catch (e) { return `n/a (${e.codeName || e.message})`; } }

const before = await conns();
console.log("connections.current BEFORE burst:", before);
process.stdout.write("firing 30 parallel /api/jobs requests... ");
const codes = await Promise.all(Array.from({ length: 30 }, () =>
  fetch("http://localhost:3000/api/jobs?page=1&pageSize=5", { headers: { cookie: `session=${tok}` } }).then((r) => r.status).catch(() => "ERR")));
console.log("done:", codes.filter((x) => x === 200).length + "/30 ok");
await new Promise((r) => setTimeout(r, 800));
const after = await conns();
console.log("connections.current AFTER burst: ", after);
if (typeof before === "number" && typeof after === "number") console.log(`Δ connections: +${after - before} (pool cap 10)`);
await c.close();
