"""stdin 요청 하나를 처리하는 별도 Python 프로세스입니다.

inspect는 AST만 읽고 사용자 소스를 실행하지 않습니다. run은 소스와 데이터셋을
실행하며 stdout에는 JSON 응답만 씁니다. 사용자 출력은 응답 필드에 따로 담습니다.
-I 옵션은 실행 환경을 격리하지만 사용자 코드의 보안 샌드박스는 아닙니다.
실행 허용 여부·시간 제한·프로세스 취소는 확장 호스트의 PythonRunnerService가 담당합니다."""

import importlib.util
import json
from pathlib import Path
import sys
import traceback


def load_runner():
    """-I의 검색 경로를 변경하지 않고 이 확장에 포함된 패키지만 절대 경로로 로드합니다.

    풀이 폴더(cwd)나 PYTHONPATH의 동명 파일에 의존하지 않습니다. 패키지 검색 경로를
    명시하므로 하위 모듈의 상대 import도 번들 디렉터리 안에서 해결됩니다.
    """
    package_path = Path(__file__).resolve().parent / "runner"
    spec = importlib.util.spec_from_file_location(
        "_leetcode_study_runner", package_path / "__init__.py",
        submodule_search_locations=[str(package_path)],
    )
    package = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = package
    spec.loader.exec_module(package)
    analysis = importlib.import_module(".source_analysis", spec.name)
    execution = importlib.import_module(".execution", spec.name)
    return analysis.inspect_source, execution.run


def main():
    """stdin의 JSON 요청 하나를 처리하고 stdout에 JSON 응답 하나를 기록합니다."""
    try:
        inspect_source, run = load_runner()
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
