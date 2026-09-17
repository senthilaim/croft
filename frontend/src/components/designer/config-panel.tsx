"use client";

import type {
  BuildfarmNodeConfig,
  BuildfarmNodeType,
  CacheNodeConfig,
  RedisNodeConfig,
  ServerNodeConfig,
  WorkerNodeConfig,
} from "@croft/shared-types";
import { NODE_LABELS } from "./node-defaults";

interface ConfigPanelProps {
  nodeId: string;
  nodeType: BuildfarmNodeType;
  config: BuildfarmNodeConfig;
  onChange: (config: BuildfarmNodeConfig) => void;
  onDelete: () => void;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-zinc-900";

export function ConfigPanel({ nodeId, nodeType, config, onChange, onDelete }: ConfigPanelProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-l border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {NODE_LABELS[nodeType]}
        </h2>
        <button
          onClick={onDelete}
          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
        >
          Delete
        </button>
      </div>

      {nodeType === "server" && (
        <ServerFields config={config as ServerNodeConfig} onChange={onChange} />
      )}
      {nodeType === "worker" && (
        <WorkerFields config={config as WorkerNodeConfig} onChange={onChange} />
      )}
      {nodeType === "redis" && (
        <RedisFields config={config as RedisNodeConfig} onChange={onChange} />
      )}
      {nodeType === "cache" && (
        <CacheFields config={config as CacheNodeConfig} onChange={onChange} />
      )}

      <p className="mt-auto text-xs text-zinc-400 dark:text-zinc-500">Node ID: {nodeId}</p>
    </aside>
  );
}

function ServerFields({
  config,
  onChange,
}: {
  config: ServerNodeConfig;
  onChange: (c: BuildfarmNodeConfig) => void;
}) {
  return (
    <>
      <Field label="CPU limit">
        <input
          className={inputClass}
          value={config.cpuLimit}
          onChange={(e) => onChange({ ...config, cpuLimit: e.target.value })}
        />
      </Field>
      <Field label="Memory limit (MB)">
        <input
          type="number"
          min={128}
          className={inputClass}
          value={config.memoryLimitMb}
          onChange={(e) => onChange({ ...config, memoryLimitMb: Number(e.target.value) })}
        />
      </Field>
    </>
  );
}

function WorkerFields({
  config,
  onChange,
}: {
  config: WorkerNodeConfig;
  onChange: (c: BuildfarmNodeConfig) => void;
}) {
  const executionEnabled = config.executionEnabled ?? true;
  return (
    <>
      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm dark:border-white/10">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={executionEnabled}
          onChange={(e) => onChange({ ...config, executionEnabled: e.target.checked })}
        />
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Enable remote execution
          </span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Off = cache-only: this worker still stores the shared remote cache, but Bazel
            executes actions on its own machine instead of here.
          </span>
        </span>
      </label>
      <Field label="Replicas">
        <input
          type="number"
          min={1}
          className={inputClass}
          value={config.replicas}
          onChange={(e) => onChange({ ...config, replicas: Number(e.target.value) })}
        />
      </Field>
      <Field label="CPU limit">
        <input
          className={inputClass}
          value={config.cpuLimit}
          onChange={(e) => onChange({ ...config, cpuLimit: e.target.value })}
        />
      </Field>
      <Field label="Memory limit (MB)">
        <input
          type="number"
          min={128}
          className={inputClass}
          value={config.memoryLimitMb}
          onChange={(e) => onChange({ ...config, memoryLimitMb: Number(e.target.value) })}
        />
      </Field>
    </>
  );
}

function RedisFields({
  config,
  onChange,
}: {
  config: RedisNodeConfig;
  onChange: (c: BuildfarmNodeConfig) => void;
}) {
  return (
    <Field label="Memory limit (MB)">
      <input
        type="number"
        min={64}
        className={inputClass}
        value={config.memoryLimitMb}
        onChange={(e) => onChange({ ...config, memoryLimitMb: Number(e.target.value) })}
      />
    </Field>
  );
}

function CacheFields({
  config,
  onChange,
}: {
  config: CacheNodeConfig;
  onChange: (c: BuildfarmNodeConfig) => void;
}) {
  return (
    <Field label="Size (GB)">
      <input
        type="number"
        min={1}
        className={inputClass}
        value={config.sizeGb}
        onChange={(e) => onChange({ ...config, sizeGb: Number(e.target.value) })}
      />
    </Field>
  );
}
