import { describe, expect, it } from 'vitest';
import { diagnoseBuild } from './build-diagnostics.js';

describe('diagnoseBuild', () => {
  it('finds the root cause behind "Package contains errors" with file, line and a fix', () => {
    const log = [
      'Loading: 0 packages loaded',
      "ERROR: /work/proj/app/BUILD.bazel:12:5: name 'sh_test' is not defined",
      "ERROR: Error evaluating '//...': error loading package 'app': Package 'app' contains errors",
      'INFO: Elapsed time: 0.2s',
      'FAILED: Build did NOT complete successfully',
    ].join('\n');

    const issues = diagnoseBuild([log]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: '/work/proj/app/BUILD.bazel',
      line: 12,
      column: 5,
      category: 'starlark',
      title: 'Undefined name',
      symptom: false,
    });
    expect(issues[0].recommendation.steps.join(' ')).toContain('sh_test');
    expect(issues[0].recommendation.steps.join(' ')).toContain('bazel_dep');
  });

  it('keeps the summary line when nothing more specific exists', () => {
    const issues = diagnoseBuild([
      "ERROR: Error evaluating '//...': error loading package 'app': Package 'app' contains errors",
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].symptom).toBe(true);
  });

  it('parses compiler errors from action stderr with location and context', () => {
    const stderr = [
      "src/main.cc:10:5: error: use of undeclared identifier 'foo'",
      '  foo();',
      '  ^',
    ].join('\n');
    const [issue] = diagnoseBuild([null, stderr]);
    expect(issue).toMatchObject({ file: 'src/main.cc', line: 10, column: 5, category: 'compile' });
    expect(issue.context).toContain('  foo();');
  });

  it('gives a missing-target issue and de-duplicates repeats across sources', () => {
    const line = "ERROR: /w/BUILD:3:10: no such target '//lib:util': target 'util' not declared in package 'lib'";
    const issues = diagnoseBuild([line, line]);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Target not found');
  });

  it('drops location-less echoes and takes the file from "defined by"', () => {
    const echo = diagnoseBuild([
      [
        "ERROR: /w/app/BUILD.bazel:1:1: name 'sh_test' is not defined",
        "ERROR: package contains errors: app: name 'sh_test' is not defined",
      ].join('\n'),
    ]);
    expect(echo).toHaveLength(1);
    expect(echo[0].line).toBe(1);

    const [t] = diagnoseBuild([
      "ERROR: no such target '//:x': target 'x' not declared in package '' defined by /w/BUILD.bazel",
    ]);
    expect(t.file).toBe('/w/BUILD.bazel');
  });

  it('returns nothing for empty output', () => {
    expect(diagnoseBuild([null, undefined, ''])).toEqual([]);
  });
});
