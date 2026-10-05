# Real-AWS validation runbook

For the day a real `terraform apply` runs against this module for the first time, against
the Multi-AZ Server-NLB/Worker-ASG/ElastiCache-replication-group/optional-cache-instance
topology (Phase 0 of the enterprise-RBE-parity roadmap). Nothing in this file has been
exercised against live AWS yet -- it's a checklist, not a report.

## Before you start

- [ ] A real AWS account, with a bootstrap IAM role created from the *current*
      `aws-policy-templates.ts` output (Settings > Cloud in the app generates this JSON --
      paste the **full** current policy, not an incremental diff; several real permission gaps
      this session were actually already-fixed code, hit because an old partial policy was
      still attached). Phase 0 added a `ServerLoadBalancer` statement (enumerated
      `elasticloadbalancing:*` actions, `Resource: '*'` -- NLB/target-group ARNs embed an id
      unknown before creation, same reasoning as EC2) and swapped `RedisElastiCache`'s
      `*CacheCluster*` actions for `*ReplicationGroup*` ones -- an old pasted policy predating
      this phase will fail on both.
- [ ] Budget alarm or a known $ limit you're comfortable with. Phase 0 roughly doubled the
      network/Redis cost: 2x NAT Gateway (~$0.045/hr each + per-GB processed, one per AZ now),
      ElastiCache is now 2 nodes not 1 (`cache.t3.micro` ~$0.017/hr each, for failover), plus
      an NLB (~$0.0225/hr + per-GB processed), plus 2-3x `m6i.large` ~$0.096/hr each for
      Server/Worker/optional-cache. Expect low-single-digit dollars for a short validation
      window, not pocket change if left running for days.
- [ ] Pick one throwaway workspace for this. Don't validate against a workspace you care about.

## Apply

- [ ] Trigger provisioning from the UI (Designer > Provision), not a manual `terraform apply`
      in a shell -- the real path is `ProvisioningController` -> `AwsBackend.provision()` ->
      `terraform_manager.apply()`, and that's the path worth validating end to end.
- [ ] Watch the live log panel (the async-provisioning feature built earlier this session) --
      confirm it actually streams progress rather than going silent until the end.
- [ ] Time it. `terraform_manager.apply()`'s timeout is 1200s (20 min). If a real apply gets
      anywhere close to that, the timeout needs to grow further, not just this once --
      see "If something goes wrong" below.

## What to specifically watch for (each one is a real, identified risk, not a guess)

- [ ] **Bootstrap script retries.** Server, Worker instances, and the cache instance all run
      `aws-user-data.sh.j2`, which now retries `curl get.docker.com` up to 10x/6s apart (added
      in this review -- previously a bare `set -e` with no retry). If any instance comes up
      without a working Docker daemon, check `/var/log/cloud-init-output.log` on that instance
      first -- that's exactly the failure mode this retry loop targets, and if it still happens
      the retry count/interval needs tuning, not a different mechanism.
  - [ ] Specifically confirm Worker ASG instances and the cache instance (both in the private
        subnet, reaching the internet only via the NAT Gateway) come up clean -- this is the
        case most likely to race against `aws_route_table_association.private`.
- [ ] **Worker ASG health.** Confirm `desired_capacity` instances actually reach "Healthy" in
      the ASG, not just "InService" -- an instance whose user_data silently failed still shows
      InService. Check whether Buildfarm's Worker process is actually registered against Redis
      (this is the one thing `AwsBackend.status()`/`infra()` do NOT check this release -- an
      accepted, documented gap, not an oversight).
- [ ] **Security-group assumption.** The `internal` SG gives Server ingress to Worker/Redis/
      Cache but nothing from outside the VPC reaches them directly -- this assumes Buildfarm's
      SHARD backend coordinates entirely via the Redis backplane, with no direct client/worker
      dial. Run an actual build through this topology and confirm it completes. If a build
      hangs or times out in a way that looks like a blocked connection *to* a worker
      specifically (not to Server), this assumption is the first thing to revisit.
