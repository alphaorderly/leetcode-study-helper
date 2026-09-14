"""stdin 요청 하나를 처리하는 별도 Python 프로세스입니다.

inspect는 AST만 읽고 사용자 소스를 실행하지 않습니다. run은 소스와 데이터셋을
실행하며 stdout에는 JSON 응답만 씁니다. 사용자 출력은 응답 필드에 따로 담습니다.
-I 옵션은 실행 환경을 격리하지만 사용자 코드의 보안 샌드박스는 아닙니다.
실행 허용 여부·시간 제한·프로세스 취소는 확장 호스트의 PythonRunnerService가 담당합니다.
"""

import ast
import collections
import contextlib
import io
import json
import sys
import time
import traceback

KNOWN_OBJECTS = {"ListNode", "TreeNode", "Node", "NestedInteger"}
MAX_CAPTURE_CHARS = 1_000_000


class LimitedWriter(io.TextIOBase):
    """실행 중 출력의 보관 크기를 제한하고 잘린 출력에 안내를 붙입니다."""
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.length = 0
        self.truncated = False

    def write(self, value):
        value = str(value)
        remaining = self.limit - self.length
        if remaining > 0:
            piece = value[:remaining]
            self.parts.append(piece)
            self.length += len(piece)
        if len(value) > remaining:
            self.truncated = True
        return len(value)

    def value(self):
        suffix = "\n…출력이 1MB에서 잘렸습니다." if self.truncated else ""
        return "".join(self.parts) + suffix


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


def install_prelude(namespace):
    """LeetCode에서 흔히 제공하는 표준 라이브러리 이름을 실행 공간에 준비합니다."""
    prelude = """
import array
import bisect
import collections
import datetime
import functools
import heapq
import itertools
import math
import operator
import random
import re
import string
from typing import *
from functools import *
from collections import *
from itertools import *
from heapq import *
from bisect import *
from string import *
from operator import *
from math import *
inf = float('inf')
"""
    exec(compile(prelude, "<leetcode-prelude>", "exec"), namespace)


def install_object_helpers(namespace):
    """풀이가 선언한 LeetCode 객체를 데이터셋에서 사용할 수 있도록 변환 함수를 준비합니다."""
    def list_node(values):
        """사용자가 선언한 ListNode 생성자로 연결 리스트를 만듭니다. 정의가 없거나 호환되지 않으면 실패합니다."""
        if not values:
            return None
        cls = namespace.get("ListNode")
        if cls is None:
            raise NameError("ListNode가 선언되어 있지 않습니다.")
        try:
            head = cls(values[0])
            current = head
            for value in values[1:]:
                node = cls(value)
                current.next = node
                current = node
            return head
        except Exception as error:
            raise TypeError("사용자 ListNode 정의로 테스트 입력을 만들 수 없습니다: {}".format(error)) from error

    def tree_node(values):
        """너비 우선 순서의 값 목록을 사용자 TreeNode로 변환합니다. None은 자식 부재를 뜻합니다."""
        if not values:
            return None
        cls = namespace.get("TreeNode")
        if cls is None:
            raise NameError("TreeNode가 선언되어 있지 않습니다.")
        try:
            root = cls(values[0])
            queue = collections.deque([root])
            index = 1
            while queue and index < len(values):
                node = queue.popleft()
                if index < len(values) and values[index] is not None:
                    node.left = cls(values[index])
                    queue.append(node.left)
                index += 1
                if index < len(values) and values[index] is not None:
                    node.right = cls(values[index])
                    queue.append(node.right)
                index += 1
            return root
        except Exception as error:
            raise TypeError("사용자 TreeNode 정의로 테스트 입력을 만들 수 없습니다: {}".format(error)) from error

    def is_same_list(left, right):
        """노드 클래스의 동등 비교 대신 val과 next를 따라 데이터셋의 연결 리스트 결과를 비교합니다."""
        while left is not None and right is not None:
            if getattr(left, "val", None) != getattr(right, "val", None):
                return False
            left = getattr(left, "next", None)
            right = getattr(right, "next", None)
        return left is None and right is None

    def is_same_tree(left, right):
        """val과 좌우 자식 구조를 재귀적으로 비교하여 사용자 TreeNode 구현에 의존하지 않습니다."""
        if left is None or right is None:
            return left is right
        return (
            getattr(left, "val", None) == getattr(right, "val", None)
            and is_same_tree(getattr(left, "left", None), getattr(right, "left", None))
            and is_same_tree(getattr(left, "right", None), getattr(right, "right", None))
        )

    namespace.update({
        "list_node": list_node,
        "tree_node": tree_node,
        "is_same_list": is_same_list,
        "is_same_tree": is_same_tree,
    })


def create_execution_namespace(request):
    """풀이와 데이터셋이 공유할 이름 공간을 준비합니다.

    _leetcode_runner_classes는 덮어쓴 클래스·메서드를 보존하고,
    _leetcode_case_state는 현재 assert 번호를 담는 가변 목록입니다.
    AST에 삽입한 코드가 같은 객체를 갱신하므로 예약 이름을 함께 바꿔야 합니다.
    """
    return {
        "__name__": "__leetcode_study_runner__",
        "__file__": request.get("filename", "solution.py"),
        "_leetcode_runner_classes": [],
        "_leetcode_case_state": [0],
    }


