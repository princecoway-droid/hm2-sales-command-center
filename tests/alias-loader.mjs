/**
 * Teaches plain Node the project's `@/* -> src/*` path alias.
 *
 * Node 24 strips TypeScript types on its own, so with this one resolve hook the
 * whole `src/` tree is importable from a test file without a bundler, a
 * transpile step or a test framework:
 *
 *   node --import ./tests/alias-loader.mjs ./tests/validation.test.mts
 *
 * Deliberately not a test runner. If this project ever needs fixtures, mocking
 * or watch mode, reach for Vitest then - not before.
 */

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));

      for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
