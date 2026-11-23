# Rebuild js/three.min.js (see tools/build_three.sh) in the Playwright Docker image — no local Node needed.
#   powershell -ExecutionPolicy Bypass -File tools/build_three.ps1
$ErrorActionPreference = 'Stop'
$image = 'mcr.microsoft.com/playwright:v1.63.0-noble'   # the same image as tools/test.ps1
$root = Split-Path -Parent $PSScriptRoot
docker run --rm -e NPM_CONFIG_UPDATE_NOTIFIER=false -v "${root}:/work" -v wfs-node-modules:/work/node_modules -w /work $image bash -c 'npm ci --no-audit --no-fund --loglevel=error && bash tools/build_three.sh'
exit $LASTEXITCODE
