// SPDX-License-Identifier: Apache-2.0
// Test-only mutations; no production prover or verifier code is changed.
use circuit_serialize::{deserialize::deserialize_proof_with_config, serialize::CircuitSerialize};
use circuits_stark_verifier::proof::Proof;
use privacy_circuit_verify::{VERSION_BYTES, get_proof_config};
use serde_json::json;
use std::{error::Error, fs, io::Write, ops::Range, path::Path, process::Command};
use stwo::core::fields::{m31::P, qm31::QM31};

#[path = "boundary_rules.rs"]
mod boundary_rules;
use boundary_rules::{boundary_passed, create_output_directory, verifier_panicked};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const VERIFIER_SHA: &str = "2b9878070536597b636d257d12577a5d528c3a7fb2bc0ab048df7864c16aa6b2";

#[derive(Clone)]
struct Span {
    name: String,
    range: Range<usize>,
}
struct Case {
    name: String,
    bytes: Vec<u8>,
    canonical: bool,
}

fn digest(path: &Path) -> Result<String> {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()?;
    if !output.status.success() {
        return Err("shasum failed".into());
    }
    Ok(String::from_utf8(output.stdout)?
        .split_whitespace()
        .next()
        .ok_or("missing digest")?
        .into())
}
fn decode(bytes: &[u8]) -> Result<Proof<QM31>> {
    let mut rest = bytes;
    let proof = deserialize_proof_with_config(&mut rest, &get_proof_config())?;
    if !rest.is_empty() {
        return Err("trailing decoded bytes".into());
    }
    Ok(proof)
}
fn encode(proof: &Proof<QM31>) -> Vec<u8> {
    let mut bytes = Vec::new();
    proof.serialize(&mut bytes);
    bytes
}
fn add<T: CircuitSerialize>(
    out: &mut Vec<u8>,
    spans: &mut Vec<Span>,
    name: impl Into<String>,
    value: &T,
) {
    let start = out.len();
    value.serialize(out);
    spans.push(Span {
        name: name.into(),
        range: start..out.len(),
    });
}
fn layout(proof: &Proof<QM31>) -> (Vec<u8>, Vec<Span>) {
    let mut out = Vec::new();
    let mut spans = Vec::new();
    macro_rules! field {
        ($f:ident) => {
            add(&mut out, &mut spans, stringify!($f), &proof.$f)
        };
    }
    field!(channel_salt);
    field!(trace_root);
    field!(interaction_root);
    field!(composition_polynomial_root);
    field!(claimed_sums);
    field!(preprocessed_columns_at_oods);
    field!(trace_at_oods);
    for (i, v) in proof.interaction_at_oods.iter().enumerate() {
        add(
            &mut out,
            &mut spans,
            format!("interaction_at_oods-{i}"),
            &v.at_oods,
        );
        if let Some(prev) = &v.at_prev {
            add(
                &mut out,
                &mut spans,
                format!("interaction_at_prev-{i}"),
                prev,
            );
        }
    }
    field!(composition_eval_at_oods);
    // Private sample storage is addressed only by checked, exact component serialization.
    for t in 0..proof.eval_domain_samples.n_traces() {
        for (c, column) in proof
            .eval_domain_samples
            .data_for_trace(t)
            .iter()
            .enumerate()
        {
            add(&mut out, &mut spans, format!("samples-{t}-{c}"), column);
        }
    }
    for (t, tree) in proof.eval_domain_auth_paths.data.iter().enumerate() {
        for (q, path) in tree.iter().enumerate() {
            add(&mut out, &mut spans, format!("auth-{t}-{q}"), path);
        }
    }
    field!(pow_nonce);
    field!(interaction_pow_nonce);
    for (i, root) in proof.fri.commit.layer_commitments.iter().enumerate() {
        add(&mut out, &mut spans, format!("fri-root-{i}"), root);
    }
    add(
        &mut out,
        &mut spans,
        "fri-last-coefs",
        &proof.fri.commit.last_layer_coefs,
    );
    for (t, tree) in proof.fri.auth_paths.data.iter().enumerate() {
        for (q, path) in tree.iter().enumerate() {
            add(&mut out, &mut spans, format!("fri-auth-{t}-{q}"), path);
        }
    }
    for (t, tree) in proof.fri.witness.0.iter().enumerate() {
        for (q, witness) in tree.iter().enumerate() {
            add(
                &mut out,
                &mut spans,
                format!("fri-witness-{t}-{q}"),
                witness,
            );
        }
    }
    (out, spans)
}
fn bump(bytes: &mut [u8], offset: usize) -> Result<()> {
    let word: [u8; 4] = bytes
        .get(offset..offset.checked_add(4).ok_or("offset overflow")?)
        .ok_or("bad field offset")?
        .try_into()?;
    let value = u32::from_le_bytes(word);
    if value >= P {
        return Err("original field is not canonical".into());
    }
    bytes[offset..offset + 4].copy_from_slice(&((value + 1) % P).to_le_bytes());
    Ok(())
}
fn selected_boundary(name: &str, spans: &[Span]) -> bool {
    // Every top-level field; first/last columns and queries of every commitment tree.
    if let Some(rest) = name.strip_prefix("samples-") {
        let tree = rest.split('-').next().unwrap();
        let prefix = format!("samples-{tree}-");
        let matches: Vec<_> = spans
            .iter()
            .filter(|s| s.name.starts_with(&prefix))
            .collect();
        return matches.first().unwrap().name == name || matches.last().unwrap().name == name;
    }
    for prefix in ["auth-", "fri-auth-", "fri-witness-"] {
        if let Some(rest) = name.strip_prefix(prefix) {
            let tree = rest.split('-').next().unwrap();
            let p = format!("{prefix}{tree}-");
            let matches: Vec<_> = spans.iter().filter(|s| s.name.starts_with(&p)).collect();
            return matches.first().unwrap().name == name || matches.last().unwrap().name == name;
        }
    }
    true
}
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        return Err("usage: proof_boundaries CANDIDATE_PROOF TRUSTED_EXPECTED UNCHANGED_NATIVE_VERIFIER NEW_OUTPUT_DIR".into());
    }
    let proof_path = Path::new(&args[1]);
    let expected = Path::new(&args[2]);
    let verifier = Path::new(&args[3]);
    let out = Path::new(&args[4]);
    create_output_directory(out)?;
    let original = fs::read(proof_path)?;
    let header = original
        .get(..VERSION_BYTES)
        .ok_or("missing version header")?;
    let raw = zstd::decode_all(
        original
            .get(VERSION_BYTES..)
            .ok_or("missing compressed body")?,
    )?;
    let proof = decode(&raw)?;
    if encode(&proof) != raw {
        return Err("original proof is not a canonical roundtrip".into());
    }
    let (laid_out, spans) = layout(&proof);
    if laid_out != raw {
        return Err("checked component layout differs from original serializer".into());
    }
    if digest(verifier)? != VERIFIER_SHA {
        return Err("unchanged native verifier identity mismatch".into());
    }
    fs::write(
        out.join("manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"proof_sha256":digest(proof_path)?,"expected_sha256":digest(expected)?,"verifier_sha256":VERIFIER_SHA,"version_header":header,"uncompressed_bytes":raw.len(),"canonical_roundtrip":true,"spans":spans.iter().map(|s| json!({"name":s.name,"start":s.range.start,"end":s.range.end})).collect::<Vec<_>>(),"version_limit":"Pinned native verifier parses but does not validate version; original header preserved"}),
        )?,
    )?;
    let mut cases = Vec::new();
    for span in spans.iter().filter(|s| selected_boundary(&s.name, &spans)) {
        if span.range.is_empty() {
            continue;
        }
        if span.range.len() % 4 != 0 {
            return Err("field span is not word aligned".into());
        }
        for (label, offset) in [("first", span.range.start), ("last", span.range.end - 4)] {
            let mut bytes = raw.clone();
            bump(&mut bytes, offset)?;
            cases.push(Case {
                name: format!("{}-{label}", span.name),
                bytes,
                canonical: true,
            });
        }
        if span.name.starts_with("samples-") {
            // Swap unequal queried M31 values, preserving canonical values and array length.
            let first = span.range.start;
            if let Some(other) = (first + 4..span.range.end)
                .step_by(4)
                .find(|i| raw[*i..*i + 4] != raw[first..first + 4])
            {
                let mut bytes = raw.clone();
                for j in 0..4 {
                    bytes.swap(first + j, other + j);
                }
                cases.push(Case {
                    name: format!("{}-query-order", span.name),
                    bytes,
                    canonical: true,
                });
            }
        }
    }
    // Permute complete query records for every tree with unequal records. This changes
    // ordering without changing lengths, values, padding, or decoder validity.
    for prefix in ["auth-", "fri-auth-", "fri-witness-"] {
        let mut trees = std::collections::BTreeSet::new();
        for span in &spans {
            if let Some(rest) = span.name.strip_prefix(prefix) {
                trees.insert(rest.split('-').next().unwrap().to_owned());
            }
        }
        for tree in trees {
            let p = format!("{prefix}{tree}-");
            let records: Vec<_> = spans.iter().filter(|s| s.name.starts_with(&p)).collect();
            let first = records[0];
            if let Some(other) = records.iter().skip(1).find(|s| {
                s.range.len() == first.range.len()
                    && raw[s.range.clone()] != raw[first.range.clone()]
            }) {
                let mut bytes = raw.clone();
                bytes[first.range.clone()].copy_from_slice(&raw[other.range.clone()]);
                bytes[other.range.clone()].copy_from_slice(&raw[first.range.clone()]);
                cases.push(Case {
                    name: format!("{prefix}{tree}-query-order"),
                    bytes,
                    canonical: true,
                });
            }
        }
    }
    let mut noncanonical = raw.clone();
    noncanonical[..4].copy_from_slice(&P.to_le_bytes());
    cases.push(Case {
        name: "noncanonical-field".into(),
        bytes: noncanonical,
        canonical: false,
    });
    let mut trailing = raw.clone();
    trailing.extend_from_slice(&0u32.to_le_bytes());
    cases.push(Case {
        name: "trailing-field".into(),
        bytes: trailing,
        canonical: false,
    });
    for (name, length) in [
        ("truncated-field", raw.len() - 1),
        ("truncated-first-field", 3),
    ] {
        cases.push(Case {
            name: name.into(),
            bytes: raw[..length].to_vec(),
            canonical: false,
        });
    }
    let mut journal = fs::OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(out.join("attempts.jsonl"))?;
    let mut failures = 0;
    // Positive control binds all negative results to the independent expected statement.
    for (index, case) in std::iter::once(Case {
        name: "positive-control".into(),
        bytes: raw,
        canonical: true,
    })
    .chain(cases)
    .enumerate()
    {
        let case_path = out.join(format!("{:03}-{}.bin", index, case.name));
        if case.canonical && encode(&decode(&case.bytes)?) != case.bytes {
            return Err("mutation failed canonical re-decode".into());
        }
        let mut compressed = header.to_vec();
        compressed.extend(zstd::encode_all(case.bytes.as_slice(), 0)?);
        fs::write(&case_path, compressed)?;
        writeln!(
            journal,
            "{}",
            json!({"index":index,"name":case.name,"status":"started","canonical_decode":case.canonical,"proof_sha256":digest(&case_path)?})
        )?;
        journal.flush()?;
        let result = Command::new(verifier)
            .arg("verify")
            .arg(&case_path)
            .arg(expected)
            .arg(out.join(format!("{index:03}-verification")))
            .output()?;
        fs::write(out.join(format!("{index:03}.stdout")), &result.stdout)?;
        fs::write(out.join(format!("{index:03}.stderr")), &result.stderr)?;
        let accepted = result.status.success();
        let panic_rejection = verifier_panicked(result.status.code(), &result.stderr);
        let passed = boundary_passed(result.status.code(), &result.stderr, index == 0, case.canonical);
        if !passed {
            failures += 1;
        }
        writeln!(
            journal,
            "{}",
            json!({"index":index,"name":case.name,"status":if passed {"passed"} else {"failed"},"accepted":accepted,"exit_code":result.status.code(),"signal_termination":result.status.code().is_none(),"panic_rejection":panic_rejection})
        )?;
        journal.flush()?;
    }
    if digest(verifier)? != VERIFIER_SHA {
        return Err("native verifier changed during checks".into());
    }
    fs::write(
        out.join("result.json"),
        serde_json::to_vec_pretty(
            &json!({"failures":failures,"native_verifier_unchanged":true,"version_header_preserved":true}),
        )?,
    )?;
    if failures != 0 {
        return Err(format!("{failures} proof boundary checks failed").into());
    }
    Ok(())
}
