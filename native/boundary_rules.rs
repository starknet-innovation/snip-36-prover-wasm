// SPDX-License-Identifier: Apache-2.0
// Std-only verdict rules for proof_boundaries, testable without the prover workspace:
// rustc --edition 2021 --test native/boundary_rules.rs
use std::{fs, path::Path};

pub fn verifier_panicked(code: Option<i32>, stderr: &[u8]) -> bool {
    code == Some(101) || String::from_utf8_lossy(stderr).contains("panicked at")
}

/// A negative passes only when the pristine verifier rejects it for the expected
/// reason: canonical mutations must reach verification and fail there; malformed
/// encodings must fail while decoding, before the verifier is called. Any other
/// exit-1 error (I/O, missing files) is a failed check, not a rejection.
pub fn boundary_passed(code: Option<i32>, stderr: &[u8], positive: bool, canonical: bool) -> bool {
    if code.is_none() || verifier_panicked(code, stderr) {
        return false;
    }
    if positive {
        return code == Some(0);
    }
    let stderr = String::from_utf8_lossy(stderr);
    let last = stderr.trim_end().lines().last().unwrap_or("");
    code != Some(0)
        && if canonical {
            last == "Error: \"Verification failed\""
        } else {
            stderr.contains("Decompress and deserialize the proof")
                && !stderr.contains("Call the verifier")
                && last.starts_with("Error: ")
        }
}

pub fn create_output_directory(out: &Path) -> std::io::Result<()> {
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    // Preserve exclusive creation: reruns must never overwrite prior evidence.
    fs::create_dir(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    const VERIFY_FAILED: &[u8] = b"INFO Call the verifier\nError: \"Verification failed\"\n";
    const DECODE_FAILED: &[u8] = b"INFO Decompress and deserialize the proof\nError: NotEnoughData\n";
    #[test]
    fn rejection_must_be_an_ordinary_error_for_the_expected_reason() {
        assert!(boundary_passed(Some(0), b"", true, true));
        assert!(boundary_passed(Some(1), VERIFY_FAILED, false, true));
        assert!(boundary_passed(Some(1), DECODE_FAILED, false, false));
        // Wrong stage for the case kind.
        assert!(!boundary_passed(Some(1), DECODE_FAILED, false, true));
        assert!(!boundary_passed(Some(1), VERIFY_FAILED, false, false));
        // Unrelated errors are not rejections.
        assert!(!boundary_passed(Some(1), b"Error: Os { code: 2, kind: NotFound }", false, true));
        assert!(!boundary_passed(Some(1), b"Error: Os { code: 2, kind: NotFound }", false, false));
        for code in [Some(101), None] {
            for canonical in [true, false] {
                assert!(!boundary_passed(code, VERIFY_FAILED, false, canonical));
                assert!(!boundary_passed(code, b"", true, canonical));
            }
        }
        assert!(!boundary_passed(Some(1), b"thread panicked at location\nError: \"Verification failed\"", false, true));
        assert!(!boundary_passed(Some(0), b"thread panicked at location", true, true));
        assert!(!boundary_passed(Some(0), b"", false, true));
        assert!(!boundary_passed(Some(1), VERIFY_FAILED, true, true));
    }
    #[test]
    fn new_output_creates_parents_and_refuses_existing_directory() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("proof-boundaries-{}-{unique}", std::process::id()));
        let out = root.join("missing/parents/attempt");
        create_output_directory(&out).unwrap();
        assert!(out.is_dir());
        fs::write(out.join("retained"), b"prior evidence").unwrap();
        assert_eq!(create_output_directory(&out).unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(out.join("retained")).unwrap(), b"prior evidence");
        fs::remove_dir_all(root).unwrap();
    }
}
