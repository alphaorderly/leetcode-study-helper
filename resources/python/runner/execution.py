"""선택된 풀이와 데이터셋 실행 순서, 첫 assert 실패 및 실행 오류의 응답 구성을 담당합니다."""

import ast
import contextlib
import time
import traceback

from .source_analysis import instrument_solutions, AssertInstrumenter
from .execution_environment import (
    LimitedWriter, MAX_CAPTURE_CHARS, install_prelude,
    install_object_helpers, create_execution_namespace,
)


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
