import type {
  BuildfarmNode,
  CostEstimate,
  CostInstanceChoice,
  CostNodeRequirement,
  CostProvider,
  CostReport,
} from '@croft/shared-types';

interface InstanceType {
  name: string;
  vcpu: number;
  memGb: number;
  hourly: number;
}

interface CloudCatalog {
  label: string;
  instances: InstanceType[];
  storagePerGbMonth: number;
  /** Fraction of the on-demand price typically paid for spot/preemptible capacity. */
  spotFactor: number;
}

export const PRICES_AS_OF = '2026-01';

// Approximate public Linux on-demand list prices for one US region per cloud. They drift and
// differ by region, so the UI presents these as estimates to be checked against the provider's own
// calculator, never as quotes.
export const CATALOG: Record<'aws' | 'gcp' | 'azure', CloudCatalog> = {
  aws: {
    label: 'AWS (us-east-1)',
    storagePerGbMonth: 0.08,
    spotFactor: 0.35,
    instances: [
      { name: 'm6i.large', vcpu: 2, memGb: 8, hourly: 0.096 },
      { name: 'm6i.xlarge', vcpu: 4, memGb: 16, hourly: 0.192 },
      { name: 'm6i.2xlarge', vcpu: 8, memGb: 32, hourly: 0.384 },
      { name: 'm6i.4xlarge', vcpu: 16, memGb: 64, hourly: 0.768 },
      { name: 'c6i.large', vcpu: 2, memGb: 4, hourly: 0.085 },
      { name: 'c6i.xlarge', vcpu: 4, memGb: 8, hourly: 0.17 },
      { name: 'c6i.2xlarge', vcpu: 8, memGb: 16, hourly: 0.34 },
      { name: 'c6i.4xlarge', vcpu: 16, memGb: 32, hourly: 0.68 },
    ],
  },
  gcp: {
    label: 'Google Cloud (us-central1)',
    storagePerGbMonth: 0.1,
    spotFactor: 0.4,
    instances: [
      { name: 'e2-standard-2', vcpu: 2, memGb: 8, hourly: 0.067 },
      { name: 'e2-standard-4', vcpu: 4, memGb: 16, hourly: 0.134 },
      { name: 'e2-standard-8', vcpu: 8, memGb: 32, hourly: 0.268 },
      { name: 'e2-standard-16', vcpu: 16, memGb: 64, hourly: 0.536 },
      { name: 'e2-highcpu-4', vcpu: 4, memGb: 4, hourly: 0.099 },
      { name: 'e2-highcpu-8', vcpu: 8, memGb: 8, hourly: 0.198 },
      { name: 'e2-highcpu-16', vcpu: 16, memGb: 16, hourly: 0.396 },
    ],
  },
  azure: {
    label: 'Azure (East US)',
    storagePerGbMonth: 0.075,
    spotFactor: 0.35,
    instances: [
      { name: 'D2s_v5', vcpu: 2, memGb: 8, hourly: 0.096 },
      { name: 'D4s_v5', vcpu: 4, memGb: 16, hourly: 0.192 },
      { name: 'D8s_v5', vcpu: 8, memGb: 32, hourly: 0.384 },
      { name: 'D16s_v5', vcpu: 16, memGb: 64, hourly: 0.768 },
      { name: 'F4s_v2', vcpu: 4, memGb: 8, hourly: 0.169 },
      { name: 'F8s_v2', vcpu: 8, memGb: 16, hourly: 0.338 },
      { name: 'F16s_v2', vcpu: 16, memGb: 32, hourly: 0.677 },
    ],
  },
};

/** Room left for the OS, Docker and bursts on each machine. */
const HEADROOM = 1.15;
const HOURS_PER_MONTH_FULL = 730;
const MIN_STORAGE_GB = 50;
const DEFAULT_ONPREM_VCPU_HOUR = 0.02;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface EstimateInput {
  nodes: BuildfarmNode[];
  hoursPerDay: number;
  buildsPerMonth: number;
  buildsMeasured: boolean;
  onPremVcpuHour?: number;
}

