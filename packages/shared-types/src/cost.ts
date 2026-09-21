export type CostProvider = "docker" | "aws" | "gcp" | "azure" | "onprem";

export interface CostNodeRequirement {
  role: "server" | "worker" | "redis";
  replicas: number;
  /** Per replica. */
  vcpu: number;
  memGb: number;
}

export interface CostInstanceChoice {
  type: string;
  count: number;
  vcpu: number;
  memGb: number;
  hourlyEach: number;
}

export interface CostEstimate {
  provider: CostProvider;
  label: string;
  instance: CostInstanceChoice | null;
  computeMonthly: number;
  storageMonthly: number;
  /** On-demand (or the fixed rate for on-prem). */
  totalMonthly: number;
  /** Discounted spot/preemptible estimate; null where it does not apply. */
  spotMonthly: number | null;
  /** Total monthly cost divided by builds per month; null when there is no build volume. */
  perBuild: number | null;
  notes: string[];
}

export interface CostReport {
  requirements: {
    nodes: CostNodeRequirement[];
    vcpu: number;
    memGb: number;
    storageGb: number;
  };
  usage: {
    hoursPerDay: number;
    monthlyHours: number;
    buildsPerMonth: number;
    /** True when buildsPerMonth was measured from this workspace's real builds. */
    buildsMeasured: boolean;
  };
  estimates: CostEstimate[];
  pricesAsOf: string;
  disclaimer: string;
}
