"""Exercises AwsBackend's orchestration (provision/teardown/status control flow) with the
subprocess/network-touching parts of terraform_manager and credentials mocked out -- no real
`terraform` subprocess, no real AWS call. workspace_dir() is redirected to pytest's tmp_path (not
mocked away) so sync_module_files/restore_state/checkpoint_state run for real against a throwaway
directory instead of leaking real folders into automation/runtime/ as a side effect of running
tests -- those functions are cheap, pure filesystem operations already covered by their own tests
in test_terraform_manager.py.

A genuine `terraform apply` against live AWS stays deliberately untested here (and unexercised
anywhere in this codebase): that only ever happens on the user's own separate, explicit go-ahead
with real credentials, never as part of building or verifying this feature."""

from unittest.mock import patch

import mongomock
import pytest
from fastapi import HTTPException

from ..credentials import CredentialValidationError
from ..models import AwsCredential, BuildfarmEdge, BuildfarmNode, NodePosition, ProvisionRequest
from ..terraform_manager import TerraformError
from .aws_backend import AwsBackend

CRED = AwsCredential(
    roleArn="arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner",
    externalId="ext-123",
    bootstrapAccessKeyId="AKIA",
    bootstrapSecretAccessKey="secret",
    region="us-east-1",
    allowedIngressCidrs=["203.0.113.5/32"],
)

FAKE_SESSION = {"accessKeyId": "ASID", "secretAccessKey": "SECRET", "sessionToken": "TOKEN"}


def _node(node_id: str, node_type: str, config: dict | None = None) -> BuildfarmNode:
    return BuildfarmNode(id=node_id, type=node_type, position=NodePosition(x=0, y=0), config=config or {})


def _request(workspace_id: str = "ws1", aws_credential: AwsCredential | None = CRED) -> ProvisionRequest:
    nodes = [
        _node("server-1", "server"),
        _node("worker-1", "worker", {"instanceType": "c6i.large"}),
        _node("redis-1", "redis"),
    ]
    edges = [
        BuildfarmEdge(id="e1", source="server-1", target="worker-1"),
        BuildfarmEdge(id="e2", source="server-1", target="redis-1"),
    ]
    return ProvisionRequest(workspaceId=workspace_id, provider="aws", nodes=nodes, edges=edges, awsCredential=aws_credential)


@pytest.fixture
def db():
    return mongomock.MongoClient().db


@pytest.fixture(autouse=True)
def _workspace_dir_under_tmp_path(tmp_path):
    with patch("app.backends.aws_backend.terraform_manager.workspace_dir", return_value=tmp_path):
        yield tmp_path


def test_provision_rejects_a_request_with_no_aws_credential(db):
    backend = AwsBackend()
    with pytest.raises(HTTPException) as exc_info:
        backend.provision(_request(aws_credential=None), db)
    assert exc_info.value.status_code == 400


def test_provision_saves_running_status_with_host_and_instance_type_from_the_worker_node(db):
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION) as assume_role,
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value="c3RhdGU="),
        patch(
            "app.backends.aws_backend.terraform_manager.outputs",
            return_value={
                "host": {"value": "1.2.3.4"},
                "server_instance_id": {"value": "i-server123"},
                "cache_instance_id": {"value": None},
            },
        ),
    ):
        instance = backend.provision(_request(), db)

    apply.assert_called_once()
    tfvars = apply.call_args[0][1]
    assert tfvars["worker_instance_type"] == "c6i.large"  # from the Worker node's config.instanceType
    assert tfvars["allowed_ingress_cidrs"] == ["203.0.113.5/32"]
    assume_role.assert_called_once()

    assert instance["status"] == "running"
    assert instance["host"] == "1.2.3.4"
    assert instance["awsResourceIds"] == ["i-server123"]
    assert instance["provider"] == "aws"
    # Internal Terraform bookkeeping never leaks into the response the frontend eventually sees.
    assert "terraformState" not in instance
    assert "terraformVars" not in instance


def test_provision_falls_back_to_the_default_instance_type_when_the_worker_node_has_none(db):
    backend = AwsBackend()
    request = _request()
    request.nodes[1].config = {}  # worker node, no instanceType set
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(request, db)
    assert apply.call_args[0][1]["worker_instance_type"] == "m6i.large"
    assert apply.call_args[0][1]["server_instance_type"] == "m6i.large"


