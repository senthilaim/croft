import os

from fastapi import HTTPException
from pymongo.database import Database

from .. import credentials, render, terraform_manager
from ..credentials import CredentialValidationError
from ..models import AwsCredential, ProvisionRequest
from ..terraform_manager import TerraformError
from ..topology import InvalidTopologyError, parse_topology
from . import save_instance

DEFAULT_INSTANCE_TYPE = "m6i.large"  # smallest staging-catalog entry, see cost-estimator.ts
GRPC_PORT = 8980  # Buildfarm's own default; fixed rather than allocated -- each workspace gets
# its own dedicated instance, so there's no port-collision risk the way Docker's shared host has.


def _project_name(workspace_id: str) -> str:
    return f"workspace-{workspace_id}"


class AwsBackend:
    """Provisions one EC2 instance per workspace via the automation/terraform/buildfarm-aws
    module, running the exact same docker-compose stack DockerBackend does locally. See the plan's
    "Terraform integration" section for the full design; terraform_manager.py owns the actual
    subprocess/state-checkpoint mechanics this class calls into."""

    def provision(self, request: ProvisionRequest, db: Database) -> dict:
        if request.awsCredential is None:
            raise HTTPException(
                status_code=400, detail="Missing AWS credential for this provisioning request"
            )
        try:
            topology = parse_topology(request.nodes)
        except InvalidTopologyError as e:
            raise HTTPException(status_code=400, detail={"issues": e.issues})

        workspace_id = request.workspaceId
        cred = request.awsCredential

        save_instance(db, workspace_id, provider="aws", status="provisioning")

        config_yml = render.render_config_yml(topology)
        compose_yml = render.render_docker_compose_yml(
            topology, _project_name(workspace_id), GRPC_PORT, config_yml
        )
        user_data = render.render_aws_user_data(compose_yml)

        # Sized off the Worker node's instanceType -- the one instance this module creates runs
        # the whole stack, so it's sized for the resource-heavy role (Server/Redis ride along).
        instance_type = topology.worker.config.get("instanceType") or DEFAULT_INSTANCE_TYPE

        tf_dir = terraform_manager.workspace_dir(workspace_id)
        terraform_manager.sync_module_files(tf_dir)
        existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id})
        terraform_manager.restore_state(tf_dir, existing.get("terraformState") if existing else None)

        try:
            session = credentials.assume_role(
                cred.roleArn, cred.externalId, cred.bootstrapAccessKeyId, cred.bootstrapSecretAccessKey,
                cred.region, session_name=f"croft-provision-{workspace_id}",
            )
        except CredentialValidationError as e:
            instance = save_instance(db, workspace_id, provider="aws", status="error", last_error=str(e))
            raise HTTPException(status_code=400, detail={"message": str(e), "instance": instance})

        env = terraform_manager.build_env(session)
        terraform_manager.init(tf_dir, env)

        tfvars = {
            "region": cred.region,
            "workspace_id": workspace_id,
            "instance_type": instance_type,
            "allowed_ingress_cidrs": cred.allowedIngressCidrs,
            "grpc_port": GRPC_PORT,
            "user_data": user_data,
        }

        try:
            terraform_manager.apply(tf_dir, tfvars, env)
        except TerraformError as e:
            # A partial apply still writes real resources into the state file incrementally --
            # checkpoint it even on failure, so a retry or teardown never loses track of what
            # actually exists in AWS.
            state_b64 = terraform_manager.checkpoint_state(tf_dir)
            detail = f"{e}\n{e.stderr}".strip()
            instance = save_instance(
                db, workspace_id, provider="aws", status="error", last_error=detail,
                terraform_state=state_b64, terraform_vars=tfvars,
            )
            raise HTTPException(status_code=502, detail={"message": detail, "instance": instance})

        state_b64 = terraform_manager.checkpoint_state(tf_dir)
        tf_outputs = terraform_manager.outputs(tf_dir, env)
        host = tf_outputs.get("host", {}).get("value")
        instance_id = tf_outputs.get("instance_id", {}).get("value")

        # Reflects Terraform's own view (the instance exists) not the remote Docker daemon's --
        # confirming the compose stack inside it actually came up requires SSM/CloudWatch, out of
        # scope this release (see infra() below and the plan's "Out of scope" section).
        return save_instance(
            db, workspace_id, provider="aws", status="running", host=host,
            aws_resource_ids=[instance_id] if instance_id else [], grpc_port=GRPC_PORT,
            terraform_state=state_b64, terraform_vars=tfvars,
        )

    def teardown(self, workspace_id: str, db: Database, aws_credential: AwsCredential | None = None) -> dict:
        existing = db.buildfarm_instances.find_one({"workspaceId": workspace_id})
        state_b64 = existing.get("terraformState") if existing else None
        if not state_b64:
            # Nothing was ever actually applied (e.g. provision failed before any resource
            # existed) -- tolerant no-op, matching DockerBackend's "already gone" behavior.
            return save_instance(db, workspace_id, provider="aws", status="stopped")

        if aws_credential is None:
            raise HTTPException(
                status_code=400, detail="Missing AWS credential to tear down this workspace's infrastructure"
            )

        tf_dir = terraform_manager.workspace_dir(workspace_id)
        terraform_manager.sync_module_files(tf_dir)
        terraform_manager.restore_state(tf_dir, state_b64)

        try:
            session = credentials.assume_role(
                aws_credential.roleArn, aws_credential.externalId, aws_credential.bootstrapAccessKeyId,
                aws_credential.bootstrapSecretAccessKey, aws_credential.region,
                session_name=f"croft-teardown-{workspace_id}",
            )
        except CredentialValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))

        env = terraform_manager.build_env(session)
        terraform_manager.init(tf_dir, env)

        # Reuse the exact var values the last successful apply used, rather than recomputing them
        # from the (possibly since-edited) CloudCredential -- Terraform should see no unrelated
        # diff right before it deletes everything.
        tfvars = existing.get("terraformVars") or {
            "region": aws_credential.region,
            "workspace_id": workspace_id,
            "instance_type": DEFAULT_INSTANCE_TYPE,
            "allowed_ingress_cidrs": aws_credential.allowedIngressCidrs,
            "grpc_port": GRPC_PORT,
            "user_data": "",
        }

        try:
            terraform_manager.destroy(tf_dir, tfvars, env)
        except TerraformError as e:
            state_b64 = terraform_manager.checkpoint_state(tf_dir)
            detail = f"{e}\n{e.stderr}".strip()
            instance = save_instance(
                db, workspace_id, provider="aws", status="error", last_error=detail,
                terraform_state=state_b64, terraform_vars=tfvars,
            )
            raise HTTPException(status_code=502, detail={"message": detail, "instance": instance})

        state_b64 = terraform_manager.checkpoint_state(tf_dir)
        return save_instance(
            db, workspace_id, provider="aws", status="stopped", host=None, aws_resource_ids=[],
            terraform_state=state_b64,
        )

    def status(self, workspace_id: str, db: Database, existing: dict) -> dict:
        # Read-only -- `terraform output` only parses the local state file, no AWS credentials or
        # network call needed (only apply/destroy/plan actually talk to the AWS API). Detects
        # drift if the instance was ever terminated outside Croft (e.g. the AWS console), but
        # otherwise this rarely changes between polls since only Croft's own Terraform touches
        # these resources.
        #
        # `existing` is the *unfiltered* buildfarm_instances document (main.py's /status route
        # reads it that way deliberately, since the check below needs terraformState) -- every
        # return path here must strip it back out via _public() before handing it back, the same
        # way save_instance()'s own projection already does for the paths that go through it.
        state_b64 = existing.get("terraformState")
        if not state_b64:
            return self._public(existing)

        tf_dir = terraform_manager.workspace_dir(workspace_id)
        terraform_manager.sync_module_files(tf_dir)
        terraform_manager.restore_state(tf_dir, state_b64)
        env = dict(os.environ)
        try:
            terraform_manager.init(tf_dir, env)
            tf_outputs = terraform_manager.outputs(tf_dir, env)
        except TerraformError:
            return self._public(existing)  # tolerate a transient read failure, don't flip to "error"

        host = tf_outputs.get("host", {}).get("value")
        if not host:
            return save_instance(
                db, workspace_id, provider="aws", status="stopped", host=None, aws_resource_ids=[],
                terraform_state=state_b64,
            )
        if host == existing.get("host"):
            return self._public(existing)
        return save_instance(
            db, workspace_id, provider="aws", status=existing.get("status") or "running", host=host,
            terraform_state=state_b64,
        )

    @staticmethod
    def _public(existing: dict) -> dict:
        return {k: v for k, v in existing.items() if k not in ("terraformState", "terraformVars")}

    def infra(self, workspace_id: str, existing: dict) -> dict:
        # Live CPU/mem metrics need SSM/CloudWatch polling -- explicitly out of scope this
        # release (see the plan). AWS workspaces show no infra charts for now rather than a
        # half-built one.
        del workspace_id, existing
        return {"containers": []}
