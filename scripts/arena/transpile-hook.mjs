import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function load(url, context, next) {
  if (!/\.(ts|tsx)$/.test(url) || !url.startsWith("file:") || url.includes("/node_modules/")) return next(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
      rewriteRelativeImportExtensions: false,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
