"""공공데이터 키 설정 상태를 값 노출 없이 점검한다."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Mapping


DATA_GO_KR_DATASETS = (
    ("15126468", "아파트 매매 실거래가"),
    ("15126474", "아파트 전월세 실거래가"),
    ("15058453", "공동주택 기본정보(K-apt)"),
    ("15134735", "건축HUB 건축물대장"),
    ("15098554", "TAGO 지하철정보"),
)

SEPARATE_KEYS = (
    ("VWORLD_API_KEY", "VWorld 지도·공간정보", "VWorld 개발자센터에서 별도 발급"),
    ("VWORLD_API_DOMAIN", "VWorld 허용 도메인", "VWorld 키 신청 시 등록한 서비스 도메인"),
    ("JUSO_API_KEY", "도로명주소 검색·좌표", "도로명주소 개발자센터에서 별도 발급"),
    ("LAW_GO_KR_OC", "현행법령 본문", "국가법령정보 공동활용에서 발급받은 OC 기관 ID"),
)


def load_env_file(path: Path) -> dict[str, str]:
    """단순 KEY=VALUE 형식만 읽는다. 값은 호출자에게 반환하지만 출력하지 않는다."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        values[key] = value.strip().strip('"').strip("'")
    return values


def merged_config(env_file: Path, environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """환경 변수가 .env보다 우선한다."""
    config = load_env_file(env_file)
    source = os.environ if environ is None else environ
    for key in ("DATA_GO_KR_SERVICE_KEY", *(item[0] for item in SEPARATE_KEYS)):
        if source.get(key):
            config[key] = source[key]
    return config


def is_set(config: Mapping[str, str], key: str) -> bool:
    return bool(config.get(key, "").strip())


def render_report(config: Mapping[str, str], env_file: Path) -> str:
    common_ready = is_set(config, "DATA_GO_KR_SERVICE_KEY")
    lines = [
        "중개메이트 공공데이터 설정 점검",
        f"환경 파일: {env_file} ({'FOUND' if env_file.exists() else 'MISSING'})",
        f"DATA_GO_KR_SERVICE_KEY: {'SET' if common_ready else 'MISSING'}",
        "",
        "공공데이터포털 활용신청 체크리스트",
        "  키가 SET이어도 데이터셋별 활용신청 승인은 마이페이지에서 별도로 확인해야 합니다.",
    ]
    for dataset_id, name in DATA_GO_KR_DATASETS:
        lines.append(f"- {dataset_id} {name}: {'KEY-SET / APPROVAL-VERIFY' if common_ready else 'KEY-MISSING'}")

    lines.extend(("", "별도 발급 키(공공데이터포털 키로 대체되지 않음)"))
    for key, name, note in SEPARATE_KEYS:
        lines.append(f"- {key}: {'SET' if is_set(config, key) else 'MISSING'} · {name} · {note}")

    lines.extend(
        (
            "",
            "이 명령은 키의 설정 여부만 표시하며 키 값은 출력하지 않습니다.",
        )
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=project_root / ".env")
    args = parser.parse_args(argv)
    config = merged_config(args.env_file)
    print(render_report(config, args.env_file))
    return 0 if is_set(config, "DATA_GO_KR_SERVICE_KEY") else 1


if __name__ == "__main__":
    raise SystemExit(main())
