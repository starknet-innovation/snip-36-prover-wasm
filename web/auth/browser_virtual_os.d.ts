/* tslint:disable */
/* eslint-disable */
export function convert_public_proof(bytes: Uint8Array): string;
export function prepare_public_state(proof_bytes: Uint8Array, classes_bytes: Uint8Array): string;
export function public_witness_control(proof_bytes: Uint8Array, classes_bytes: Uint8Array, diff_bytes: Uint8Array): string;
export function compile_captured_class(bytes: Uint8Array): string;
export function allocation_metrics(): string;
export function run_virtual_os(hints_json: Uint8Array): ExecutionResult;
export function install_panic_hook(): void;
/**
 * Regenerates transaction call information from a complete local state snapshot.
 * The input may have an empty tx_execution_infos array; it is never used by this stage.
 */
export function prepare_transaction(hints_json: Uint8Array, snapshot_json: Uint8Array): string;
/**
 * Start from a plain RPC transaction, recompute its hash, and execute locally.
 * The supplied hints provide the base-block metadata, classes and storage witness.
 */
export function prepare_rpc_transaction(hints_json: Uint8Array, snapshot_json: Uint8Array, rpc_json: Uint8Array): string;
/**
 * Rebuild storage witnesses from the complete local facts database after browser execution.
 */
export function prepare_rpc_with_witness(hints_json: Uint8Array, snapshot_json: Uint8Array, rpc_json: Uint8Array, database_json: Uint8Array): string;
export function public_preexecute(proof_bytes: Uint8Array, classes_bytes: Uint8Array, request_bytes: Uint8Array): string;
export function sign_public_demo_request(bytes: Uint8Array): string;
export class ExecutionResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  output_json(): string;
  pie_bytes(): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly convert_public_proof: (a: number, b: number) => [number, number, number, number];
  readonly prepare_public_state: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly public_witness_control: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly compile_captured_class: (a: number, b: number) => [number, number, number, number];
  readonly __wbg_executionresult_free: (a: number, b: number) => void;
  readonly allocation_metrics: () => [number, number];
  readonly executionresult_output_json: (a: number) => [number, number];
  readonly executionresult_pie_bytes: (a: number) => [number, number];
  readonly prepare_rpc_transaction: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly prepare_rpc_with_witness: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
  readonly prepare_transaction: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly public_preexecute: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly run_virtual_os: (a: number, b: number) => [number, number, number];
  readonly sign_public_demo_request: (a: number, b: number) => [number, number, number, number];
  readonly install_panic_hook: () => void;
  readonly __wbindgen_exn_store_command_export: (a: number) => void;
  readonly __externref_table_alloc_command_export: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc_command_export: (a: number, b: number) => number;
  readonly __externref_table_dealloc_command_export: (a: number) => void;
  readonly __wbindgen_free_command_export: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
