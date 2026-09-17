import type { BuildfarmEdge, BuildfarmNode } from '@croft/shared-types';

export function validateTopology(nodes: BuildfarmNode[], edges: BuildfarmEdge[]): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const countByType = (type: BuildfarmNode['type']) => nodes.filter((n) => n.type === type).length;

  if (countByType('server') !== 1) {
    errors.push('Topology must have exactly one Server node');
  }
  if (countByType('worker') !== 1) {
    errors.push('Topology must have exactly one Worker node (use its replicas field to scale)');
  }
  // A Worker is always required -- Buildfarm's server has no storage of its own, it delegates
  // all CAS blob storage to registered workers. For "cache-only", turn off the Worker's
  // "Enable remote execution" toggle instead of removing the node.
  if (countByType('redis') !== 1) {
    errors.push('Topology must have exactly one Redis Backplane node');
  }
  if (countByType('cache') > 1) {
    errors.push('Topology must have at most one Cache node');
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references a node that does not exist`);
    }
  }

  return errors;
}
