import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_public_data_config.py"


def run_check(env_file: Path, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    for key in (
        "DATA_GO_KR_SERVICE_KEY",
        "VWORLD_API_KEY",
        "VWORLD_API_DOMAIN",
        "JUSO_API_KEY",
        "LAW_GO_KR_OC",
    ):
        env.pop(key, None)
    env.update(extra_env or {})
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--env-file", str(env_file)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )


def test_reports_set_without_exposing_secret(tmp_path: Path):
    secret = "encoded-secret-value%2Bdo-not-print"
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"DATA_GO_KR_SERVICE_KEY={secret}\nVWORLD_API_KEY=vworld-secret\n",
        encoding="utf-8",
    )

    result = run_check(env_file)

    assert result.returncode == 0
    assert "DATA_GO_KR_SERVICE_KEY: SET" in result.stdout
    assert "VWORLD_API_KEY: SET" in result.stdout
    assert "VWORLD_API_DOMAIN: MISSING" in result.stdout
    assert "JUSO_API_KEY: MISSING" in result.stdout
    assert "LAW_GO_KR_OC: MISSING" in result.stdout
    assert secret not in result.stdout
    assert "vworld-secret" not in result.stdout
    assert "15126468" in result.stdout


def test_missing_common_key_returns_nonzero(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text("JUSO_API_KEY=juso-secret\n", encoding="utf-8")

    result = run_check(env_file)

    assert result.returncode == 1
    assert "DATA_GO_KR_SERVICE_KEY: MISSING" in result.stdout
    assert "JUSO_API_KEY: SET" in result.stdout
    assert "juso-secret" not in result.stdout


def test_environment_overrides_empty_file_value(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text("DATA_GO_KR_SERVICE_KEY=\n", encoding="utf-8")

    result = run_check(env_file, {"DATA_GO_KR_SERVICE_KEY": "runtime-secret"})

    assert result.returncode == 0
    assert "DATA_GO_KR_SERVICE_KEY: SET" in result.stdout
    assert "runtime-secret" not in result.stdout


def test_separate_law_and_vworld_credentials_are_reported_without_values(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "DATA_GO_KR_SERVICE_KEY=data-secret\n"
        "VWORLD_API_KEY=vworld-secret\n"
        "VWORLD_API_DOMAIN=https://roomio.example\n"
        "LAW_GO_KR_OC=roomio-oc\n",
        encoding="utf-8",
    )

    result = run_check(env_file)

    assert result.returncode == 0
    assert "VWORLD_API_DOMAIN: SET" in result.stdout
    assert "LAW_GO_KR_OC: SET" in result.stdout
    assert "roomio.example" not in result.stdout
    assert "roomio-oc" not in result.stdout
    assert "15057358" not in result.stdout
