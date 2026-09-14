/** 소스와 개발 스크립트의 이름 있는 선언에 설명이 있는 JSDoc이 붙었는지 검사합니다. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** 파일 또는 디렉터리에서 TypeScript·JavaScript 소스를 재귀적으로 수집합니다. */
function sourceFiles(target) {
  if (fs.statSync(target).isDirectory()) {
    return fs.readdirSync(target).flatMap((name) => sourceFiles(path.join(target, name)));
  }
  return /\.(?:ts|mjs)$/.test(target) ? [target] : [];
}

/** 이름 있는 함수·타입·클래스·메서드와 생성자·접근자를 문서화 대상으로 판정합니다. */
function requiresDocumentation(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
  );
}

/** 함수 변수는 변수 문장의 JSDoc을 사용하며 설명 없는 태그만 있는 주석은 거부합니다. */
function hasDescription(node) {
  const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return ts.getJSDocCommentsAndTags(owner).some((doc) => {
    if (!ts.isJSDoc(doc)) return false;
    const description =
      typeof doc.comment === 'string'
        ? doc.comment
        : doc.comment?.map((part) => part.text).join('');
    return Boolean(description?.trim());
  });
}

/** 구문 오류와 JSDoc 누락을 파일·줄·선언 이름으로 보고하고 검사한 선언 수를 반환합니다. */
function inspectFile(file, failures) {
  const contents = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
  let declarations = 0;
  for (const diagnostic of source.parseDiagnostics) {
    const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    failures.push(
      `${file}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    );
  }

  /** 하위 선언까지 순회하되 익명 콜백과 일반 데이터 필드는 검사 대상에서 제외합니다. */
  function visit(node) {
    if (requiresDocumentation(node)) {
      declarations += 1;
      if (!hasDescription(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const name = node.name?.getText(source) ?? ts.SyntaxKind[node.kind];
        failures.push(`${file}:${line + 1} ${name}: 설명이 있는 JSDoc이 필요합니다.`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return declarations;
}

const targets = process.argv.slice(2);
const files = [...new Set((targets.length ? targets : ['src', 'scripts']).flatMap(sourceFiles))];
const failures = [];
const declarations = files.reduce((count, file) => count + inspectFile(file, failures), 0);
if (files.length === 0) failures.push('검사할 소스 파일이 없습니다.');
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`JSDoc 검사 통과: ${files.length}개 파일, ${declarations}개 선언, 누락 0개.`);
}