def prepare_solution(namespace, request, tree, inspection, candidate_id):
    """소스를 실행하고 선택한 클래스의 원래 메서드를 복원해 bound method를 반환합니다.

    같은 이름의 마지막 선언으로 자동 덮어쓰는 Python 규칙을 우회합니다.
    사용자 코드의 출력과 예외가 호출자의 캡처·오류 처리 안에 남도록 그 안에서 호출합니다.
    """
    install_prelude(namespace)
    executable = instrument_solutions(tree, inspection["methodName"])
    exec(compile(executable, request.get("filename", "solution.py"), "exec"), namespace)
    selected_class = None
    selected_method = None
    for solution_class, methods in namespace["_leetcode_runner_classes"]:
        for stored_id, method in methods:
            if stored_id == candidate_id:
                selected_class = solution_class
                selected_method = method
    if selected_class is None or selected_method is None:
        raise RuntimeError("선택한 풀이를 실행 가능한 상태로 만들지 못했습니다.")
    setattr(selected_class, inspection["methodName"], selected_method)
    namespace["Solution"] = selected_class
    candidate = getattr(selected_class(), inspection["methodName"])
    install_object_helpers(namespace)

    return candidate


def prepare_test(namespace, request):
    """데이터셋의 assert에 위치 기록 코드를 삽입하고 check 함수와 assertion 목록을 반환합니다.

    테스트 소스의 최상위 코드도 여기서 실행됩니다. check의 호출과 실패 집계는 run이 담당합니다.
    """
    test_source = request["test"]
    test_tree = ast.parse(
        test_source, filename="dataset:{}".format(request.get("slug", "problem"))
    )
    instrumenter = AssertInstrumenter(test_source)
    test_tree = instrumenter.visit(test_tree)
    ast.fix_missing_locations(test_tree)
    exec(
        compile(
            test_tree, "dataset:{}".format(request.get("slug", "problem")), "exec"
        ),
        namespace,
    )
    check = namespace.get("check")
    if not callable(check):
        raise RuntimeError("데이터셋에 check(candidate) 함수가 없습니다.")
    return check, instrumenter


def test_result(outcome, instrumenter, failed_case, started, stdout, stderr):
    """정상 실행의 통과·assert 실패 응답을 만듭니다. 실행 예외는 이 응답을 사용하지 않습니다."""
    result = {
        "ok": True,
        "outcome": outcome,
        "passed": len(instrumenter.assertions),
        "total": len(instrumenter.assertions),
        "durationMs": round((time.monotonic() - started) * 1000),
        "stdout": stdout.value(),
        "stderr": stderr.value(),
    }
    if outcome == "failed":
        result.update({
            "passed": max(0, failed_case - 1),
            "failedCase": failed_case,
            "assertion": instrumenter.assertions[failed_case - 1] if failed_case else None,
        })
    return result


def run(request, tree, inspection):
    """후보 검증 → 실행 공간 준비 → 풀이 복원 → 테스트 준비 → 실행 순서로 처리합니다.

    check 실행 중 AssertionError는 테스트 실패(ok=True)이고 준비·실행의 다른 예외는 실행 오류(ok=False)입니다.
    첫 실패 번호와 통과 수는 삽입한 assert 표식 기준이며 별도 테스트 케이스 실행 횟수가 아닙니다.
    """
    candidate_id = request.get("candidateId")
    candidate_info = next(
        (candidate for candidate in inspection["candidates"] if candidate["id"] == candidate_id),
        None,
    )
    if candidate_info is None:
        return {"ok": False, "kind": "candidate", "message": "선택한 풀이를 찾지 못했습니다."}
    if candidate_info["async"]:
        return {"ok": False, "kind": "candidate", "message": "비동기 풀이 메서드는 지원하지 않습니다."}

    namespace = create_execution_namespace(request)
    stdout = LimitedWriter(MAX_CAPTURE_CHARS)
    stderr = LimitedWriter(MAX_CAPTURE_CHARS)
    started = time.monotonic()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            candidate = prepare_solution(namespace, request, tree, inspection, candidate_id)
            check, instrumenter = prepare_test(namespace, request)
            try:
                check(candidate)
            except AssertionError:
                failed_case = namespace["_leetcode_case_state"][0]
                return test_result("failed", instrumenter, failed_case, started, stdout, stderr)
        return test_result("passed", instrumenter, None, started, stdout, stderr)
    except BaseException as error:
        return {
            "ok": False,
            "kind": "execution",
            "message": "{}: {}".format(type(error).__name__, error),
            "case": namespace.get("_leetcode_case_state", [0])[0],
            "traceback": traceback.format_exc(limit=8),
            "durationMs": round((time.monotonic() - started) * 1000),
            "stdout": stdout.value(),
            "stderr": stderr.value(),
        }


def main():
    """stdin의 JSON 요청 하나를 처리하고 stdout에 JSON 응답 하나를 기록합니다."""
    try:
        request = json.load(sys.stdin)
        tree, inspection = inspect_source(
            request.get("source", ""),
            request.get("filename", "solution.py"),
            request.get("entryPoint", ""),
            request.get("requiredObjects", []),
        )
        if not inspection["ok"] or request.get("mode") == "inspect":
            response = inspection
        elif inspection["missingObjects"]:
            response = {
                "ok": False,
                "kind": "missingObjects",
                "message": "필요한 LeetCode 객체가 선언되어 있지 않습니다.",
                "missingObjects": inspection["missingObjects"],
            }
        else:
            response = run(request, tree, inspection)
    except BaseException as error:
        response = {
            "ok": False,
            "kind": "runner",
            "message": "{}: {}".format(type(error).__name__, error),
            "traceback": traceback.format_exc(limit=8),
        }
    sys.stdout.write(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
