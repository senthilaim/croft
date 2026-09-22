import type { PackageGraph } from "@croft/shared-types";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  targetCount: number;
  external: boolean;
}

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 90;

/**
 * A simple deterministic layered (DAG-style) layout: nodes with no incoming edge start at level 0,
 * every other node's level is one past its deepest predecessor. Nodes in a cycle (or otherwise
 * unreached) fall back to the last level plus one so they still render, just not meaningfully
 * ordered relative to the rest. Read-only, auto-laid-out graph -- not meant to be manually arranged
 * the way the Buildfarm designer canvas is, so this doesn't need to be a "nice" layout, just stable
 * and non-overlapping.
 */
export function layoutPackageGraph(graph: PackageGraph): LayoutNode[] {
  const inbound = new Map<string, string[]>();
  for (const node of graph.nodes) inbound.set(node.id, []);
  for (const edge of graph.edges) {
    inbound.get(edge.target)?.push(edge.source);
  }

  const level = new Map<string, number>();
  const order = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));

  // Iterative relaxation instead of a strict topological sort, so cycles (which a real repo's
  // package graph can have) can't infinite-loop -- just cap the passes.
  for (let pass = 0; pass < order.length + 1; pass++) {
    let changed = false;
    for (const node of order) {
      const preds = inbound.get(node.id) ?? [];
      const predLevel = preds.reduce((max, p) => Math.max(max, level.get(p) ?? -1), -1);
      const next = predLevel + 1;
      if (next !== (level.get(node.id) ?? 0) && next < order.length) {
        level.set(node.id, next);
        changed = true;
      } else if (!level.has(node.id)) {
        level.set(node.id, 0);
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, string[]>();
  for (const node of order) {
    const l = level.get(node.id) ?? 0;
    const column = columns.get(l) ?? [];
    column.push(node.id);
    columns.set(l, column);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [col, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, row) => {
      positions.set(id, { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT });
    });
  }

  return order.map((node) => ({
    id: node.id,
    targetCount: node.targetCount,
    external: node.id.startsWith("@"),
    ...(positions.get(node.id) ?? { x: 0, y: 0 }),
  }));
}
