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
    prefix = "Solution()."
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError("지원하지 않는 Python 엔트리포인트입니다.")
    method_name = value[len(prefix):]
    if not method_name.isidentifier():
        raise ValueError("지원하지 않는 Python 엔트리포인트입니다.")
    return method_name


def assigned_names(node):
    names = set()
    if isinstance(node, ast.Name):
        names.add(node.id)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            names.update(assigned_names(item))
    return names


def defined_names(tree):
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
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == method_name:
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
    return ast.Expr(
        value=ast.Call(
            func=ast.Attribute(
                value=ast.Name(id="_leetcode_runner_methods", ctx=ast.Load()),
                attr="append",
                ctx=ast.Load(),
            ),
            args=[
                ast.Tuple(
                    elts=[ast.Constant(value=candidate_id), ast.Name(id=method_name, ctx=ast.Load())],
                    ctx=ast.Load(),
                )
            ],
            keywords=[],
        )
    )


def instrument_solutions(tree, method_name):
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
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == method_name:
                next_body.append(append_capture(node, "c{}m{}".format(class_index, method_index), method_name))
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
    def __init__(self, source):
        self.source = source
        self.assertions = []

    def visit_Assert(self, node):
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
    def list_node(values):
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
        while left is not None and right is not None:
            if getattr(left, "val", None) != getattr(right, "val", None):
                return False
            left = getattr(left, "next", None)
            right = getattr(right, "next", None)
        return left is None and right is None

    def is_same_tree(left, right):
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


def run(request, tree, inspection):
    candidate_id = request.get("candidateId")
    candidate_info = next(
        (candidate for candidate in inspection["candidates"] if candidate["id"] == candidate_id),
        None,
    )
    if candidate_info is None:
        return {"ok": False, "kind": "candidate", "message": "선택한 풀이를 찾지 못했습니다."}
    if candidate_info["async"]:
        return {"ok": False, "kind": "candidate", "message": "비동기 풀이 메서드는 지원하지 않습니다."}

    namespace = {
        "__name__": "__leetcode_study_runner__",
        "__file__": request.get("filename", "solution.py"),
        "_leetcode_runner_classes": [],
        "_leetcode_case_state": [0],
    }
    stdout = LimitedWriter(MAX_CAPTURE_CHARS)
    stderr = LimitedWriter(MAX_CAPTURE_CHARS)
    started = time.monotonic()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
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

            test_source = request["test"]
            test_tree = ast.parse(test_source, filename="dataset:{}".format(request.get("slug", "problem")))
            instrumenter = AssertInstrumenter(test_source)
            test_tree = instrumenter.visit(test_tree)
            ast.fix_missing_locations(test_tree)
            exec(compile(test_tree, "dataset:{}".format(request.get("slug", "problem")), "exec"), namespace)
            check = namespace.get("check")
            if not callable(check):
                raise RuntimeError("데이터셋에 check(candidate) 함수가 없습니다.")
            try:
                check(candidate)
            except AssertionError:
                failed_case = namespace["_leetcode_case_state"][0]
                return {
                    "ok": True,
                    "outcome": "failed",
                    "passed": max(0, failed_case - 1),
                    "total": len(instrumenter.assertions),
                    "failedCase": failed_case,
                    "assertion": instrumenter.assertions[failed_case - 1] if failed_case else None,
                    "durationMs": round((time.monotonic() - started) * 1000),
                    "stdout": stdout.value(),
                    "stderr": stderr.value(),
                }
        return {
            "ok": True,
            "outcome": "passed",
            "passed": len(instrumenter.assertions),
            "total": len(instrumenter.assertions),
            "durationMs": round((time.monotonic() - started) * 1000),
            "stdout": stdout.value(),
            "stderr": stderr.value(),
        }
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
