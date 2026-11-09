/* Loader for scripts that import CRM route modules. Those modules use
   `import { SomeType }` without `type`, which Node's strip-only TypeScript
   cannot run, so .ts/.tsx under src/ and scripts/ are transpiled with the
   project's own TypeScript (type-only imports are elided). Resolution reuses
   scripts/test-resolver.mjs. */
import { register } from "node:module";
register("../test-resolver.mjs", import.meta.url);
register("./transpile-hook.mjs", import.meta.url);
