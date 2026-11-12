#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:?Usage: build.sh prover|prover-baseline|executor|native [--install]}
install=0
case "$mode" in
 prover) install=1;;
 prover-baseline|executor|native);;
 *) echo 'V1 memory/tradeoff/kernel profiles are unavailable for the V2 circuit' >&2; exit 2;;
esac
if [[ $# -eq 2 && "$2" == --install ]]; then
  case "$mode" in
    prover) install=1;;
    *) echo '--install is only available for the default optimized prover' >&2; exit 2;;
  esac
elif [[ $# -ne 1 ]]; then
  echo 'Usage: build.sh MODE [--install]' >&2; exit 2
fi
if [[ -n "${STARKNET_PRIVATE_KEY:-}" ]]; then
  echo 'Source builds must run without STARKNET_PRIVATE_KEY' >&2
  exit 1
fi
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
source_python=$(command -v python3)
# Preserve main's path privacy for published modules, including paths with spaces.
remap=$'\x1f'--remap-path-prefix=$PWD=/src$'\x1f'--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo$'\x1f'--remap-path-prefix=${RUSTUP_HOME:-$HOME/.rustup}=/rustup
rustflags() { local IFS=$'\x1f'; export CARGO_ENCODED_RUSTFLAGS="$*$remap"; }
"$source_python" scripts/prepare-sources.py "$mode"
rustup toolchain install nightly-2026-01-15 --profile minimal --component rust-src --target wasm32-unknown-unknown
case "$mode" in
 prover|prover-baseline)
  : "${WASM_CC:?Set WASM_CC to a Wasm-capable LLVM clang}"
  : "${WASM_AR:?Set WASM_AR to llvm-ar}"
  clang_version=$("$WASM_CC" -dumpversion)
  clang_major=${clang_version%%.*}
  if [[ ! "$clang_major" =~ ^[0-9]+$ ]] || (( clang_major < 21 )); then
    echo 'The memory64 prover requires LLVM clang 21 or newer for the indirect-call ABI' >&2
    exit 2
  fi
  export CC_wasm64_unknown_unknown="$WASM_CC" AR_wasm64_unknown_unknown="$WASM_AR"
  rustflags --cfg 'getrandom_backend="custom"' -C target-feature=+simd128
  source=proving
  target=target-prover
  if [[ "$mode" == prover-baseline ]]; then source=proving-baseline; target=target-prover-baseline; fi
  CARGO_TARGET_DIR="$PWD/build/$target" cargo +nightly-2026-01-15 rustc --locked --release --manifest-path "build/$source/Cargo.toml" --target wasm64-unknown-unknown -Z build-std=std,panic_abort -p snip36-browser-prover --no-default-features -- -C link-arg=-zstack-size=8388608 -C link-arg=--max-memory=17179869184
  module=build/$target/wasm64-unknown-unknown/release/snip36_browser_prover.wasm
  module_sha=$(shasum -a 256 "$module" | cut -d ' ' -f 1)
  mkdir -p build/wasm
  cp "$module" "build/wasm/$module_sha.wasm"
  if [[ "$install" == 1 ]]; then cp "$module" web/sequencer-prover.wasm; fi
  ;;
 executor)
  "$source_python" scripts/prepare-compiler.py
  if [ ! -d build/compiler-venv ]; then "${PYTHON310:-python3.10}" -m venv build/compiler-venv; fi
  build/compiler-venv/bin/pip install --no-deps build/compiler-source/cairo-lang-0.14.3a3
  # Full pinned dependencies are installed without pulling the upstream signing dependency back in.
  build/compiler-venv/bin/pip install -r patches/executor/python-requirements.txt
  build/compiler-venv/bin/pip check
  build/compiler-venv/bin/python scripts/check-compiler.py
  export PATH="$PWD/build/compiler-venv/bin:$PATH"
  : "${WASM_CC:?Set WASM_CC to a Wasm-capable LLVM clang}"
  : "${WASM_AR:?Set WASM_AR to llvm-ar}"
  export CC_wasm32_unknown_unknown="$WASM_CC" AR_wasm32_unknown_unknown="$WASM_AR"
  rustflags --cfg 'getrandom_backend="wasm_js"'
  CARGO_TARGET_DIR="$PWD/build/target-executor" cargo +nightly-2026-01-15 rustc --locked --release --manifest-path build/sequencer/Cargo.toml -p browser_virtual_os --target wasm32-unknown-unknown -- -C link-arg=-zstack-size=8388608
  # This tool runs on the host; target-only getrandom backends break a clean install.
  env -u RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS cargo +nightly-2026-01-15 install wasm-bindgen-cli --version 0.2.105 --locked --root build/tools
  build/tools/bin/wasm-bindgen --target web --out-dir web/auth build/target-executor/wasm32-unknown-unknown/release/browser_virtual_os.wasm
  ;;
 native)
  CARGO_TARGET_DIR="$PWD/build/target-native" cargo +nightly-2026-01-15 build --locked --release --manifest-path build/native-prover/Cargo.toml -p privacy-prove --example spike_native
  ;;
 *) exit 2;;
esac

if [[ "$mode" == executor ]]; then "$source_python" scripts/source-assets.py executor; fi
if [[ "$install" == 1 ]]; then "$source_python" scripts/source-assets.py prover; fi
