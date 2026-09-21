export interface SourceFile {
  path: string;
  content: string;
}

/**
 * The "demo-shop" sources the demo failures point at. Each file is written so the line/column that
 * Bazel or the compiler reported in the demo data really contains the offending code, letting the
 * file viewer open a failure at the right line.
 */
export const DEMO_SOURCE_ROOT = 'demo-shop';

const appBuild = `# Demo project: app package
load("@rules_cc//cc:defs.bzl", "cc_binary")

package(default_visibility = ["//visibility:public"])

# HTTP server binary
cc_binary(
    name = "server",
    srcs = ["server.cc"],
    deps = ["//lib:core", "//lib:util"],
)

# Shared request handlers
cc_library(
    name = "handlers",
    srcs = ["handlers.cc"],
    hdrs = ["handlers.h"],
)
# Web front end
cc_binary(
    name = "web",
    deps = ["//lib:utils"],
    srcs = ["web.cc"],
)
`;

const libBuild = `load("@rules_cc//cc:defs.bzl", "cc_library")

cc_library(
    name = "util",
    srcs = ["util.cc"],
    hdrs = ["util.h"],
)
cc_library(name = "core", srcs = ["core.cc"], hdrs = ["core.h"], deps = [":util"], visibility = ["//visibility:public"])

cc_library(name = "internal", srcs = ["internal.cc"], visibility = ["//lib:__pkg__"])
`;

const webBuild = `load("@rules_cc//cc:defs.bzl", "cc_binary")

cc_binary(
    name = "app",
    deps = ["//lib:internal"],
)
`;

const coreCc = [
  '// Core configuration and startup logic.',
  '#include "lib/core.h"',
  '',
  '#include <cstdlib>',
  '#include <iostream>',
  '#include <string>',
  '',
  '#include "lib/util.h"',
  '',
  'namespace demo {',
  '',
  'namespace {',
  'std::string DefaultConfigPath() {',
  '  const char* home = std::getenv("HOME");',
  '  return std::string(home ? home : ".") + "/.demo-shop.conf";',
  '}',
  '',
  '}  // namespace',
  '',
  'struct Config {',
  '  std::string path;',
  '  bool verbose = false;',
  '};',
  '',
  'Config LoadConfig(const std::string& path) {',
  '  Config config;',
  '  config.path = path;',
  '  return config;',
  '}',
  '',
  '// Reads flags, loads the config file and starts the service.',
  'int Run(int argc, char** argv) {',
  '  Config config = LoadConfig(DefaultConfigPath());',
  '  if (argc > 1 && std::string(argv[1]) == "--verbose") {',
  '    config.verbose = true;',
  '  }',
  '',
  '  if (config.verbose) {',
  '    std::cerr << "loading " << config.path << "\\n";',
  '  }',
  '',
  '  parse_config(argc, argv);',
  '  return 0;',
  '}',
  '',
  '}  // namespace demo',
  '',
].join('\n');

const moduleBazel = `module(name = "demo_shop", version = "0.1.0")

bazel_dep(name = "rules_cc", version = "0.1.1")
`;

export const DEMO_FILES: SourceFile[] = [
  { path: `${DEMO_SOURCE_ROOT}/MODULE.bazel`, content: moduleBazel },
  { path: `${DEMO_SOURCE_ROOT}/app/BUILD.bazel`, content: appBuild },
  { path: `${DEMO_SOURCE_ROOT}/lib/BUILD.bazel`, content: libBuild },
  { path: `${DEMO_SOURCE_ROOT}/lib/core.cc`, content: coreCc },
  { path: `${DEMO_SOURCE_ROOT}/web/BUILD.bazel`, content: webBuild },
];
