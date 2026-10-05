use std::{error::Error, fs, path::Path, time::Instant};
use cairo_vm::vm::runners::cairo_pie::CairoPie;
use privacy_circuit_verify::{verify_recursive_circuit, PrivacyProofOutput};
use privacy_prove::{prepare_recursive_prover_precomputes, privacy_recursive_prove};
use starknet_types_core::felt::Felt;

fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt().with_max_level(tracing::Level::INFO).with_writer(std::io::stderr).init();
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 { return Err("usage: spike_native prove|verify PIE_OR_PROOF EXPECTED_OUTPUT OUTPUT_DIR".into()); }
    let out = Path::new(&args[4]);
    fs::create_dir_all(out)?;
    let expected: Vec<Felt> = serde_json::from_slice(&fs::read(&args[3])?)?;
    let started = Instant::now();
    let mut init_ms = 0;
    let mut prove_ms = 0;
    let proof_output = match args[1].as_str() {
        "prove" => {
            let pie = CairoPie::read_zip_file(Path::new(&args[2]))?;
            eprintln!("PIE steps: {}", pie.execution_resources.n_steps);
            let t = Instant::now();
            let pre = prepare_recursive_prover_precomputes()?;
            init_ms = t.elapsed().as_millis();
            eprintln!("SPIKE precomputes_ms={init_ms}");
            let t = Instant::now();
            let result = privacy_recursive_prove(pie, pre)?;
            prove_ms = t.elapsed().as_millis();
            fs::write(out.join("proof.bin"), &result.proof)?;
            let felts: Vec<String> = result.output_preimage.iter().map(|f| format!("{f:#x}")).collect();
            fs::write(out.join("output_preimage.json"), serde_json::to_vec_pretty(&felts)?)?;
            result
        }
        "verify" => PrivacyProofOutput { proof: fs::read(&args[2])?, output_preimage: expected.clone() },
        _ => return Err("unknown mode".into()),
    };
    if proof_output.output_preimage != expected { return Err("output preimage differs from pinned fixture".into()); }
    let t = Instant::now();
    verify_recursive_circuit(&proof_output)?;
    let report = serde_json::json!({"verified":true,"output_matches_fixture":true,"proof_bytes":proof_output.proof.len(),"precomputes_ms":init_ms,"prove_ms":prove_ms,"verify_ms":t.elapsed().as_millis(),"total_ms":started.elapsed().as_millis(),"origin":args[1]});
    fs::write(out.join("result.json"), serde_json::to_vec_pretty(&report)?)?;
    println!("{report}");
    Ok(())
}
