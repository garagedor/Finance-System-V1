/* Resolution shim for `node --test`.
   Next supplies two things plain Node does not: the `@/` path alias, and the
   `server-only` marker package, which exists purely to make a build fail if a
   server module is imported from the client. Neither changes behaviour at
   runtime, so the tests stub them and import the real modules rather than
   copies of them. */
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";
import { statSync } from "node:fs";

const SRC = join(import.meta.dirname, "..", "src");
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const STUB = "data:text/javascript,export default {};";

function firstFile(base) {
  for (const ext of EXTS) {
    try {
      const p = base + ext;
      if (statSync(p).isFile()) return p;
    } catch { /* next candidate */ }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  // A build-time marker with no runtime behaviour.
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: STUB, shortCircuit: true };
  }
  // Next ships these as .js and relies on its own bundler resolution; plain
  // Node needs the extension.
  if (/^next\/(headers|server|navigation|cache)$/.test(specifier)) {
    return next(`${specifier}.js`, context);
  }
  if (specifier.startsWith("@/")) {
    const hit = firstFile(join(SRC, specifier.slice(2)));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const hit = firstFile(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  return next(specifier, context);
}