export function requirementsFrom(nodes: BuildfarmNode[]): CostReport['requirements'] {
  const out: CostNodeRequirement[] = [];
  let storageGb = 0;
  for (const node of nodes) {
    const cfg = node.config as unknown as Record<string, unknown>;
    if (node.type === 'server') {
      out.push({
        role: 'server',
        replicas: 1,
        vcpu: Number(cfg.cpuLimit) || 1,
        memGb: (Number(cfg.memoryLimitMb) || 512) / 1024,
      });
    } else if (node.type === 'worker') {
      out.push({
        role: 'worker',
        replicas: Math.max(1, Number(cfg.replicas) || 1),
        vcpu: Number(cfg.cpuLimit) || 1,
        memGb: (Number(cfg.memoryLimitMb) || 1024) / 1024,
      });
    } else if (node.type === 'redis') {
      out.push({ role: 'redis', replicas: 1, vcpu: 0.25, memGb: (Number(cfg.memoryLimitMb) || 256) / 1024 });
    } else if (node.type === 'cache') {
      storageGb += Number(cfg.sizeGb) || 0;
    }
  }
  const vcpu = out.reduce((s, n) => s + n.vcpu * n.replicas, 0);
  const memGb = out.reduce((s, n) => s + n.memGb * n.replicas, 0);
  return { nodes: out, vcpu: round2(vcpu), memGb: round2(memGb), storageGb: Math.max(storageGb, MIN_STORAGE_GB) };
}

function cheapestFit(catalog: CloudCatalog, vcpu: number, memGb: number): CostInstanceChoice {
  let best: CostInstanceChoice | null = null;
  for (const inst of catalog.instances) {
    const count = Math.max(1, Math.ceil(Math.max((vcpu * HEADROOM) / inst.vcpu, (memGb * HEADROOM) / inst.memGb)));
    const total = count * inst.hourly;
    if (!best || total < best.count * best.hourlyEach - 1e-9 || (Math.abs(total - best.count * best.hourlyEach) < 1e-9 && count < best.count)) {
      best = { type: inst.name, count, vcpu: inst.vcpu, memGb: inst.memGb, hourlyEach: inst.hourly };
    }
  }
  return best as CostInstanceChoice;
}

export function estimateCosts(input: EstimateInput): CostReport {
  const req = requirementsFrom(input.nodes);
  const hoursPerDay = Math.min(24, Math.max(1, input.hoursPerDay));
  const monthlyHours = round2((hoursPerDay / 24) * HOURS_PER_MONTH_FULL);
  const perBuild = (total: number) => (input.buildsPerMonth > 0 ? total / input.buildsPerMonth : null);
  const estimates: CostEstimate[] = [];

  estimates.push({
    provider: 'docker',
    label: 'Docker on your own machine',
    instance: null,
    computeMonthly: 0,
    storageMonthly: 0,
    totalMonthly: 0,
    spotMonthly: null,
    perBuild: null,
    notes: [
      `No cloud bill: uses about ${req.vcpu} vCPU and ${req.memGb} GB RAM of your machine while running.`,
      'Your real cost is the hardware and electricity, and builds compete with your other work.',
    ],
  });

  (Object.keys(CATALOG) as Array<'aws' | 'gcp' | 'azure'>).forEach((provider) => {
    const catalog = CATALOG[provider];
    const choice = cheapestFit(catalog, req.vcpu, req.memGb);
    const compute = choice.count * choice.hourlyEach * monthlyHours;
    const storage = req.storageGb * catalog.storagePerGbMonth;
    const total = compute + storage;
    const spot = compute * catalog.spotFactor + storage;
    estimates.push({
      provider,
      label: catalog.label,
      instance: choice,
      computeMonthly: round2(compute),
      storageMonthly: round2(storage),
      totalMonthly: round2(total),
      spotMonthly: round2(spot),
      perBuild: perBuild(total) === null ? null : round2(perBuild(total) as number),
      notes: [
        `${choice.count} x ${choice.type} (${choice.vcpu} vCPU, ${choice.memGb} GB) for ${monthlyHours} h/month, plus ${req.storageGb} GB storage.`,
        'Excludes network egress, load balancers, snapshots and support plans.',
      ],
    });
  });

  const rate = input.onPremVcpuHour ?? DEFAULT_ONPREM_VCPU_HOUR;
  const onprem = req.vcpu * HEADROOM * rate * monthlyHours;
  estimates.push({
    provider: 'onprem',
    label: `On-prem / own servers (at $${rate}/vCPU-hour)`,
    instance: null,
    computeMonthly: round2(onprem),
    storageMonthly: 0,
    totalMonthly: round2(onprem),
    spotMonthly: null,
    perBuild: perBuild(onprem) === null ? null : round2(perBuild(onprem) as number),
    notes: [
      'A placeholder rate for the amortised cost of your own hardware, power and space. Replace it with your real internal $/vCPU-hour.',
    ],
  });

  return {
    requirements: req,
    usage: {
      hoursPerDay,
      monthlyHours,
      buildsPerMonth: input.buildsPerMonth,
      buildsMeasured: input.buildsMeasured,
    },
    estimates,
    pricesAsOf: PRICES_AS_OF,
    disclaimer:
      'Estimates from approximate public list prices for one region per cloud. They are for comparing options, not quotes: real bills vary with region, commitments, discounts, data transfer and how well the workload packs onto machines.',
  };
}

export type { CostProvider };
