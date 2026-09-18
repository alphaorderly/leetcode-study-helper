"""출력 캡처와 풀이·데이터셋이 공유하는 이름 공간을 준비합니다. 사용자 객체 정의는 대체하지 않습니다."""

import collections
import io

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