def test_provision_defaults_worker_min_max_to_replicas_when_unset(db):
    backend = AwsBackend()
    request = _request()
    request.nodes[1].config["replicas"] = 3  # worker node, no minReplicas/maxReplicas
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(request, db)
    tfvars = apply.call_args[0][1]
    assert tfvars["worker_desired"] == 3
    assert tfvars["worker_min"] == 3
    assert tfvars["worker_max"] == 3


def test_provision_respects_explicit_worker_min_max(db):
    backend = AwsBackend()
    request = _request()
    request.nodes[1].config.update({"replicas": 2, "minReplicas": 1, "maxReplicas": 5})
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(request, db)
    tfvars = apply.call_args[0][1]
    assert tfvars["worker_desired"] == 2
    assert tfvars["worker_min"] == 1
    assert tfvars["worker_max"] == 5


def test_provision_with_no_cache_node_disables_the_cache_tier_entirely(db):
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(_request(), db)
    tfvars = apply.call_args[0][1]
    assert tfvars["enable_cache"] is False
    assert tfvars["enable_s3_cache"] is False
    assert tfvars["cache_user_data"] == ""


def test_provision_with_local_cache_tier_enables_cache_but_not_s3(db):
    backend = AwsBackend()
    request = _request()
    request.nodes.append(_node("cache-1", "cache", {"sizeGb": 10, "remoteCacheTier": "local"}))
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(request, db)
    tfvars = apply.call_args[0][1]
    assert tfvars["enable_cache"] is True
    assert tfvars["enable_s3_cache"] is False
    assert tfvars["cache_user_data"] != ""
    assert "__S3_BUCKET_NAME__" not in tfvars["cache_user_data"]


def test_provision_with_s3_cache_tier_enables_both_flags_and_embeds_the_bucket_placeholder(db):
    backend = AwsBackend()
    request = _request()
    request.nodes.append(
        _node("cache-1", "cache", {"sizeGb": 10, "remoteCacheTier": "s3", "instanceType": "c6i.large"})
    )
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        backend.provision(request, db)
    tfvars = apply.call_args[0][1]
    assert tfvars["enable_cache"] is True
    assert tfvars["enable_s3_cache"] is True
    assert tfvars["cache_instance_type"] == "c6i.large"
    assert "__S3_BUCKET_NAME__" in tfvars["cache_user_data"]
    # The Terraform placeholder, not a real resolved value -- Python never resolves it (main.tf's
    # replace() does, at apply time, once the real bucket exists).
    assert "__REMOTE_CACHE_GRPC_TARGET__" in tfvars["worker_user_data"]


def test_provision_resource_ids_include_cache_instance_when_present(db):
    backend = AwsBackend()
    request = _request()
    request.nodes.append(_node("cache-1", "cache", {"sizeGb": 10, "remoteCacheTier": "local"}))
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply"),
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch(
            "app.backends.aws_backend.terraform_manager.outputs",
            return_value={
                "host": {"value": "1.2.3.4"},
                "server_instance_id": {"value": "i-server123"},
                "cache_instance_id": {"value": "i-cache456"},
            },
        ),
    ):
        instance = backend.provision(request, db)
    assert instance["awsResourceIds"] == ["i-server123", "i-cache456"]


