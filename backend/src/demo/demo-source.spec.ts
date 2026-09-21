import { describe, expect, it } from 'vitest';
import { DEMO_FILES } from './demo-source.js';

const lineOf = (path: string, n: number) =>
  DEMO_FILES.find((f) => f.path === path)!.content.split('\n')[n - 1];

describe('demo source files line up with the demo failures', () => {
  it('app/BUILD.bazel:14 uses the undefined cc_library, :22 references the missing //lib:utils', () => {
    expect(lineOf('demo-shop/app/BUILD.bazel', 14)).toContain('cc_library(');
    expect(lineOf('demo-shop/app/BUILD.bazel', 22)).toContain('//lib:utils');
  });
  it('lib/BUILD.bazel:8 declares core and lib/core.cc:42 calls the undeclared parse_config', () => {
    expect(lineOf('demo-shop/lib/BUILD.bazel', 8)).toContain('"core"');
    expect(lineOf('demo-shop/lib/core.cc', 42)).toContain('parse_config(argc, argv);');
  });
  it('web/BUILD.bazel:5 depends on the non-visible //lib:internal', () => {
    expect(lineOf('demo-shop/web/BUILD.bazel', 5)).toContain('//lib:internal');
  });
});
