#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# prepare-sources.py lists only profiles whose persistent patches exist.
mode=${1:?Usage: build.sh MODE (see python3 scripts/prepare-sources.py --help)}
install=0
if [[ $# -eq 2 && "$2" == --install ]]; then
  case "$mode" in
    prover|prover-baseline|prover-memory|prover-tradeoffs|prover-kernels) install=1;;
    *) echo '--install is only available for prover profiles' >&2; exit 2;;
  esac
elif [[ $# -ne 1 ]]; then
  echo 'Usage: build.sh MODE [--install]' >&2
  exit 2
fi
if [[ -n "${STARKNET_PRIVATE_KEY:-}" ]]; then
  echo 'Source builds must run without STARKNET_PRIVATE_KEY' >&2
  exit 1
fi
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
python3 scripts/prepare-sources.py "$mode"
rustup toolchain install nightly-2026-01-15 --profile minimal --component rust-src --target wasm32-unknown-unknown
case "$mode" in
 prover|prover-baseline|prover-memory|prover-tradeoffs|prover-kernels)
  : "${WASM_CC:?Set WASM_CC to a Wasm-capable LLVM clang}"
  : "${WASM_AR:?Set WASM_AR to llvm-ar}"
  export CC_wasm64_unknown_unknown="$WASM_CC" AR_wasm64_unknown_unknown="$WASM_AR"
  export RUSTFLAGS='--cfg getrandom_backend="custom" -C target-feature=+simd128'
  profile=$(python3 scripts/prover_sources.py "$mode")
  source_root="build/$profile"
  target_root="build/target-prover-$profile"
  CARGO_TARGET_DIR="$PWD/$target_root" cargo +nightly-2026-01-15 rustc --locked --release --manifest-path "$source_root/proving-utils/Cargo.toml" --target wasm64-unknown-unknown -Z build-std=std,panic_abort -p snip36-browser-prover --no-default-features -- -C link-arg=-zstack-size=8388608 -C link-arg=--max-memory=17179869184
  module="$target_root/wasm64-unknown-unknown/release/snip36_browser_prover.wasm"
  module_sha=$(shasum -a 256 "$module" | cut -d ' ' -f 1)
  mkdir -p build/wasm
  cp "$module" "build/wasm/$module_sha.wasm"
  echo "$mode WASM SHA256: $module_sha"
  if [[ "$mode" == prover || "$install" == 1 ]]; then cp "$module" web/sequencer-prover.wasm; fi
  ;;
 executor)
  python3 scripts/prepare-compiler.py
  if [ ! -d build/compiler-venv ]; then "${PYTHON310:-python3.10}" -m venv build/compiler-venv; fi
  build/compiler-venv/bin/pip install --no-deps build/compiler-source/cairo-lang-0.14.3a3
  # Full pinned dependencies are installed without pulling the upstream signing dependency back in.
  build/compiler-venv/bin/pip install -r patches/executor/python-requirements.txt
  build/compiler-venv/bin/pip check
  build/compiler-venv/bin/python scripts/check-compiler.py
  export PATH="$PWD/build/compiler-venv/bin:$PATH"
  export RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
  CARGO_TARGET_DIR="$PWD/build/target-executor" cargo +nightly-2026-01-15 rustc --locked --release --manifest-path build/sequencer/Cargo.toml -p browser_virtual_os --target wasm32-unknown-unknown -- -C link-arg=-zstack-size=8388608
  cargo +nightly-2026-01-15 install wasm-bindgen-cli --version 0.2.105 --locked --root build/tools
  build/tools/bin/wasm-bindgen --target web --out-dir web/auth build/target-executor/wasm32-unknown-unknown/release/browser_virtual_os.wasm
  ;;
 native)
  CARGO_TARGET_DIR="$PWD/build/target-native" cargo +nightly-2026-01-15 build --locked --release --manifest-path build/native-prover/Cargo.toml -p privacy-prove --example spike_native
  ;;
 *) exit 2;;
esac
