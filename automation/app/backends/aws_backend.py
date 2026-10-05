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
DEFAULT_REDIS_NODE_TYPE = "cache.t3.micro"  # single-node, cheapest class -- not yet a UI choice
GRPC_PORT = 8980  # Buildfarm's own default; fixed rather than allocated -- each workspace gets
# its own dedicated Server instance, so there's no port-collision risk the way Docker's shared
# host has.
CACHE_GRPC_PORT = 9092  # bazel-remote's own port, distinct from Buildfarm's GRPC_PORT -- internal
# only, never published outside the VPC.


def _project_name(workspace_id: str) -> str:
    return f"workspace-{workspace_id}"


def _output(tf_outputs: dict, key: str) -> str | None:
    return tf_outputs.get(key, {}).get("value")


# Feeds the Designer's AWS architecture diagram (see AwsTopology in
# packages/shared-types/src/buildfarm-instance.ts) -- every key here has a matching Terraform
# output in outputs.tf. Kept as a flat dict (not a dataclass) since this is written straight into
# the Mongo doc by save_instance(), the same way every other AwsBackend field already is.
def _topology_from_outputs(tf_outputs: dict) -> dict:
    return {
        "vpcId": _output(tf_outputs, "vpc_id"),
        "vpcCidr": _output(tf_outputs, "vpc_cidr"),
        "publicSubnetId": _output(tf_outputs, "public_subnet_id"),
        "publicSubnetCidr": _output(tf_outputs, "public_subnet_cidr"),
        "privateSubnetId": _output(tf_outputs, "private_subnet_id"),
        "privateSubnetCidr": _output(tf_outputs, "private_subnet_cidr"),
        "internetGatewayId": _output(tf_outputs, "internet_gateway_id"),
        "natGatewayId": _output(tf_outputs, "nat_gateway_id"),
        "natGatewayPublicIp": _output(tf_outputs, "nat_gateway_public_ip"),
        "serverSecurityGroupId": _output(tf_outputs, "security_group_id"),
        "internalSecurityGroupId": _output(tf_outputs, "internal_security_group_id"),
        "serverInstanceId": _output(tf_outputs, "server_instance_id"),
        "workerLaunchTemplateId": _output(tf_outputs, "worker_launch_template_id"),
        "workerAsgName": _output(tf_outputs, "worker_asg_name"),
        "redisEndpoint": _output(tf_outputs, "redis_endpoint"),
        "cacheInstanceId": _output(tf_outputs, "cache_instance_id"),
        "cacheInstancePrivateIp": _output(tf_outputs, "cache_instance_private_ip"),
        "cacheBucketName": _output(tf_outputs, "cache_bucket_name"),
        "cacheIamRoleArn": _output(tf_outputs, "cache_iam_role_arn"),
        # Phase 0 (Multi-AZ HA): loadBalancerDnsName reuses the "host" output -- Server's NLB DNS
        # name IS host now, no separate Terraform output needed for the same value.
        "loadBalancerDnsName": _output(tf_outputs, "host"),
        "redisReplicationGroupId": _output(tf_outputs, "redis_replication_group_id"),
    }


