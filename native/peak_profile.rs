// SPDX-License-Identifier: Apache-2.0
// Measurement-only native profile of requested Rust heap per tracing span; no prover code changes.
// Run with RAYON_NUM_THREADS=1 to mirror the single-threaded browser Worker.
use cairo_vm::vm::runners::cairo_pie::CairoPie;
use privacy_prove::{prepare_recursive_prover_precomputes, privacy_recursive_prove};
use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::{error::Error, fs, path::Path};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

static LIVE: AtomicUsize = AtomicUsize::new(0);
// Highest live value since the innermost open span was entered.
static WINDOW: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

// Live blocks of at least BIG_MIN bytes with the span that allocated them, for `SNAP` events.
const BIG_MIN: usize = 1 << 20;
const BIG_SLOTS: usize = 1 << 14;
static BIG_PTR: [AtomicUsize; BIG_SLOTS] = [const { AtomicUsize::new(0) }; BIG_SLOTS];
static BIG_SIZE: [AtomicUsize; BIG_SLOTS] = [const { AtomicUsize::new(0) }; BIG_SLOTS];
static BIG_SPAN: [AtomicU64; BIG_SLOTS] = [const { AtomicU64::new(0) }; BIG_SLOTS];
static CURRENT_SPAN: AtomicU64 = AtomicU64::new(0);

fn track(ptr: *mut u8, size: usize) {
    if size < BIG_MIN { return; }
    for slot in 0..BIG_SLOTS {
        if BIG_PTR[slot].compare_exchange(0, ptr as usize, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
            BIG_SIZE[slot].store(size, Ordering::Relaxed);
            BIG_SPAN[slot].store(CURRENT_SPAN.load(Ordering::Relaxed), Ordering::Relaxed);
            return;
        }
    }
}
fn untrack(ptr: *mut u8, size: usize) {
    if size < BIG_MIN { return; }
    for slot in 0..BIG_SLOTS {
        if BIG_PTR[slot].compare_exchange(ptr as usize, 0, Ordering::Relaxed, Ordering::Relaxed).is_ok() { return; }
    }
}

fn add(bytes: usize) {
    let live = LIVE.fetch_add(bytes, Ordering::Relaxed) + bytes;
    WINDOW.fetch_max(live, Ordering::Relaxed);
    PEAK.fetch_max(live, Ordering::Relaxed);
}

struct Metered;
// SAFETY: delegates every call unchanged to System; counters never touch the memory.
unsafe impl GlobalAlloc for Metered {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() { add(layout.size()); track(ptr, layout.size()); }
        ptr
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if !ptr.is_null() { add(layout.size()); track(ptr, layout.size()); }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        untrack(ptr, layout.size());
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(ptr, layout, new_size) };
        if !result.is_null() {
            untrack(ptr, layout.size());
            track(result, new_size);
            if new_size >= layout.size() { add(new_size - layout.size()); }
            else { LIVE.fetch_sub(layout.size() - new_size, Ordering::Relaxed); }
        }
        result
    }
}
#[global_allocator]
static ALLOCATOR: Metered = Metered;

#[derive(Default)]
struct Stats { count: u64, max_peak: usize, max_live_at_enter: usize, max_growth: usize, total_ns: u128 }
#[derive(Default)]
struct State {
    names: BTreeMap<u64, String>,
    // (span id, path, live at enter, WINDOW saved from the enclosing span, entered at)
    stack: Vec<(u64, String, usize, usize, std::time::Instant)>,
    spans: BTreeMap<String, Stats>,
    stages: Vec<(String, usize, usize)>,
    paths: BTreeMap<u64, String>,
    // (message, live, [(allocating span path, bytes, blocks)])
    snapshots: Vec<(String, usize, Vec<(String, usize, usize)>)>,
}
struct Profiler { next: AtomicU64, state: Mutex<State> }