- [ ] **ElastiCache endpoint substitution.** Confirm Server's and Worker's rendered
      `config.yml` on-instance actually contain ElastiCache's real address, not a literal
      `__REDIS_ENDPOINT__` string -- that would mean the Terraform `replace()` call didn't fire
      (e.g. a typo'd placeholder token drifting between `render.py` and `main.tf`).
- [ ] **Remote cache tier (if testing "s3" or "both").** Confirm the cache instance's
      bazel-remote container actually started with `--s3.auth_method=iam_role` working --
      i.e. the instance profile actually attached and S3 calls succeed, not just that the
      container is running. Check `docker logs` on that instance for S3 auth errors.
- [ ] **IAM scoping.** Confirm the NEW statements in `aws-policy-templates.ts`
      (`iam:CreateServiceLinkedRole` conditioned to autoscaling/elasticache,
      `CacheInstanceRole`/`PassCacheInstanceRoleToEc2Only`, `ServerLoadBalancer`,
      `RedisElastiCache`'s replication-group actions) are sufficient and nothing broader
      was needed -- if you had to add anything beyond what's already itemized there to make
      this apply succeed, that's a real gap in the policy template, fix it there (not by
      wildcarding).
- [ ] **NLB target health.** Confirm the target group shows Server's instance as `healthy`, not
      just that the NLB itself exists -- an NLB with an unhealthy/empty target group still shows
      as "active" and still resolves DNS, so this is easy to miss. `grpc://<nlb-dns-name>:8980`
      (the `host` output) only actually works once the target is healthy.

## Teardown

- [ ] Trigger teardown from the UI, not a manual `terraform destroy`.
- [ ] Confirm `terraform_manager.destroy()`'s 900s (15 min) timeout is enough in practice --
      ElastiCache cluster deletion and NAT Gateway/EIP release are the likely long poles.
- [ ] Confirm nothing is left behind: check the AWS console directly for this workspace's
      tagged resources (`Workspace = <workspace_id>`) after destroy reports success -- an EIP
      or a leftover ENI from a NAT Gateway that didn't fully release is the classic case.
- [ ] If destroy fails partway, do **not** manually delete resources in the console first.
      Re-run destroy (idempotent) so Terraform's own state stays authoritative; only fall back
      to manual cleanup if a second destroy attempt also fails, and note exactly which
      resource(s) got stuck.

## Rollback plan

- If apply fails partway through: the workspace's `status` should already reflect `error` with
  `lastError` set (fixed earlier this session -- a partial-apply error no longer gets silently
  overwritten back to "stopped" by the next status poll). Terraform's own state file has
  whatever it managed to create. Re-running provisioning from the UI re-applies against that
  same state (idempotent) rather than starting over -- try that first.
- If a resource is stuck or re-apply won't converge: `terraform destroy` against that
  workspace's persisted state is the clean path, even from a partial/broken apply --
  Terraform destroys whatever's actually in state, in dependency order, regardless of whether
  the apply that created it ever finished successfully.
- Nothing about this topology needs manual AWS-console surgery as the *first* response to a
  failure. Reach for the console only to verify, or after two failed Terraform-driven attempts.

## After a successful validation

- [ ] Note the real wall-clock time for apply and destroy here, so the timeouts above can be
      checked against a real number instead of an estimate.
- [ ] Note the real cost incurred, so the "Before you start" budget estimate can be corrected.
- [ ] If the worker-SG-zero-ingress assumption held up under a real build, that's worth
      promoting from "assumption, flagged" to "confirmed" in `main.tf`'s own comment.

## Chaos tests (Phase 0 -- a separate, later session, not part of the initial validation day)

Only attempt these once the basic apply/teardown cycle above has already succeeded cleanly --
chaos tests assume working infrastructure to break, not a shakedown of the apply itself. Ideally
a dedicated window, since the whole point is inducing real, user-visible failures on purpose.
None of this has been run yet -- these are the documented procedures to run, not results.

- [ ] **Kill a Worker instance mid-build.** Start a real build (so there's in-flight work), then
      from another terminal: `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names croft-<workspace_id>-worker --query 'AutoScalingGroups[0].Instances[*].InstanceId'`
      to find a target, then `aws ec2 terminate-instances --instance-ids <id>`.
      **Expect:** the ASG detects the termination and launches a replacement back to
      `desired_capacity` within a couple of minutes; Buildfarm's own scheduler reassigns the
      terminated worker's incomplete actions to a surviving worker, so the in-flight build either
      completes (possibly slower) or fails with a clear, specific error -- never hangs
      indefinitely waiting on a worker that's gone.
      **Verify recovery:** `aws autoscaling describe-auto-scaling-groups` shows the instance count
      back to `desired_capacity`; the build's own log/status reflects what actually happened, not
      a silent hang.
- [ ] **Force a Redis failover.** Use ElastiCache's own built-in test, not a manual kill --
      it's the safe, supported way to exercise this exact path:
      `aws elasticache test-failover --replication-group-id croft-<workspace_id>-redis --node-group-id 0001`.
      **Expect:** a brief interruption (commonly under a minute) while the primary/replica swap;
      `primary_endpoint_address` stays the same DNS name throughout (AWS re-points it, not a new
      endpoint), so nothing needs to re-read Terraform output or restart. Buildfarm's SHARD
      backend may show transient coordination errors during the swap -- expected, and the real
      finding here is whether it self-heals once failover completes or needs a manual restart (if
      it needs a restart, that's a gap worth fixing, not an acceptable outcome).
      **Verify recovery:** `aws elasticache describe-replication-groups --replication-group-id croft-<workspace_id>-redis`
      shows `NodeGroups[0].Status` back to `available`; a fresh build completes normally with no
      manual intervention on Server/Worker.
- [ ] **Kill a NAT Gateway's route, not the NAT Gateway itself.** Deleting the NAT Gateway
      resource directly is needlessly destructive to restore (a real delete + recreate). Simulate
      the same loss-of-internet effect more cheaply by removing its route from the affected AZ's
      private route table: `aws ec2 describe-route-tables --filters "Name=tag:Name,Values=croft-<workspace_id>-private-a"`
      to find the route table id, then `aws ec2 delete-route --route-table-id <rt-id> --destination-cidr-block 0.0.0.0/0`.
      **Expect:** already-running instances in that AZ keep working (they don't need ongoing
      internet access once their containers are already pulled and running) -- the real impact is
      on *new* instance bootstrap during the outage (an ASG scale-out event, or a replacement
      instance from the previous test) failing to reach `get.docker.com`. The *other* AZ's NAT and
      private subnet should be entirely unaffected -- if it isn't, the per-AZ isolation this phase
      was built for isn't real.
      **Verify recovery:** re-run `terraform apply` (the route is drift from declared state --
      Terraform recreates it) and confirm a new instance launched after that bootstraps cleanly
      again.
