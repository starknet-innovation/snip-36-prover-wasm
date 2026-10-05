// Adapted verbatim from starknet-innovation/snip-36-prover-backend
// revision 4c8dfb1d0d63c47284e5da0ee1068415d47f9f78, tests/contracts/src/lib.cairo.
// Apache-2.0. Demonstration only; no deposits or payouts.
#[starknet::interface]
trait ICoinFlip<TContractState> {
    fn play(ref self: TContractState, seed: felt252, player: felt252, bet: felt252);
}

#[starknet::contract]
mod CoinFlip {
    use starknet::syscalls::send_message_to_l1_syscall;
    use core::pedersen::pedersen;

    /// L1 settlement contract address (placeholder).
    const SETTLEMENT_ADDRESS: felt252 = 0x1;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl CoinFlipImpl of super::ICoinFlip<ContractState> {
        fn play(ref self: ContractState, seed: felt252, player: felt252, bet: felt252) {
            // Deterministic outcome from public inputs
            let hash = pedersen(seed, player);
            let hash_u256: u256 = hash.into();
            let outcome: felt252 = if hash_u256.low % 2 == 0 { 0 } else { 1 };

            // 1 if player guessed correctly, 0 otherwise
            let won: felt252 = if outcome == bet { 1 } else { 0 };

            // Emit settlement receipt as L2→L1 message
            // Payload: [player, seed, bet, outcome, won]
            send_message_to_l1_syscall(
                SETTLEMENT_ADDRESS,
                array![player, seed, bet, outcome, won].span(),
            ).unwrap();
        }
    }
}
