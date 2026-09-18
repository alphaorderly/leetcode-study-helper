"""사용자 소스의 후보 분석과 실행 전 AST 변환을 담당합니다. inspect는 소스를 실행하지 않습니다."""

import ast

KNOWN_OBJECTS = {"ListNode", "TreeNode", "Node", "NestedInteger"}


def parse_entry_point(value):
    """Solution().메서드 형식의 진입점을 검증하고 메서드 이름을 반환합니다."""
    prefix = "Solution()."
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError("지원하지 않는 Python 엔트리포인트입니다.")
    method_name = value[len(prefix):]
    if not method_name.isidentifier():
        raise ValueError("지원하지 않는 Python 엔트리포인트입니다.")
    return method_name


def assigned_names(node):
    """단일 이름과 튜플·리스트 구조 분해 대입에서 선언되는 이름을 재귀적으로 찾습니다."""
    names = set()
    if isinstance(node, ast.Name):
        names.add(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            names.update(assigned_names(item))
    return names


def defined_names(tree):
    """모듈 최상위 선언·import·대입만 수집합니다. 함수 안의 지역 선언은 객체 제공으로 간주하지 않습니다."""
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "*":
                    names.add(alias.asname or alias.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                names.update(assigned_names(target))
    return names


def inspect_source(source, filename, entry_point, required_objects):
    """소스를 실행하지 않고 AST에서 풀이 후보와 누락된 객체 선언을 찾습니다."""
    method_name = parse_entry_point(entry_point)
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as error:
        return None, {
            "ok": False,
            "kind": "syntax",
            "message": error.msg,
            "line": error.lineno,
            "column": error.offset,
        }

    referenced = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name)
        and isinstance(node.ctx, ast.Load)
        and node.id in KNOWN_OBJECTS
    }
    needed = referenced.union(
        value for value in required_objects if value in KNOWN_OBJECTS
    )
    missing = sorted(needed.difference(defined_names(tree)))

    candidates = []
    class_index = 0
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "Solution":
            continue
        method_index = 0
        for item in node.body:
            if (
                isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == method_name
            ):
                candidate_id = "c{}m{}".format(class_index, method_index)
                candidates.append({
                    "id": candidate_id,
                    "label": "Solution #{} · {} · {}번째 줄".format(
                        class_index + 1, method_name, item.lineno
                    ),
                    "classIndex": class_index,
                    "methodIndex": method_index,
                    "classLine": node.lineno,
                    "methodLine": item.lineno,
                    "async": isinstance(item, ast.AsyncFunctionDef),
                })
                method_index += 1
        class_index += 1

    return tree, {
        "ok": True,
        "methodName": method_name,
        "candidates": candidates,
        "missingObjects": missing,
    }


def append_capture(node, candidate_id, method_name):
    """메서드 선언 직후 실행할 `_leetcode_runner_methods.append((id, method))` AST입니다."""
    return ast.Expr(
        value=ast.Call(
            func=ast.Attribute(
                value=ast.Name(id="_leetcode_runner_methods", ctx=ast.Load()),
                attr="append",
                ctx=ast.Load(),
            ),
            args=[
                ast.Tuple(
                    elts=[
                        ast.Constant(value=candidate_id),
                        ast.Name(id=method_name, ctx=ast.Load()),
                    ],
                    ctx=ast.Load(),
                )
            ],
            keywords=[],
        )
    )


def instrument_solutions(tree, method_name):
    """중복 Solution 클래스와 메서드를 덮어쓰기 전에 보관하도록 AST를 수정합니다.

    클래스 안에 `_leetcode_runner_methods = []`를 넣고 각 메서드 선언 직후
    `_leetcode_runner_methods.append(("c0m0", answer))`를 실행합니다.
    클래스 밖에는 `_leetcode_runner_classes.append((Solution, Solution._leetcode_runner_methods))`
    에 해당하는 코드를 넣습니다. 클래스 docstring은 첫 문장으로 보존합니다.
    ID의 c/m 번호는 해당 클래스·메서드의 0부터 시작하는 등장 순서이며 inspect_source와 일치해야 합니다.
    """
    body = []
    class_index = 0
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "Solution":
            body.append(node)
            continue

        method_list = ast.Assign(
            targets=[ast.Name(id="_leetcode_runner_methods", ctx=ast.Store())],
            value=ast.List(elts=[], ctx=ast.Load()),
        )
        insertion = 1 if (
            node.body
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.body[0].value.value, str)
        ) else 0
        node.body.insert(insertion, method_list)

        next_body = []
        method_index = 0
        for item in node.body:
            next_body.append(item)
            if (
                isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                and item.name == method_name
            ):
                next_body.append(
                    append_capture(
                        node, "c{}m{}".format(class_index, method_index), method_name
                    )
                )
                method_index += 1
        node.body = next_body
        body.append(node)
        body.append(
            ast.Expr(
                value=ast.Call(
                    func=ast.Attribute(
                        value=ast.Name(id="_leetcode_runner_classes", ctx=ast.Load()),
                        attr="append",
                        ctx=ast.Load(),
                    ),
                    args=[
                        ast.Tuple(
                            elts=[
                                ast.Name(id="Solution", ctx=ast.Load()),
                                ast.Attribute(
                                    value=ast.Name(id="Solution", ctx=ast.Load()),
                                    attr="_leetcode_runner_methods",
                                    ctx=ast.Load(),
                                ),
                            ],
                            ctx=ast.Load(),
                        )
                    ],
                    keywords=[],
                )
            )
        )
        class_index += 1
    tree.body = body
    ast.fix_missing_locations(tree)
    return tree


class AssertInstrumenter(ast.NodeTransformer):
    """assert 실행 직전에 번호를 기록하여 실패한 테스트 위치를 결과에 포함합니다."""
    def __init__(self, source):
        self.source = source
        self.assertions = []

    def visit_Assert(self, node):
        """assert 앞에 `_leetcode_case_state[0] = 번호`를 넣어 실패 위치를 바깥 실행기에 전달합니다."""
        self.generic_visit(node)
        index = len(self.assertions) + 1
        self.assertions.append(ast.get_source_segment(self.source, node) or "assert")
        marker = ast.Assign(
            targets=[
                ast.Subscript(
                    value=ast.Name(id="_leetcode_case_state", ctx=ast.Load()),
                    slice=ast.Constant(value=0),
                    ctx=ast.Store(),
                )
            ],
            value=ast.Constant(value=index),
        )
        return [marker, node]
