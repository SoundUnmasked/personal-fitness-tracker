import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Guard (Package F, item 1): em dashes (U+2014) and en dashes (U+2013) must
// never appear in user-facing strings. We parse each source file with the
// TypeScript compiler and check ONLY string literals, template literals and JSX
// text — the nodes that can reach the screen. Code comments are ignored on
// purpose (they are never rendered), which is why a plain grep is not used here.
//
// Ranges use a hyphen-minus ("0-10"); punctuation uses commas, colons, full
// stops or parentheses. If this test fails, replace the flagged dash accordingly.

const DASH = /[–—]/;
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

function findDashes(file: string): { line: number; text: string }[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: { line: number; text: string }[] = [];
  const visit = (n: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isJsxText(n)) text = n.text;
    else if (
      n.kind === ts.SyntaxKind.TemplateHead ||
      n.kind === ts.SyntaxKind.TemplateMiddle ||
      n.kind === ts.SyntaxKind.TemplateTail
    ) {
      text = (n as ts.LiteralLikeNode).text;
    }
    if (text && DASH.test(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      hits.push({ line: line + 1, text: text.replace(/\n/g, ' ').trim().slice(0, 60) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('no em/en dashes in user-facing strings', () => {
  const files: string[] = [];
  walk(SRC, files);

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = file.slice(file.indexOf('/src/') + 1);
    it(`${rel} has no U+2013 / U+2014 in strings or JSX`, () => {
      const hits = findDashes(file);
      expect(
        hits,
        hits.length
          ? `Found em/en dash in ${rel}:\n` +
              hits.map((h) => `  line ${h.line}: "${h.text}"`).join('\n')
          : '',
      ).toEqual([]);
    });
  }
});