def test_provision_persists_the_full_aws_topology_for_the_architecture_diagram(db):
    """Feeds the Designer's AWS architecture diagram (AwsTopology in shared-types) -- every
    Terraform output outputs.tf defines should survive into the saved instance, not just the 3
    values provision() separately reads for host/awsResourceIds."""
    backend = AwsBackend()
    request = _request()
    request.nodes.append(_node("cache-1", "cache", {"sizeGb": 10, "remoteCacheTier": "s3"}))
    full_outputs = {
        "host": {"value": "1.2.3.4"},
        "server_instance_id": {"value": "i-server123"},
        "cache_instance_id": {"value": "i-cache456"},
        "vpc_id": {"value": "vpc-abc"},
        "vpc_cidr": {"value": "10.90.0.0/16"},
        "public_subnet_id": {"value": "subnet-pub"},
        "public_subnet_cidr": {"value": "10.90.1.0/24"},
        "private_subnet_id": {"value": "subnet-priv"},
        "private_subnet_cidr": {"value": "10.90.2.0/24"},
        "internet_gateway_id": {"value": "igw-1"},
        "nat_gateway_id": {"value": "nat-1"},
        "nat_gateway_public_ip": {"value": "5.6.7.8"},
        "security_group_id": {"value": "sg-server"},
        "internal_security_group_id": {"value": "sg-internal"},
        "worker_launch_template_id": {"value": "lt-1"},
        "worker_asg_name": {"value": "croft-ws1-worker"},
        "redis_endpoint": {"value": "croft-ws1-redis.cache.amazonaws.com"},
        "cache_instance_private_ip": {"value": "10.90.2.50"},
        "cache_bucket_name": {"value": "croft-ws1-cache"},
        "cache_iam_role_arn": {"value": "arn:aws:iam::123456789012:role/croft-ws1-cache"},
        "redis_replication_group_id": {"value": "croft-ws1-redis"},
    }
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply"),
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value=full_outputs),
    ):
        instance = backend.provision(request, db)

    assert instance["awsTopology"] == {
        "vpcId": "vpc-abc",
        "vpcCidr": "10.90.0.0/16",
        "publicSubnetId": "subnet-pub",
        "publicSubnetCidr": "10.90.1.0/24",
        "privateSubnetId": "subnet-priv",
        "privateSubnetCidr": "10.90.2.0/24",
        "internetGatewayId": "igw-1",
        "natGatewayId": "nat-1",
        "natGatewayPublicIp": "5.6.7.8",
        "serverSecurityGroupId": "sg-server",
        "internalSecurityGroupId": "sg-internal",
        "serverInstanceId": "i-server123",
        "workerLaunchTemplateId": "lt-1",
        "workerAsgName": "croft-ws1-worker",
        "redisEndpoint": "croft-ws1-redis.cache.amazonaws.com",
        "cacheInstanceId": "i-cache456",
        "cacheInstancePrivateIp": "10.90.2.50",
        "cacheBucketName": "croft-ws1-cache",
        "cacheIamRoleArn": "arn:aws:iam::123456789012:role/croft-ws1-cache",
        "loadBalancerDnsName": "1.2.3.4",  # same output as host -- Server's NLB DNS name (Phase 0)
        "redisReplicationGroupId": "croft-ws1-redis",
    }


def test_provision_checkpoints_partial_state_and_marks_error_when_apply_fails(db):
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch(
            "app.backends.aws_backend.terraform_manager.apply",
            side_effect=TerraformError("boom", stderr="AWS said no"),
        ),
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value="cGFydGlhbA=="),
    ):
        with pytest.raises(HTTPException) as exc_info:
            backend.provision(_request(), db)

    assert exc_info.value.status_code == 502
    saved = db.buildfarm_instances.find_one({"workspaceId": "ws1"})
    assert saved["status"] == "error"
    assert saved["terraformState"] == "cGFydGlhbA=="  # partial state preserved, not discarded


def test_provision_reports_a_credential_error_without_ever_calling_terraform(db):
    backend = AwsBackend()
    with (
        patch(
            "app.backends.aws_backend.credentials.assume_role",
            side_effect=CredentialValidationError("AccessDenied"),
        ),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
    ):
        with pytest.raises(HTTPException) as exc_info:
            backend.provision(_request(), db)
    assert exc_info.value.status_code == 400
    apply.assert_not_called()


def test_teardown_is_a_tolerant_noop_when_nothing_was_ever_applied(db):
    backend = AwsBackend()
    with patch("app.backends.aws_backend.credentials.assume_role") as assume_role:
        instance = backend.teardown("ws-never-provisioned", db, aws_credential=CRED)
    assert instance["status"] == "stopped"
    assume_role.assert_not_called()


def test_teardown_requires_a_credential_when_state_exists(db):
    db.buildfarm_instances.insert_one({"workspaceId": "ws1", "terraformState": "c3RhdGU="})
    backend = AwsBackend()
    with pytest.raises(HTTPException) as exc_info:
        backend.teardown("ws1", db, aws_credential=None)
    assert exc_info.value.status_code == 400


