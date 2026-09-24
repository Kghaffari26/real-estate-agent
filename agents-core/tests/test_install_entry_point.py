"""End-to-end: install agents-core into a fresh temp project (as a local
path dependency) alongside a dummy agent that registers itself under the
`agents_core.agents` entry-point group, then run it through the real
`agents-run` console script — proving the packaging (not just the Python
API) actually works.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

AGENTS_CORE_ROOT = Path(__file__).resolve().parent.parent


def test_install_and_run_dummy_agent_via_entry_point(tmp_path):
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv not on PATH")

    project = tmp_path / "dummy-agent-repo"
    pkg_dir = project / "dummy_pkg"
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "__init__.py").write_text("")
    (pkg_dir / "agent.py").write_text(
        "from datetime import UTC, datetime\n"
        "from agents_core.schema import RunMeta\n\n\n"
        "def run(*, dry_run=False, apply=False, extra_args=None):\n"
        "    return RunMeta(agent='dummy', started_at=datetime.now(UTC), status='ok', "
        "data_changed=not dry_run)\n"
    )
    (project / "pyproject.toml").write_text(
        f'''[project]
name = "dummy-agent-repo"
version = "0.0.1"
requires-python = ">=3.11"
dependencies = ["agents-core"]

[project.entry-points."agents_core.agents"]
dummy = "dummy_pkg.agent:run"

[tool.uv.sources]
agents-core = {{ path = "{AGENTS_CORE_ROOT.as_posix()}" }}

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["dummy_pkg"]
'''
    )

    sync = subprocess.run([uv, "sync"], cwd=project, capture_output=True, text=True)
    assert sync.returncode == 0, f"uv sync failed:\nstdout={sync.stdout}\nstderr={sync.stderr}"

    result = subprocess.run(
        [uv, "run", "agents-run", "dummy", "--dry-run"],
        cwd=project,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"agents-run failed:\nstdout={result.stdout}\nstderr={result.stderr}"
    assert "status=ok" in result.stdout
    assert "data_changed=False" in result.stdout


def test_list_shows_registered_agent(tmp_path):
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("uv not on PATH")

    project = tmp_path / "dummy-agent-repo-2"
    pkg_dir = project / "dummy_pkg"
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "__init__.py").write_text("")
    (pkg_dir / "agent.py").write_text(
        "from datetime import UTC, datetime\n"
        "from agents_core.schema import RunMeta\n\n\n"
        "def run(*, dry_run=False, apply=False, extra_args=None):\n"
        "    return RunMeta(agent='dummy', started_at=datetime.now(UTC), status='ok')\n"
    )
    (project / "pyproject.toml").write_text(
        f'''[project]
name = "dummy-agent-repo-2"
version = "0.0.1"
requires-python = ">=3.11"
dependencies = ["agents-core"]

[project.entry-points."agents_core.agents"]
dummy = "dummy_pkg.agent:run"

[tool.uv.sources]
agents-core = {{ path = "{AGENTS_CORE_ROOT.as_posix()}" }}

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["dummy_pkg"]
'''
    )
    subprocess.run([uv, "sync"], cwd=project, capture_output=True, text=True, check=True)

    result = subprocess.run(
        [uv, "run", "agents-run", "--list"], cwd=project, capture_output=True, text=True, check=True
    )
    assert "dummy -> dummy_pkg.agent:run" in result.stdout
