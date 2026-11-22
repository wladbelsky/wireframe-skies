#!/usr/bin/env bash
# Rebuild the vendored js/three.min.js from the `three` devDependency (package.json): one minified IIFE that defines
# the global THREE — three.js ships ES modules only since r161, the wallpaper uses classic scripts.
#   npm ci && bash tools/build_three.sh          (tools/build_three.ps1 does the same in Docker)
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/three/package.json', 'utf8')).version")
npx esbuild tools/three-entry.js --bundle --format=iife --global-name=THREE --minify --target=chrome110 \
  --legal-comments=none --banner:js="/* three.js r$(echo "$v" | cut -d. -f2) (${v}) — https://threejs.org — MIT License, Copyright 2010-2026 Three.js Authors. Built by tools/build_three.sh: do not edit. */" \
  --outfile=js/three.min.js
echo "js/three.min.js: three ${v}, $(wc -c < js/three.min.js) bytes"
