// tests/circuitLint.test.ts — CI-enforces the arch-circuit rule "Symbols run as
// stages (never write `kernel.call`)" over the real sources' AST.
//
// `call`/`compose`/`invoke` are legitimate public kernelee APIs, but each
// consumes a Symbol/Pipe as a runtime invocation = leaves no edge in
// `Pipe.descriptors`. Used in src, they become a silent failure mode: visible
// in runtime traces but gone from the static wiring graph. Only `kernel.run`
// (the fire-and-forget launch of one-line delegates) / `kernel.dispatch` /
// `kernel.buffer.*` are allowed.
//
// tests/ are out of scope — `await kernel.call(SimPort.step)` is the legitimate
// means of end-to-end driving (`dispatch` is fire-and-forget and cannot await a
// result), and circuit.test.ts etc. actually depend on it. The ban is on
// "writing it in src", not on the API's existence.
//
// There is no allowlist. "A new saga is linted the moment
// its file exists" — if an exception is needed, discuss the rule first.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');

/** Kernel methods that bypass the static wiring graph. */
const FORBIDDEN_IN_SRC = new Set(['call', 'compose', 'invoke']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Harvest property accesses of the `kernel.call` shape. Not limited to call
 * positions, so alias-based evasion like `const c = kernel.call` is caught by
 * the same net. Mentions in comments or string literals (like ControlBar.tsx's
 * "kernel.call or") are not picked up, since this walks the AST. */
function violations(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      FORBIDDEN_IN_SRC.has(node.name.text) &&
      ts.isIdentifier(node.expression) &&
      /kernel/i.test(node.expression.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${relative(repoRoot, path)}:${line + 1} — ${node.expression.text}.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('arch-circuit lint', () => {
  it('src/ never writes kernel.call / kernel.compose / kernel.invoke (edges would vanish from the static wiring graph)', () => {
    const found = sourceFiles(srcRoot).flatMap(violations);
    expect(found, `forbidden Kernel calls:\n${found.join('\n')}`).toEqual([]);
  });

  it('the lint itself is alive — it actually detects kernel.call in a synthetic source', () => {
    const fixture = join(srcRoot, '__lint_fixture__.ts');
    const source = ts.createSourceFile(
      fixture,
      'const f = async (kernel: Kernel) => kernel.call(SimPort.step);',
      ts.ScriptTarget.Latest,
      true,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        FORBIDDEN_IN_SRC.has(node.name.text) &&
        ts.isIdentifier(node.expression) &&
        /kernel/i.test(node.expression.text)
      ) {
        found.push(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(found).toEqual(['call']);
  });
});
