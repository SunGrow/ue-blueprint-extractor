import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

type ParameterIssue = {
  file: string;
  line: number;
  method: string;
  key: string;
  expected: string[];
};

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(mcpRoot, '..');

function parseSubsystemParameters(): Map<string, Set<string>> {
  const headerPath = path.join(
    repoRoot,
    'BlueprintExtractor',
    'Source',
    'BlueprintExtractor',
    'Public',
    'BlueprintExtractorSubsystem.h',
  );
  const header = fs.readFileSync(headerPath, 'utf8');
  const methods = new Map<string, Set<string>>();
  const signatureRegex = /FString\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g;

  let match: RegExpExecArray | null;
  while ((match = signatureRegex.exec(header)) !== null) {
    const [, method, rawParams] = match;
    const params = rawParams
      .split(',')
      .map((rawPart) => rawPart.replace(/\/\/.*$/g, '').split('=')[0].trim())
      .filter((part) => part.length > 0 && part !== 'void')
      .map((part) => part.match(/([A-Za-z_]\w*)\s*$/)?.[1])
      .filter((name): name is string => Boolean(name));

    methods.set(method, new Set(params));
  }

  return methods;
}

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function propertyKey(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectParameterIssues(methods: Map<string, Set<string>>): ParameterIssue[] {
  const issues: ParameterIssue[] = [];
  for (const file of collectSourceFiles(path.join(mcpRoot, 'src'))) {
    const sourceText = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'callSubsystemJson'
      ) {
        const [methodArg, paramsArg] = node.arguments;
        if (
          methodArg &&
          ts.isStringLiteral(methodArg) &&
          paramsArg &&
          ts.isObjectLiteralExpression(paramsArg)
        ) {
          const expected = methods.get(methodArg.text);
          if (expected) {
            for (const prop of paramsArg.properties) {
              if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
                continue;
              }

              const key = propertyKey(prop.name);
              if (key && !expected.has(key)) {
                const pos = source.getLineAndCharacterOfPosition(prop.name.getStart(source));
                issues.push({
                  file: path.relative(repoRoot, file),
                  line: pos.line + 1,
                  method: methodArg.text,
                  key,
                  expected: [...expected],
                });
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(source);
  }

  return issues;
}

describe('callSubsystemJson parameter contract', () => {
  it('uses UFUNCTION parameter names for literal subsystem calls', () => {
    const issues = collectParameterIssues(parseSubsystemParameters());

    expect(
      issues.map((issue) =>
        `${issue.file}:${issue.line} ${issue.method}.${issue.key} not in [${issue.expected.join(', ')}]`,
      ),
    ).toEqual([]);
  });
});
