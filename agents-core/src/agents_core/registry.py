"""Agent discovery via the `agents_core.agents` entry-point group.

Any installed distribution registers an agent by adding, in its own
pyproject.toml:

    [project.entry-points."agents_core.agents"]
    my_agent = "my_package.my_agent:run"

where `run` is a callable:

    def run(*, dry_run: bool = False, apply: bool = False,
             extra_args: list[str] | None = None) -> agents_core.schema.RunMeta: ...
"""

from __future__ import annotations

from collections.abc import Callable
from importlib.metadata import entry_points

GROUP = "agents_core.agents"


class AgentNotFound(RuntimeError):
    pass


def discover_agents() -> dict[str, str]:
    """`{agent name: "module:attr"}` for every registered agent."""
    return {ep.name: ep.value for ep in entry_points(group=GROUP)}


def load_agent(name: str) -> Callable[..., object]:
    matches = [ep for ep in entry_points(group=GROUP) if ep.name == name]
    if not matches:
        known = sorted(discover_agents())
        raise AgentNotFound(f"no agent named {name!r} registered under {GROUP!r}; known: {known}")
    return matches[0].load()