impl Subscriber for Profiler {
    fn enabled(&self, _: &Metadata<'_>) -> bool { true }
    fn new_span(&self, attributes: &Attributes<'_>) -> Id {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let meta = attributes.metadata();
        let name = if meta.name().is_empty() { meta.target().to_string() } else { meta.name().to_string() };
        self.state.lock().unwrap().names.insert(id, name);
        Id::from_u64(id)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, event: &Event<'_>) {
        if *event.metadata().level() > tracing::Level::INFO { return; }
        struct Message(String);
        impl tracing::field::Visit for Message {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" { self.0 = format!("{value:?}"); }
            }
        }
        let mut message = Message(String::new());
        event.record(&mut message);
        if !message.0.is_empty() {
            let (live, peak) = (LIVE.load(Ordering::Relaxed), PEAK.load(Ordering::Relaxed));
            let mut state = self.state.lock().unwrap();
            if message.0.starts_with("SNAP") {
                let mut by_path: BTreeMap<String, (usize, usize)> = BTreeMap::new();
                for slot in 0..BIG_SLOTS {
                    if BIG_PTR[slot].load(Ordering::Relaxed) == 0 { continue; }
                    let span = BIG_SPAN[slot].load(Ordering::Relaxed);
                    let path = state.paths.get(&span).cloned().unwrap_or_else(|| "(no span)".into());
                    let entry = by_path.entry(path).or_default();
                    entry.0 += BIG_SIZE[slot].load(Ordering::Relaxed);
                    entry.1 += 1;
                }
                let mut rows: Vec<_> = by_path.into_iter().map(|(p, (b, n))| (p, b, n)).collect();
                rows.sort_by(|a, b| b.1.cmp(&a.1));
                state.snapshots.push((message.0.clone(), live, rows));
            }
            state.stages.push((message.0, live, peak));
        }
    }
    fn enter(&self, id: &Id) {
        let mut state = self.state.lock().unwrap();
        let name = state.names.get(&id.into_u64()).cloned().unwrap_or_default();
        let path = match state.stack.last() { Some((_, parent, ..)) => format!("{parent} > {name}"), None => name };
        let live = LIVE.load(Ordering::Relaxed);
        let saved = WINDOW.swap(live, Ordering::Relaxed);
        state.paths.insert(id.into_u64(), path.clone());
        state.stack.push((id.into_u64(), path, live, saved, std::time::Instant::now()));
        CURRENT_SPAN.store(id.into_u64(), Ordering::Relaxed);
    }
    fn exit(&self, id: &Id) {
        let mut state = self.state.lock().unwrap();
        let Some(position) = state.stack.iter().rposition(|entry| entry.0 == id.into_u64()) else { return };
        // Spans close innermost-first on this single-threaded path; fold any stragglers.
        while state.stack.len() > position {
            let (_, path, enter_live, saved, entered) = state.stack.pop().unwrap();
            let peak = WINDOW.load(Ordering::Relaxed);
            WINDOW.store(saved.max(peak), Ordering::Relaxed);
            let stats = state.spans.entry(path).or_default();
            stats.count += 1;
            stats.max_peak = stats.max_peak.max(peak);
            stats.max_live_at_enter = stats.max_live_at_enter.max(enter_live);
            stats.max_growth = stats.max_growth.max(peak - enter_live);
            stats.total_ns += entered.elapsed().as_nanos();
        }
        CURRENT_SPAN.store(state.stack.last().map_or(0, |entry| entry.0), Ordering::Relaxed);
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 { return Err("usage: peak_profile PIE_ZIP OUTPUT_DIR".into()); }
    let out = Path::new(&args[2]);
    fs::create_dir_all(out)?;
    let profiler: &'static Profiler = Box::leak(Box::new(Profiler { next: AtomicU64::new(1), state: Mutex::default() }));
    tracing::subscriber::set_global_default(Proxy(profiler))?;
    let pie = CairoPie::read_zip_file(Path::new(&args[1]))?;
    let pre = prepare_recursive_prover_precomputes()?;
    let result = privacy_recursive_prove(pie, pre)?;
    fs::write(out.join("proof.bin"), &result.proof)?;
    let state = profiler.state.lock().unwrap();
    let mut spans: Vec<_> = state.spans.iter().collect();
    spans.sort_by(|a, b| b.1.max_peak.cmp(&a.1.max_peak));
    let report = serde_json::json!({
        "scope": "native requested Rust heap; RAYON_NUM_THREADS should be 1",
        "peak_bytes": PEAK.load(Ordering::Relaxed),
        "stages": state.stages.iter().map(|(m, live, peak)| serde_json::json!({"message": m, "live": live, "peak": peak})).collect::<Vec<_>>(),
        "snapshots": state.snapshots.iter().map(|(m, live, rows)| serde_json::json!({"message": m, "live": live,
            "blocks": rows.iter().map(|(p, b, n)| serde_json::json!({"span": p, "bytes": b, "count": n})).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "spans": spans.iter().map(|(path, s)| serde_json::json!({"path": path, "count": s.count, "max_peak": s.max_peak,
            "max_live_at_enter": s.max_live_at_enter, "max_growth": s.max_growth, "total_seconds": s.total_ns as f64 / 1e9})).collect::<Vec<_>>(),
    });
    fs::write(out.join("profile.json"), serde_json::to_vec_pretty(&report)?)?;
    println!("peak_bytes={}", PEAK.load(Ordering::Relaxed));
    Ok(())
}

// set_global_default needs an owned Subscriber; forward to the leaked profiler.
struct Proxy(&'static Profiler);
impl Subscriber for Proxy {
    fn enabled(&self, m: &Metadata<'_>) -> bool { self.0.enabled(m) }
    fn new_span(&self, a: &Attributes<'_>) -> Id { self.0.new_span(a) }
    fn record(&self, i: &Id, r: &Record<'_>) { self.0.record(i, r) }
    fn record_follows_from(&self, a: &Id, b: &Id) { self.0.record_follows_from(a, b) }
    fn event(&self, e: &Event<'_>) { self.0.event(e) }
    fn enter(&self, i: &Id) { self.0.enter(i) }
    fn exit(&self, i: &Id) { self.0.exit(i) }
}
