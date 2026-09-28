import base64
import subprocess

import pytest

from . import terraform_manager


def test_checkpoint_state_returns_none_when_no_state_file_exists(tmp_path):
    assert terraform_manager.checkpoint_state(tmp_path) is None


def test_restore_then_checkpoint_round_trips_the_state_bytes(tmp_path):
    original = b'{"version": 4, "resources": []}'
    state_b64 = base64.b64encode(original).decode()

    terraform_manager.restore_state(tmp_path, state_b64)
    assert (tmp_path / "terraform.tfstate").read_bytes() == original

    checkpointed = terraform_manager.checkpoint_state(tmp_path)
    assert checkpointed == state_b64


def test_restore_state_with_none_removes_any_existing_state_file(tmp_path):
    (tmp_path / "terraform.tfstate").write_bytes(b"stale")
    terraform_manager.restore_state(tmp_path, None)
    assert not (tmp_path / "terraform.tfstate").exists()


def test_restore_state_with_none_is_a_noop_when_no_file_exists(tmp_path):
    terraform_manager.restore_state(tmp_path, None)  # must not raise
    assert not (tmp_path / "terraform.tfstate").exists()


def test_build_env_sets_sts_credentials_without_dropping_the_base_environment(monkeypatch):
    monkeypatch.setenv("PATH_MARKER_FOR_TEST", "still-here")
    env = terraform_manager.build_env(
        {"accessKeyId": "AKID", "secretAccessKey": "SECRET", "sessionToken": "TOKEN"}
    )
    assert env["AWS_ACCESS_KEY_ID"] == "AKID"
    assert env["AWS_SECRET_ACCESS_KEY"] == "SECRET"
    assert env["AWS_SESSION_TOKEN"] == "TOKEN"
    assert env["TF_IN_AUTOMATION"] == "1"
    assert env["PATH_MARKER_FOR_TEST"] == "still-here"


def test_sync_module_files_copies_every_module_file_into_the_workspace_dir(tmp_path):
    terraform_manager.sync_module_files(tmp_path)
    for name in ("main.tf", "variables.tf", "outputs.tf", "versions.tf"):
        copied = tmp_path / name
        assert copied.is_file()
        assert copied.read_text() == (terraform_manager.MODULE_DIR / name).read_text()


def test_workspace_dir_is_per_workspace_and_created_on_demand(tmp_path, monkeypatch):
    monkeypatch.setattr(terraform_manager.settings, "runtime_dir", str(tmp_path))
    path_a = terraform_manager.workspace_dir("ws-a")
    path_b = terraform_manager.workspace_dir("ws-b")
    assert path_a != path_b
    assert path_a.is_dir()
    assert path_a.name == "terraform"
    assert path_a.parent.name == "workspace-ws-a"


def test_read_log_tail_returns_empty_string_when_no_log_file_exists_yet(tmp_path):
    assert terraform_manager.read_log_tail(tmp_path) == ""


def test_read_log_tail_only_returns_the_last_n_lines(tmp_path):
    terraform_manager.log_path(tmp_path).write_text("\n".join(f"line {i}" for i in range(10)))
    tail = terraform_manager.read_log_tail(tmp_path, tail_lines=3)
    assert tail == "line 7\nline 8\nline 9"


def _fake_terraform_run(output: str, returncode: int):
    def fake_run(cmd, cwd, stdout, stderr, timeout, env):
        stdout.write(output)
        stdout.flush()
        return subprocess.CompletedProcess(cmd, returncode=returncode)

    return fake_run


def test_apply_writes_live_output_to_the_log_file_readable_while_it_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(
        terraform_manager.subprocess, "run", _fake_terraform_run("Creating vpc...\nvpc: Creation complete\n", 0)
    )
    terraform_manager.apply(tmp_path, {"region": "us-east-1"}, {})
    assert "vpc: Creation complete" in terraform_manager.read_log_tail(tmp_path)


def test_apply_raises_with_the_log_tail_as_stderr_on_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(
        terraform_manager.subprocess,
        "run",
        _fake_terraform_run("Error: UnauthorizedOperation\n", 1),
    )
    with pytest.raises(terraform_manager.TerraformError) as exc_info:
        terraform_manager.apply(tmp_path, {"region": "us-east-1"}, {})
    assert "UnauthorizedOperation" in exc_info.value.stderr


def test_apply_truncates_the_log_file_from_a_previous_run_before_writing(tmp_path, monkeypatch):
    terraform_manager.log_path(tmp_path).write_text("stale output from a previous apply\n")
    monkeypatch.setattr(terraform_manager.subprocess, "run", _fake_terraform_run("fresh output\n", 0))
    terraform_manager.apply(tmp_path, {"region": "us-east-1"}, {})
    tail = terraform_manager.read_log_tail(tmp_path)
    assert "fresh output" in tail
    assert "stale output" not in tail