def test_teardown_reuses_the_stored_vars_from_the_last_successful_apply(db):
    stored_vars = {"region": "us-east-1", "instance_type": "c6i.large", "allowed_ingress_cidrs": ["1.2.3.4/32"]}
    db.buildfarm_instances.insert_one({"workspaceId": "ws1", "terraformState": "c3RhdGU=", "terraformVars": stored_vars})
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.destroy") as destroy,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
    ):
        instance = backend.teardown("ws1", db, aws_credential=CRED)

    destroy.assert_called_once()
    assert destroy.call_args[0][1] == stored_vars
    assert instance["status"] == "stopped"
    assert instance["host"] is None
    # Explicitly cleared to {} (not omitted) -- mirrors awsResourceIds' own []-clears convention,
    # so the Designer's architecture diagram sees "nothing live" rather than stale ids/endpoints
    # from before teardown.
    assert instance["awsTopology"] == {}


def test_teardown_falls_back_to_a_complete_tfvars_shape_when_none_was_ever_persisted(db):
    # A workspace whose terraformVars predates this field existing (or was never saved for some
    # other reason) must still be tearable-down -- the fallback dict needs every key main.tf's
    # variables.tf requires, not just the ones that existed in the single-instance design.
    db.buildfarm_instances.insert_one({"workspaceId": "ws1", "terraformState": "c3RhdGU="})
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.destroy") as destroy,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
    ):
        backend.teardown("ws1", db, aws_credential=CRED)
    tfvars = destroy.call_args[0][1]
    for key in (
        "region", "workspace_id", "allowed_ingress_cidrs", "grpc_port",
        "server_instance_type", "server_user_data",
        "worker_instance_type", "worker_min", "worker_max", "worker_desired", "worker_user_data",
        "redis_node_type", "enable_cache", "enable_s3_cache", "cache_instance_type",
        "cache_grpc_port", "cache_user_data",
    ):
        assert key in tfvars, f"fallback tfvars missing {key!r}"


def test_status_never_leaks_terraform_state_or_vars_on_any_return_path(db):
    """main.py's /status route deliberately passes the *unfiltered* document to status() (see
    AwsBackend.status()'s docstring) since the drift-check needs terraformState -- every return
    path here must strip it back out before it flows on to the API response, or a multi-KB state
    blob (and the exact vars a workspace was applied with) would round-trip all the way to the
    browser on every status poll."""
    backend = AwsBackend()
    stored_vars = {"region": "us-east-1"}

    # Path 1: no state yet.
    existing_no_state = {"workspaceId": "ws1", "status": "provisioning", "terraformVars": stored_vars}
    result = backend.status("ws1", db, existing_no_state)
    assert "terraformState" not in result
    assert "terraformVars" not in result

    # Path 2: state exists, host unchanged after a live refresh (no save_instance call, so this is
    # the one most likely to leak the raw dict straight through).
    existing_with_state = {
        "workspaceId": "ws1", "status": "running", "host": "1.2.3.4",
        "terraformState": "c3RhdGU=", "terraformVars": stored_vars,
    }
    with (
        patch("app.backends.aws_backend.terraform_manager.sync_module_files"),
        patch("app.backends.aws_backend.terraform_manager.restore_state"),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch(
            "app.backends.aws_backend.terraform_manager.outputs",
            return_value={"host": {"value": "1.2.3.4"}},
        ),
    ):
        result = backend.status("ws1", db, existing_with_state)
    assert "terraformState" not in result
    assert "terraformVars" not in result

    # Path 3: a transient terraform read failure -- tolerated, returns the existing doc as-is.
    with (
        patch("app.backends.aws_backend.terraform_manager.sync_module_files"),
        patch("app.backends.aws_backend.terraform_manager.restore_state"),
        patch("app.backends.aws_backend.terraform_manager.init", side_effect=TerraformError("boom")),
    ):
        result = backend.status("ws1", db, existing_with_state)
    assert "terraformState" not in result
    assert "terraformVars" not in result


def _status_with_no_host_output(existing: dict, db) -> dict:
    backend = AwsBackend()
    with (
        patch("app.backends.aws_backend.terraform_manager.sync_module_files"),
        patch("app.backends.aws_backend.terraform_manager.restore_state"),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.outputs", return_value={}),
    ):
        return backend.status("ws1", db, existing)


def test_status_flips_to_stopped_when_a_previously_running_instance_is_gone(db):
    # The real drift-detection case: an instance Croft believed was running was terminated
    # outside Croft (e.g. the AWS console), and a re-check finds no host in state anymore.
    existing = {"workspaceId": "ws1", "status": "running", "host": "1.2.3.4", "terraformState": "c3RhdGU="}
    result = _status_with_no_host_output(existing, db)
    assert result["status"] == "stopped"
    assert result["host"] is None


