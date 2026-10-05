"use client";

import { useState } from "react";
import {
  isDocumentationRangeCidr,
  type CloudCredential,
  type CloudCredentialSetupInfo,
  type ConnectCloudCredentialRequest,
} from "@croft/shared-types";

const card = "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";
const field =
  "h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100";
const label = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

const IDLE_TIMEOUT_MIN = 30;
const IDLE_TIMEOUT_MAX = 240;
const SUPPORTED_REGION = "us-east-1";

function CopyBlock({ title, json }: { title: string; json: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{title}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-xs font-medium text-brand hover:underline"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg border border-black/10 bg-black/[.03] p-3 font-mono text-[11px] text-zinc-700 dark:border-white/10 dark:bg-white/[.04] dark:text-zinc-300">
        {json}
      </pre>
    </div>
  );
}

/** Numbered step card -- same visual pattern used elsewhere in the app for multi-step setup flows
 * (e.g. the repo-analysis connect steps), reproduced locally rather than cross-imported since it's
 * a tiny, fully generic presentational helper. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-5`}>
      <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConsolePath({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-black/[.05] px-1.5 py-0.5 text-[13px] dark:bg-white/10">{children}</code>
  );
}

export function CloudCredentialsSettings({
  workspaceId,
  setupInfo,
  initialConnection,
}: {
  workspaceId: string;
  setupInfo: CloudCredentialSetupInfo;
  initialConnection: CloudCredential | null;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [roleArn, setRoleArn] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(60);
  const [cidrs, setCidrs] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleConnect() {
    setSubmitting(true);
    setError(null);
    try {
      const body: ConnectCloudCredentialRequest = {
        roleArn: roleArn.trim(),
        bootstrapAccessKeyId: accessKeyId.trim(),
        bootstrapSecretAccessKey: secretAccessKey,
        environment: "staging",
        region: SUPPORTED_REGION,
        idleTimeoutMinutes,
        allowedIngressCidrs: cidrs.map((c) => c.trim()).filter(Boolean),
      };
      const res = await fetch(`/api/workspaces/${workspaceId}/cloud-credentials/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.message ?? "Could not connect this AWS account.");
        return;
      }
      setConnection(payload as CloudCredential);
      setSecretAccessKey("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/cloud-credentials/connection`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Could not disconnect this AWS account.");
        return;
      }
      setConnection(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (connection) {
    return (
      <div className={`${card} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">AWS connected</h2>
            <dl className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">Role ARN: </dt>
                <dd className="inline">{connection.roleArn}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">Bootstrap key: </dt>
                <dd className="inline">••••{connection.bootstrapKeyLast4}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">Region: </dt>
                <dd className="inline">{connection.region}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">Idle timeout: </dt>
                <dd className="inline">{connection.idleTimeoutMinutes} minutes</dd>
              </div>
              <div>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">Allowed ingress: </dt>
                <dd className="inline">{connection.allowedIngressCidrs.join(", ")}</dd>
              </div>
            </dl>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="h-9 shrink-0 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
        {connection.allowedIngressCidrs.some((c) => isDocumentationRangeCidr(c)) && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            One of the allowed ingress CIDRs above ({connection.allowedIngressCidrs.find((c) => isDocumentationRangeCidr(c))}) is a
            reserved example/documentation address, not a real one -- it was likely the connect form&apos;s
            placeholder typed in by mistake. The Buildfarm&apos;s security group will silently block every real
            connection until this is fixed. Disconnect and reconnect with your actual public IP, then click{" "}
            <strong>Submit Setup</strong> again so the security group picks up the change.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Connecting AWS takes five steps in the AWS Console, then one here. None of this creates anything in AWS
        by itself -- you&apos;re setting up a narrow, revocable way for Croft to provision on your behalf, using
        only the permissions below.
      </p>

      <Step n={1} title="Create a bootstrap IAM user">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          In the AWS Console: <ConsolePath>IAM → Users → Create user</ConsolePath>. Any name works, e.g.{" "}
          <ConsolePath>croft-bootstrap</ConsolePath>. It does not need AWS Management Console access -- this user
          only ever calls <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/10">sts:AssumeRole</code>,
          so skip attaching any permissions to it directly (the real permissions live on the role in step 2).
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          After creating it, open the user → <ConsolePath>Security credentials</ConsolePath> tab →{" "}
          <ConsolePath>Create access key</ConsolePath> → choose &quot;Third-party service&quot; (or
          &quot;Application running outside AWS&quot;). Copy both values now -- the secret key is only ever
          shown once. You&apos;ll paste them into step 5 below.
        </p>
      </Step>

      <Step n={2} title="Create a role, trusting that user">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <ConsolePath>IAM → Roles → Create role → Custom trust policy</ConsolePath>. Paste the JSON below, but
          first replace the placeholder Principal with the bootstrap user&apos;s real ARN from step 1 (found on
          that user&apos;s Summary page, shaped like{" "}
          <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/10">
            arn:aws:iam::123456789012:user/croft-bootstrap
          </code>
          ). Leave the External ID condition exactly as-is -- it&apos;s already filled in and unique to this
          workspace.
        </p>
        <div className="mt-3">
          <CopyBlock title="Trust policy" json={setupInfo.trustPolicyJson} />
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          On the next screen, skip attaching any AWS-managed permission policies -- step 3 attaches a scoped one
          instead. Name the role something recognizable, e.g. <ConsolePath>CroftBuildfarmProvisioner</ConsolePath>,
          and finish creating it.
        </p>
      </Step>

      <Step n={3} title="Attach the permission policy">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Open the role you just created → <ConsolePath>Permissions</ConsolePath> tab →{" "}
          <ConsolePath>Add permissions → Create inline policy</ConsolePath> → <ConsolePath>JSON</ConsolePath> tab.
          Paste the policy below, then name and create it (e.g. <ConsolePath>CroftBuildfarmPermissions</ConsolePath>
          ). This is the entire set of permissions Croft ever has in your account -- EC2/VPC/networking,
          Auto Scaling, a Network Load Balancer for Server, ElastiCache, and (only if you enable a
          remote cache) a single S3 bucket plus the one narrowly-scoped IAM role that lets just that
          bucket&apos;s cache instance reach it. Every
          resource-level permission is scoped to this one workspace&apos;s own resource names -- nothing here
          reaches any other bucket, role, or cluster in your account.
        </p>
        <div className="mt-3">
          <CopyBlock title="Role permission policy" json={setupInfo.rolePolicyJson} />
        </div>
      </Step>

      <Step n={4} title="Copy the role's ARN">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Back on the role&apos;s <ConsolePath>Summary</ConsolePath> page, copy the <strong>ARN</strong> field
          (shaped like <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/10">
            arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner
          </code>
          ). You&apos;ll paste it into the Role ARN field below.
        </p>
      </Step>

      <Step n={5} title="Connect it here">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Croft calls <code className="rounded bg-black/[.05] px-1 py-0.5 dark:bg-white/10">sts:AssumeRole</code>{" "}
          once with what you enter below to confirm it actually works before anything is saved -- nothing is
          stored if that check fails. Only the staging environment and the {SUPPORTED_REGION} region are
          supported this release; production support is coming soon.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label}>Role ARN</label>
            <input
              className={field}
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/CroftBuildfarmProvisioner"
            />
          </div>
          <div>
            <label className={label}>Bootstrap access key ID</label>
            <input className={field} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
          </div>
          <div>
            <label className={label}>Bootstrap secret access key</label>
            <input
              className={field}
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>Environment</label>
            <select className={field} value="staging" disabled>
              <option value="staging">Staging</option>
              <option value="production" disabled>
                Production (coming soon)
              </option>
            </select>
          </div>
          <div>
            <label className={label}>Region</label>
            <input className={field} value={SUPPORTED_REGION} disabled />
          </div>
          <div>
            <label className={label}>Idle timeout (minutes)</label>
            <input
              className={field}
              type="number"
              min={IDLE_TIMEOUT_MIN}
              max={IDLE_TIMEOUT_MAX}
              value={idleTimeoutMinutes}
              onChange={(e) => setIdleTimeoutMinutes(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              {IDLE_TIMEOUT_MIN}-{IDLE_TIMEOUT_MAX} minutes. The Buildfarm tears itself down after this long
              without a build.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Allowed ingress CIDRs</label>
            <div className="flex flex-col gap-2">
              {cidrs.map((cidr, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={field}
                    value={cidr}
                    onChange={(e) => setCidrs(cidrs.map((c, j) => (j === i ? e.target.value : c)))}
                    placeholder="e.g. 198.51.100.5/32 (format only -- not a real address)"
                  />
                  {cidrs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setCidrs(cidrs.filter((_, j) => j !== i))}
                      className="h-9 shrink-0 rounded-lg border border-black/10 px-3 text-sm text-zinc-600 hover:bg-black/[.03] dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/[.04]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCidrs([...cidrs, ""])}
                className="self-start text-xs font-medium text-brand hover:underline"
              >
                + Add another
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Who can reach the Buildfarm&apos;s ports -- the real public IP of the machine that will run Bazel,
              and/or your CI provider&apos;s published IP range. Not sure what yours is? Check{" "}
              <a
                href="https://icanhazip.com"
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand hover:underline"
              >
                icanhazip.com
              </a>{" "}
              and paste it as-is -- a bare address is automatically treated as /32. 0.0.0.0/0 and
              example/documentation addresses (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) are rejected --
              they can never be a real machine.
            </p>
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          onClick={handleConnect}
          disabled={submitting || !roleArn || !accessKeyId || !secretAccessKey}
          className="mt-4 h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {submitting ? "Connecting…" : "Connect AWS account"}
        </button>
      </Step>
    </div>
  );
}
