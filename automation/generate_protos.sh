#!/usr/bin/env bash
# Compiles the minimal BES/BEP .proto files in protos/ into Python stubs under app/generated/.
# Re-run this whenever protos/ changes. app/generated/ is gitignored (build output).
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p app/generated

python3 -m grpc_tools.protoc \
  -I protos \
  --python_out=app/generated \
  --grpc_python_out=app/generated \
  protos/blaze/action_cache.proto \
  protos/build_event_stream/build_event_stream.proto \
  protos/google/devtools/build/v1/build_events.proto \
  protos/google/devtools/build/v1/publish_build_event.proto

echo "Generated Python stubs in app/generated/"