def test_status_does_not_overwrite_an_error_state_when_the_instance_never_existed(db):
    # Regression: a failed/partial apply (e.g. died creating the security group, before the
    # instance ever existed) has no host in state either -- that must NOT be treated the same as
    # "a running instance disappeared." Overwriting status="error"/lastError with a bare "stopped"
    # erases the only record of what actually went wrong, which is exactly what happened on a
    # live account before this fix: every status poll silently erased the real failure.
    existing = {
        "workspaceId": "ws1", "status": "error", "host": None,
        "lastError": "creating Security Group: InvalidParameterValue", "terraformState": "c3RhdGU=",
    }
    result = _status_with_no_host_output(existing, db)
    assert result["status"] == "error"
    assert result["lastError"] == "creating Security Group: InvalidParameterValue"


def test_status_does_not_flip_a_provisioning_instance_to_stopped_either(db):
    existing = {"workspaceId": "ws1", "status": "provisioning", "host": None, "terraformState": "c3RhdGU="}
    result = _status_with_no_host_output(existing, db)
    assert result["status"] == "provisioning"


def test_full_topology_provision_then_teardown_is_internally_consistent(db):
    """End-to-end mocked integration pass: a complete Server+Worker+Redis+Cache(tier=both)
    topology through provision(), asserting every rendered artifact is internally consistent with
    the others, then teardown() against the exact same persisted state -- still zero real
    terraform subprocess, zero real AWS call (see the module docstring)."""
    request = _request(workspace_id="full-topology-ws")
    request.nodes[1].config.update({"replicas": 2, "minReplicas": 1, "maxReplicas": 6})  # worker
    request.nodes.append(
        _node("cache-1", "cache", {"sizeGb": 25, "remoteCacheTier": "both", "instanceType": "c6i.large"})
    )

    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.apply") as apply,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value="c3RhdGU="),
        patch(
            "app.backends.aws_backend.terraform_manager.outputs",
            return_value={
                "host": {"value": "203.0.113.9"},
                "server_instance_id": {"value": "i-server789"},
                "cache_instance_id": {"value": "i-cache789"},
            },
        ),
    ):
        instance = AwsBackend().provision(request, db)

    tfvars = apply.call_args[0][1]

    # Internal consistency: the worker's rendered config references the exact GRPC port the cache
    # instance's own compose file was told to listen on.
    assert f":{tfvars['cache_grpc_port']}" in tfvars["worker_user_data"]
    assert f"--grpc_address=0.0.0.0:{tfvars['cache_grpc_port']}" in tfvars["cache_user_data"]
    # S3 ("both") -- the bucket placeholder appears in the cache instance's own compose, ready for
    # Terraform's replace() to resolve once the real bucket exists.
    assert "__S3_BUCKET_NAME__" in tfvars["cache_user_data"]
    assert "--s3.auth_method=iam_role" in tfvars["cache_user_data"]
    # ASG bounds threaded through correctly.
    assert tfvars["worker_desired"] == 2
    assert tfvars["worker_min"] == 1
    assert tfvars["worker_max"] == 6
    assert tfvars["cache_instance_type"] == "c6i.large"

    assert instance["status"] == "running"
    assert instance["host"] == "203.0.113.9"
    assert instance["awsResourceIds"] == ["i-server789", "i-cache789"]

    saved = db.buildfarm_instances.find_one({"workspaceId": "full-topology-ws"})
    assert saved["terraformVars"] == tfvars

    # Teardown reuses exactly this persisted state/tfvars -- no recomputation from the (possibly
    # since-edited) credential.
    with (
        patch("app.backends.aws_backend.credentials.assume_role", return_value=FAKE_SESSION),
        patch("app.backends.aws_backend.terraform_manager.init"),
        patch("app.backends.aws_backend.terraform_manager.destroy") as destroy,
        patch("app.backends.aws_backend.terraform_manager.checkpoint_state", return_value=None),
    ):
        torn_down = AwsBackend().teardown("full-topology-ws", db, aws_credential=CRED)

    assert destroy.call_args[0][1] == tfvars
    assert torn_down["status"] == "stopped"
    assert torn_down["host"] is None
