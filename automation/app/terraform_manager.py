"""Owns the per-workspace Terraform working directory and every `terraform` subprocess call --
directly parallel to docker_manager.py, but for AWS resource lifecycle instead of the local Docker
daemon. See AwsBackend (backends/aws_backend.py) for how these are used.

State storage: local terraform.tfstate, checkpointed into MongoDB as a base64 blob on the
workspace's buildfarm_instances document (restore_state before every operation, checkpoint_state
after). Chosen over a customer-provisioned S3+DynamoDB backend (bootstrapping chicken-and-egg
problem) and over a custom Mongo-backed state-locking server (buys multi-writer locking this
single-writer-per-workspace system doesn't need) -- see the plan's "State storage" reasoning.
"""

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

from .settings import settings

MODULE_DIR = Path(__file__).resolve().parent.parent / "terraform" / "buildfarm-aws"
_MODULE_FILES = ("main.tf", "variables.tf", "outputs.tf", "versions.tf")


class TerraformError(Exception):
    def __init__(self, message: str, stdout: str = "", stderr: str = ""):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr


def workspace_dir(workspace_id: str) -> Path:
    base = Path(__file__).resolve().parent.parent / settings.runtime_dir
    path = base / f"workspace-{workspace_id}" / "terraform"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sync_module_files(path: Path) -> None:
    """Copies the shared module's .tf files into this workspace's own directory -- not a symlink,
    so each workspace's `terraform init`/`.terraform.lock.hcl` stay fully independent (they still
    share the image-baked provider plugin cache via TF_PLUGIN_CACHE_DIR, so this stays cheap)."""
    for name in _MODULE_FILES:
        shutil.copyfile(MODULE_DIR / name, path / name)


def restore_state(path: Path, state_b64: str | None) -> None:
    """Writes the workspace's last-known terraform.tfstate to disk before any operation, so
    Terraform sees the resources it already created rather than trying to recreate them. A
    brand-new workspace has no prior state (state_b64 is None) -- Terraform starts fresh."""
    state_file = path / "terraform.tfstate"
    if state_b64:
        state_file.write_bytes(base64.b64decode(state_b64))
    elif state_file.exists():
        state_file.unlink()


def checkpoint_state(path: Path) -> str | None:
    """Reads the on-disk state back out for persisting into Mongo -- called after every
    apply/destroy, including on failure (a partial apply still writes real resources into the
    state file incrementally), so a retry or a later teardown never loses track of what actually
    exists in AWS."""
    state_file = path / "terraform.tfstate"
    if not state_file.exists():
        return None
    return base64.b64encode(state_file.read_bytes()).decode()


def build_env(session_credentials: dict) -> dict:
    """Temporary STS session credentials, passed to the terraform subprocess only as environment
    variables -- never written to a .tfvars file, never in a .tf file, so they never land in
    Terraform state either (see the plan's credentials section)."""
    env = os.environ.copy()
    env["AWS_ACCESS_KEY_ID"] = session_credentials["accessKeyId"]
    env["AWS_SECRET_ACCESS_KEY"] = session_credentials["secretAccessKey"]
    env["AWS_SESSION_TOKEN"] = session_credentials["sessionToken"]
    env["TF_IN_AUTOMATION"] = "1"
    return env


def _run(path: Path, args: list[str], env: dict, timeout: int) -> subprocess.CompletedProcess:
    cmd = ["terraform", *args]
    result = subprocess.run(cmd, cwd=path, capture_output=True, text=True, timeout=timeout, env=env)
    if result.returncode != 0:
        raise TerraformError(
            f"terraform {' '.join(args)} failed with exit code {result.returncode}",
            stdout=result.stdout,
            stderr=result.stderr,
        )
    return result


def init(path: Path, env: dict) -> None:
    _run(path, ["init", "-input=false", "-no-color"], env, timeout=180)


def _write_tfvars(path: Path, tfvars: dict) -> None:
    (path / "terraform.tfvars.json").write_text(json.dumps(tfvars))


def apply(path: Path, tfvars: dict, env: dict) -> None:
    _write_tfvars(path, tfvars)
    _run(
        path,
        ["apply", "-auto-approve", "-no-color", "-input=false", "-var-file=terraform.tfvars.json"],
        env,
        timeout=900,
    )


def destroy(path: Path, tfvars: dict, env: dict) -> None:
    _write_tfvars(path, tfvars)
    _run(
        path,
        ["destroy", "-auto-approve", "-no-color", "-input=false", "-var-file=terraform.tfvars.json"],
        env,
        timeout=600,
    )


def outputs(path: Path, env: dict) -> dict:
    result = _run(path, ["output", "-json", "-no-color"], env, timeout=30)
    return json.loads(result.stdout) if result.stdout.strip() else {}
