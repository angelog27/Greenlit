// Loads the model section (between the MODEL START / MODEL END comments) of a
// GREENLIGHT html file into an isolated node:vm context and returns that context.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadModel(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const a = html.indexOf("// ===== MODEL START =====");
  const b = html.indexOf("// ===== MODEL END =====");
  if (a < 0 || b < 0) throw new Error("model markers not found in " + htmlPath);
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(a, b), ctx, { filename: String(htmlPath) });
  return ctx;
}
