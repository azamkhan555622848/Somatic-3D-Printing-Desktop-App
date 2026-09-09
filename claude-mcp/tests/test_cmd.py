import pytest
from coder3d_claude import cmd


@pytest.fixture(autouse=True)
def fake_claude(monkeypatch):
    monkeypatch.setattr(cmd, "claude_binary", lambda: "C:/fake/claude.exe")


def test_basic_cmd_shape():
    c = cmd.build_cmd()
    assert c[:2] == ["C:/fake/claude.exe", "-p"]
    assert ["--model", "opus"] == c[c.index("--model"):c.index("--model") + 2]
    assert ["--output-format", "json"] == c[c.index("--output-format"):c.index("--output-format") + 2]
    assert ["--permission-mode", "acceptEdits"] == c[c.index("--permission-mode"):c.index("--permission-mode") + 2]
    tools = c[c.index("--allowedTools") + 1]
    assert "Bash" not in tools and "Edit" in tools


def test_prompt_is_never_an_argv_item():
    # cmd.exe shims truncate argv at newlines; the prompt must ride stdin.
    c = cmd.build_cmd()
    assert all("\n" not in part for part in c)
    assert cmd.full_prompt("make a cube").endswith("Task:\n\nmake a cube")


def test_bash_opt_in_and_resume():
    c = cmd.build_cmd(allow_bash=True, resume="sess-123")
    assert "Bash" in c[c.index("--allowedTools") + 1]
    assert ["--resume", "sess-123"] == c[c.index("--resume"):c.index("--resume") + 2]


def test_mcp_config_included_only_when_file_exists(tmp_path):
    missing = cmd.build_cmd(mcp_config=str(tmp_path / "nope.json"))
    assert "--mcp-config" not in missing
    cfg = tmp_path / "mcp.json"
    cfg.write_text("{}")
    present = cmd.build_cmd(mcp_config=str(cfg))
    assert ["--mcp-config", str(cfg)] == present[present.index("--mcp-config"):present.index("--mcp-config") + 2]
    assert "mcp__cad" in present[present.index("--allowedTools") + 1]


def test_machine_owned_walls_present():
    c = cmd.build_cmd()
    deny = c[c.index("--disallowedTools") + 1]
    assert "Edit(**/provenance.json)" in deny
    assert "Read(**/.identity/**)" in deny
    assert all("\n" not in part for part in c)


def test_the_deny_list_matches_the_desktop_side_exactly():
    """The same walls are declared in three places (this list, the app's
    claude-chat-protocol.ts, and 3dcoder-config/opencode.jsonc). A wall that
    exists in only two of them is a wall with a door in it."""
    assert cmd.DENY_TOOLS == [
        "Edit(**/provenance.json)",
        "Write(**/provenance.json)",
        "Edit(**/meshes/qa/**)",
        "Write(**/meshes/qa/**)",
        "Edit(**/prints/qa/**)",
        "Write(**/prints/qa/**)",
        "Edit(**/.identity/**)",
        "Write(**/.identity/**)",
        "Read(**/.identity/**)",
    ]


def test_missing_binary_raises(monkeypatch):
    monkeypatch.setattr(cmd, "claude_binary", lambda: None)
    with pytest.raises(FileNotFoundError):
        cmd.build_cmd()


def test_research_tools_are_allowed_up_front():
    """A headless run cannot raise a permission prompt, so a tool that is not
    allowed here is unreachable for the whole turn."""
    c = cmd.build_cmd()
    allowed = c[c.index("--allowedTools") + 1].split(",")
    assert "WebSearch" in allowed
    assert "WebFetch" in allowed
