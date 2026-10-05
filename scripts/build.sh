#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:?Usage: build.sh prover|executor|native}
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
python3 scripts/prepare-sources.py "$mode"
rustup toolchain install nightly-2026-01-15 --profile minimal --component rust-src --target wasm32-unknown-unknown
case "$mode" in
 prover)
  : "${WASM_CC:?Set WASM_CC to a Wasm-capable LLVM clang}"
  : "${WASM_AR:?Set WASM_AR to llvm-ar}"
  export CC_wasm64_unknown_unknown="$WASM_CC" AR_wasm64_unknown_unknown="$WASM_AR"
  export RUSTFLAGS='--cfg getrandom_backend="custom" -C target-feature=+simd128'
  CARGO_TARGET_DIR="$PWD/build/target-prover" cargo +nightly-2026-01-15 rustc --locked --release --manifest-path build/proving-utils/Cargo.toml --target wasm64-unknown-unknown -Z build-std=std,panic_abort -p snip36-browser-prover --no-default-features -- -C link-arg=-zstack-size=8388608 -C link-arg=--max-memory=17179869184
  cp build/target-prover/wasm64-unknown-unknown/release/snip36_browser_prover.wasm web/sequencer-prover.wasm
  ;;
 executor)
  if [ ! -d build/venv ]; then "${PYTHON310:-python3.10}" -m venv build/venv; fi
  build/venv/bin/pip install -r patches/executor/python-requirements.txt
  export PATH="$PWD/build/venv/bin:$PATH"
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