class AwsBackend:
    """Provisions a decomposed, horizontally-scalable topology per workspace via the
    automation/terraform/buildfarm-aws module: a dedicated Server instance (the only client-facing
    endpoint), a Worker Auto Scaling Group, AWS-managed ElastiCache for the Redis backplane, and an
    optional dedicated cache instance (bazel-remote, optionally S3-backed) implementing the L2
    remote-cache tier behind Worker's own FILESYSTEM (L1) storage. See the plan's "Terraform
    integration" section for the full design; terraform_manager.py owns the actual
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
        project_name = _project_name(workspace_id)

        save_instance(db, workspace_id, provider="aws", status="provisioning")

        cache_cfg = topology.cache.config if topology.cache is not None else {}
        remote_cache_tier = cache_cfg.get("remoteCacheTier")
        enable_cache = remote_cache_tier is not None
        enable_s3_cache = remote_cache_tier in ("s3", "both")

        # One config.yml, deployed unchanged to both Server and Worker (see render_config_yml's
        # docstring) -- the placeholder tokens are literal text here, substituted by Terraform's
        # own replace() once the real resources exist (main.tf).
        config_yml = render.render_config_yml(
            topology,
            redis_uri="redis://__REDIS_ENDPOINT__:6379",
            remote_cache_grpc_target=(
                f"grpc://__REMOTE_CACHE_GRPC_TARGET__:{CACHE_GRPC_PORT}" if enable_cache else None
            ),
        )
        server_user_data = render.render_aws_user_data(
            render.render_aws_server_compose_yml(topology, project_name, GRPC_PORT, config_yml)
        )
        worker_user_data = render.render_aws_user_data(
            render.render_aws_worker_compose_yml(topology, project_name, config_yml)
        )
        cache_user_data = ""
        if enable_cache:
            cache_user_data = render.render_aws_user_data(
                render.render_bazel_remote_compose_yml(
                    project_name,
                    local_size_gb=int(cache_cfg.get("sizeGb", 10)),
                    s3_enabled=enable_s3_cache,
                    s3_bucket_name="__S3_BUCKET_NAME__",
                    region=cred.region,
                    grpc_port=CACHE_GRPC_PORT,
                )
            )

        # Server/Worker/Cache each size off their own node's instanceType -- no longer one shared
        # instance sized off Worker alone, now that each role is its own resource.
        server_instance_type = topology.server.config.get("instanceType") or DEFAULT_INSTANCE_TYPE
        worker_instance_type = topology.worker.config.get("instanceType") or DEFAULT_INSTANCE_TYPE
        cache_instance_type = cache_cfg.get("instanceType") or DEFAULT_INSTANCE_TYPE

        # replicas is the ASG's desired capacity; min/max default to it when unset, i.e. a fixed-size
        # group (today's behavior) is the zero-config default -- see WorkerNodeConfig's doc comment.
        worker_desired = int(topology.worker.config.get("replicas") or 1)
        worker_min = int(topology.worker.config.get("minReplicas") or worker_desired)
        worker_max = int(topology.worker.config.get("maxReplicas") or worker_desired)

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
            "allowed_ingress_cidrs": cred.allowedIngressCidrs,
            "grpc_port": GRPC_PORT,
            "server_instance_type": server_instance_type,
            "server_user_data": server_user_data,
            "worker_instance_type": worker_instance_type,
            "worker_min": worker_min,
            "worker_max": worker_max,
            "worker_desired": worker_desired,
            "worker_user_data": worker_user_data,
            "redis_node_type": DEFAULT_REDIS_NODE_TYPE,
            "enable_cache": enable_cache,
            "enable_s3_cache": enable_s3_cache,
            "cache_instance_type": cache_instance_type,
            "cache_grpc_port": CACHE_GRPC_PORT,
            "cache_user_data": cache_user_data,
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
        server_instance_id = tf_outputs.get("server_instance_id", {}).get("value")
        cache_instance_id = tf_outputs.get("cache_instance_id", {}).get("value")
        resource_ids = [rid for rid in (server_instance_id, cache_instance_id) if rid]

        # Reflects Terraform's own view (the resources exist) not live health -- confirming the
        # compose stacks inside them actually came up requires SSM/CloudWatch, out of scope this
        # release (see infra() below and the plan's "Out of scope" section). Multi-resource drift
        # (e.g. the ASG scaling to 0 healthy instances) isn't detected either -- status() still
        # only checks Server's own host, same accepted gap.
        return save_instance(
            db, workspace_id, provider="aws", status="running", host=host,
            aws_resource_ids=resource_ids, aws_topology=_topology_from_outputs(tf_outputs),
            grpc_port=GRPC_PORT, terraform_state=state_b64, terraform_vars=tfvars,
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
        # diff right before it deletes everything. The fallback dict below only matters for a
        # workspace whose terraformVars was never persisted (e.g. a record from before this field
        # existed) -- mechanical, low-risk, since the normal path always reuses the real dict.
        tfvars = existing.get("terraformVars") or {
            "region": aws_credential.region,
            "workspace_id": workspace_id,
            "allowed_ingress_cidrs": aws_credential.allowedIngressCidrs,
            "grpc_port": GRPC_PORT,
            "server_instance_type": DEFAULT_INSTANCE_TYPE,
            "server_user_data": "",
            "worker_instance_type": DEFAULT_INSTANCE_TYPE,
            "worker_min": 1,
            "worker_max": 1,
            "worker_desired": 1,
            "worker_user_data": "",
            "redis_node_type": DEFAULT_REDIS_NODE_TYPE,
            "enable_cache": False,
            "enable_s3_cache": False,
            "cache_instance_type": DEFAULT_INSTANCE_TYPE,
            "cache_grpc_port": CACHE_GRPC_PORT,
            "cache_user_data": "",
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
            aws_topology={}, terraform_state=state_b64,
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
            # Only a genuine drift signal when we previously believed this was running --
            # otherwise this is a failed/partial apply that never got as far as creating the
            # instance (e.g. it died on the security group), and silently flipping that to
            # "stopped" would erase the real status/lastError an "error" state was showing the
            # user, replacing a real failure with a misleading "nothing's wrong, nothing's here"
            # (a real bug: this is exactly what happened on a live account before this fix).
            if existing.get("status") != "running":
                return self._public(existing)
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
