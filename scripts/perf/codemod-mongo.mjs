// One-shot codemod: route the ~24 per-request `new MongoClient(MONGODB_URI)`
// sites through the shared getMongoClient(). Idempotent, reversible via git.
// Prints a per-file report. Does NOT touch finance-db.ts or mongo.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = new URL("../../", import.meta.url).pathname;
const files = execSync(`grep -rl "new MongoClient(MONGODB_URI)" ${root}src --include=*.ts`, { encoding: "utf8" })
  .trim().split("\n").filter((f) => f && !f.endsWith("finance-db.ts") && !f.endsWith("mongo.ts"));

const IMPORT = `import { getMongoClient } from "@/lib/mongo";`;
let changed = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;

  // 1) Remove the local `const MONGODB_URI = ...;` (single- or multi-line; the
  //    connection string contains no ';' so the first ';' terminates cleanly).
  src = src.replace(/\n?[ \t]*const MONGODB_URI\s*=[\s\S]*?;[ \t]*\n/, "\n");

  // 2) `new MongoClient(MONGODB_URI)` -> `await getMongoClient()` (all in async fns).
  src = src.replace(/new MongoClient\(MONGODB_URI\)/g, "await getMongoClient()");

  // 3) Drop MongoClient from the mongodb import IFF the identifier is now unused.
  const stillUsesType = /\bMongoClient\b/.test(src.replace(/from ['"]mongodb['"]/g, ""));
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]mongodb['"];?[ \t]*$/m, (m, inner) => {
    let names = inner.split(",").map((s) => s.trim()).filter(Boolean);
    if (!stillUsesType) names = names.filter((n) => n !== "MongoClient" && n !== "type MongoClient");
    const rebuilt = names.length ? `import { ${names.join(", ")} } from "mongodb";` : "";
    // Attach the shared-client import right here (after/ў in place of mongodb import).
    return rebuilt ? `${rebuilt}\n${IMPORT}` : IMPORT;
  });

  // Safety: if the file had no `from 'mongodb'` import line matched, ensure the
  // getMongoClient import still got added.
  if (!src.includes(IMPORT)) {
    src = src.replace(/^(import .*\n)/m, `$1${IMPORT}\n`);
  }

  if (src !== before) {
    writeFileSync(file, src);
    changed++;
    console.log(`✓ ${file.replace(root, "")}`);
  } else {
    console.log(`— ${file.replace(root, "")} (no change)`);
  }
}
console.log(`\nTransformed ${changed}/${files.length} files.`);
