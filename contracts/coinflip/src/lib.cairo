// Adapted verbatim from starknet-innovation/snip-36-prover-backend
// revision 4c8dfb1d0d63c47284e5da0ee1068415d47f9f78, tests/contracts/src/lib.cairo.
// Apache-2.0. Demonstration only; no deposits or payouts.
#[starknet::interface]
trait ICoinFlip<TContractState> {
    fn play(ref self: TContractState, seed: felt252, player: felt252, bet: felt252);
}

#[starknet::contract]
mod CoinFlip {
    use core::pedersen::pedersen;
    use starknet::syscalls::send_message_to_l1_syscall;

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
            let outcome: felt252 = if hash_u256.low % 2 == 0 {
                0
            } else {
                1
            };

            // 1 if player guessed correctly, 0 otherwise
            let won: felt252 = if outcome == bet {
                1
            } else {
                0
            };

            // Emit settlement receipt as L2→L1 message
            // Payload: [player, seed, bet, outcome, won]
            send_message_to_l1_syscall(
                SETTLEMENT_ADDRESS, array![player, seed, bet, outcome, won].span(),
            )
                .unwrap();
        }
    }
}

#[starknet::interface]
trait IToken<TContractState> {
    fn transfer_from(
        ref self: TContractState,
        sender: starknet::ContractAddress,
        recipient: starknet::ContractAddress,
        amount: u256,
    ) -> bool;
    fn transfer(
        ref self: TContractState, recipient: starknet::ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
trait IBrowserCoinFlipBank<TContractState> {
    fn fund(ref self: TContractState, amount: u256);
    fn liquidity(self: @TContractState) -> u256;
    fn deposit(ref self: TContractState, session: felt252, commitment: felt252, amount: u256);
    fn match_deposit(ref self: TContractState, session: felt252);
    fn reveal(ref self: TContractState, session: felt252, choice: felt252, nonce: felt252);
    fn settle(ref self: TContractState, session: felt252, outcome: felt252);
    fn refund_unmatched(ref self: TContractState, session: felt252);
    fn expire_unrevealed(ref self: TContractState, session: felt252);
    fn get_game(
        self: @TContractState, session: felt252,
    ) -> (felt252, u256, felt252, u64, felt252, felt252, u8, u64);
    fn get_config(self: @TContractState) -> (felt252, felt252, felt252);
}

// Each settlement must carry a verified SNIP-36 statement for this exact game.
// Kept separate for deterministic tests without an RPC or signing credentials.
use core::poseidon::poseidon_hash_span;

fn assert_coinflip_fact(
    facts: Span<felt252>,
    coinflip: felt252,
    player: felt252,
    seed: felt252,
    choice: felt252,
    outcome: felt252,
) {
    assert(choice == 0 || choice == 1, 'Invalid choice');
    assert(outcome == 0 || outcome == 1, 'Invalid outcome');
    assert(facts.len() == 9, 'Expected one proof message');
    assert(*facts.at(0) == 'PROOF1', 'Wrong proof version');
    assert(*facts.at(1) == 'VIRTUAL_SNOS', 'Wrong proof variant');
    assert(
        *facts.at(2) == 0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1,
        'Wrong program',
    );
    assert(*facts.at(3) == 'VIRTUAL_SNOS0', 'Wrong output version');
    assert(*facts.at(7) == 1, 'Expected one message');
    let won = if outcome == choice {
        1
    } else {
        0
    };
    let hash = poseidon_hash_span(
        array![coinflip, 1, 5, player, seed, choice, outcome, won].span(),
    );
    assert(*facts.at(8) == hash, 'Game proof mismatch');
}

#[starknet::contract]
mod BrowserCoinFlipBank {
    use core::num::traits::Zero;
    use core::pedersen::pedersen;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::{get_block_hash_syscall, get_execution_info_v3_syscall};
    use starknet::{
        ContractAddress, get_block_number, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use super::{ITokenDispatcher, ITokenDispatcherTrait, assert_coinflip_fact};

    const TOKEN: felt252 = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d;
    const MAX_STAKE: u256 = 10000000000000000; // 0.01 testnet STRK.
    const REFUND_DELAY: u64 = 3600;
    const REVEAL_DEADLINE: u64 = 86400;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        coinflip: ContractAddress,
        available_liquidity: u256,
        player: Map<felt252, ContractAddress>,
        amount: Map<felt252, u256>,
        commitment: Map<felt252, felt252>,
        seed_block: Map<felt252, u64>,
        seed: Map<felt252, felt252>,
        choice: Map<felt252, felt252>,
        state: Map<
            felt252, u8,
        >, // 1 deposited, 2 matched, 3 revealed, 4 paid, 5 refunded, 6 expired.
        deadline: Map<felt252, u64>,
    }
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, coinflip: ContractAddress) {
        assert(!owner.is_zero() && !coinflip.is_zero(), 'Zero configuration');
        self.owner.write(owner);
        self.coinflip.write(coinflip);
    }
    #[abi(embed_v0)]
    impl Bank of super::IBrowserCoinFlipBank<ContractState> {
        fn fund(ref self: ContractState, amount: u256) {
            assert(get_caller_address() == self.owner.read(), 'Only bank owner');
            assert(amount > 0, 'Zero funding');
            self.available_liquidity.write(self.available_liquidity.read() + amount);
            let token = ITokenDispatcher { contract_address: TOKEN.try_into().unwrap() };
            assert(
                token.transfer_from(get_caller_address(), get_contract_address(), amount),
                'Funding transfer failed',
            );
        }
        fn liquidity(self: @ContractState) -> u256 {
            self.available_liquidity.read()
        }

        fn deposit(ref self: ContractState, session: felt252, commitment: felt252, amount: u256) {
            let info = get_execution_info_v3_syscall().unwrap().tx_info.unbox();
            assert(info.chain_id == 'SN_SEPOLIA', 'Sepolia only');
            assert(session != 0 && commitment != 0, 'Zero session/commitment');
            assert(self.state.read(session) == 0, 'Session exists');
            assert(amount > 0 && amount <= MAX_STAKE, 'Stake outside demo limit');
            let player = get_caller_address();
            assert(
                session == poseidon_hash_span(array![player.into(), commitment].span()),
                'Session/player mismatch',
            );
            self.state.write(session, 1);
            self.player.write(session, player);
            self.amount.write(session, amount);
            self.commitment.write(session, commitment);
            self.deadline.write(session, get_block_timestamp() + REFUND_DELAY);
            let token = ITokenDispatcher { contract_address: TOKEN.try_into().unwrap() };
            assert(
                token.transfer_from(player, get_contract_address(), amount),
                'Token transfer failed',
            );
        }
        fn match_deposit(ref self: ContractState, session: felt252) {
            assert(self.state.read(session) == 1, 'Not deposited');
            let amount = self.amount.read(session);
            assert(self.available_liquidity.read() >= amount, 'Bank liquidity exhausted');
            self.available_liquidity.write(self.available_liquidity.read() - amount);
            assert(get_block_timestamp() < self.deadline.read(session), 'Deposit expired');
            self.state.write(session, 2);
            // A future block is fixed before the choice is revealed.
            self.seed_block.write(session, get_block_number() + 1);
            self.deadline.write(session, get_block_timestamp() + REVEAL_DEADLINE);
        }
        fn reveal(ref self: ContractState, session: felt252, choice: felt252, nonce: felt252) {
            assert(get_caller_address() == self.player.read(session), 'Only player');
            assert(self.state.read(session) == 2, 'Not matched');
            assert(get_block_timestamp() < self.deadline.read(session), 'Reveal expired');
            assert(choice == 0 || choice == 1, 'Invalid choice');
            assert(pedersen(choice, nonce) == self.commitment.read(session), 'Commitment mismatch');
            let seed_block = self.seed_block.read(session);
            assert(get_block_number() >= seed_block + 10, 'Wait for seed block');
            let block_hash = get_block_hash_syscall(seed_block).unwrap();
            assert(block_hash != 0, 'Missing seed block');
            let seed = poseidon_hash_span(array![session, block_hash].span());
            self.seed.write(session, seed);
            self.choice.write(session, choice);
            self.state.write(session, 3);
        }
        fn settle(ref self: ContractState, session: felt252, outcome: felt252) {
            assert(self.state.read(session) == 3, 'Not revealed');
            let info = get_execution_info_v3_syscall().unwrap().tx_info.unbox();
            assert(info.chain_id == 'SN_SEPOLIA', 'Sepolia only');
            let player = self.player.read(session);
            let choice = self.choice.read(session);
            assert_coinflip_fact(
                info.proof_facts,
                self.coinflip.read().into(),
                player.into(),
                self.seed.read(session),
                choice,
                outcome,
            );
            self.state.write(session, 4);
            let payout = self.amount.read(session) * 2;
            if choice == outcome {
                let token = ITokenDispatcher { contract_address: TOKEN.try_into().unwrap() };
                assert(token.transfer(player, payout), 'Payout transfer failed');
            } else {
                self.available_liquidity.write(self.available_liquidity.read() + payout);
            }
        }
        fn refund_unmatched(ref self: ContractState, session: felt252) {
            assert(get_caller_address() == self.player.read(session), 'Only player');
            assert(self.state.read(session) == 1, 'Not unmatched');
            assert(get_block_timestamp() >= self.deadline.read(session), 'Wait for refund');
            self.state.write(session, 5);
            let token = ITokenDispatcher { contract_address: TOKEN.try_into().unwrap() };
            assert(
                token.transfer(self.player.read(session), self.amount.read(session)),
                'Refund failed',
            );
        }
        fn expire_unrevealed(ref self: ContractState, session: felt252) {
            assert(self.state.read(session) == 2, 'Not awaiting reveal');
            assert(get_block_timestamp() >= self.deadline.read(session), 'Reveal still open');
            self.state.write(session, 6);
            self
                .available_liquidity
                .write(self.available_liquidity.read() + self.amount.read(session) * 2);
        }
        fn get_game(
            self: @ContractState, session: felt252,
        ) -> (felt252, u256, felt252, u64, felt252, felt252, u8, u64) {
            (
                self.player.read(session).into(),
                self.amount.read(session),
                self.commitment.read(session),
                self.seed_block.read(session),
                self.seed.read(session),
                self.choice.read(session),
                self.state.read(session),
                self.deadline.read(session),
            )
        }
        fn get_config(self: @ContractState) -> (felt252, felt252, felt252) {
            (self.owner.read().into(), self.coinflip.read().into(), TOKEN)
        }
    }
}

#[cfg(test)]
mod proof_tests {
    use core::poseidon::poseidon_hash_span;
    use super::assert_coinflip_fact;
    fn facts(player: felt252, seed: felt252, choice: felt252, outcome: felt252) -> Array<felt252> {
        let won = if choice == outcome {
            1
        } else {
            0
        };
        let h = poseidon_hash_span(array![123, 1, 5, player, seed, choice, outcome, won].span());
        array![
            'PROOF1', 'VIRTUAL_SNOS',
            0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1, 'VIRTUAL_SNOS0', 100,
            101, 102, 1, h,
        ]
    }
    #[test]
    fn matching_game_fact() {
        assert_coinflip_fact(facts(7, 8, 0, 0).span(), 123, 7, 8, 0, 0);
        assert_coinflip_fact(facts(7, 8, 1, 0).span(), 123, 7, 8, 1, 0);
    }
    #[test]
    #[should_panic]
    fn missing_proof() {
        assert_coinflip_fact(array![].span(), 123, 7, 8, 0, 0);
    }
    #[test]
    #[should_panic]
    fn different_player() {
        assert_coinflip_fact(facts(7, 8, 0, 0).span(), 123, 9, 8, 0, 0);
    }
    #[test]
    #[should_panic]
    fn different_game_seed() {
        assert_coinflip_fact(facts(7, 8, 0, 0).span(), 123, 7, 9, 0, 0);
    }
    #[test]
    #[should_panic]
    fn different_outcome() {
        assert_coinflip_fact(facts(7, 8, 0, 0).span(), 123, 7, 8, 0, 1);
    }
    #[test]
    #[should_panic]
    fn different_contract() {
        assert_coinflip_fact(facts(7, 8, 0, 0).span(), 124, 7, 8, 0, 0);
    }
}

// A permissionless executor for this one public computation. It holds no key or
// funds, cannot transfer tokens, and rejects nonzero fee prices. Its purpose is
// to produce virtual CoinFlip statements; the player's wallet authorizes money.
#[starknet::contract(account)]
mod PublicCoinFlipExecutor {
    use core::num::traits::Zero;
    use starknet::account::Call;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::{call_contract_syscall, get_execution_info_v3_syscall};
    use starknet::{ContractAddress, get_caller_address};
    #[storage]
    struct Storage {
        coinflip: ContractAddress,
    }
    #[constructor]
    fn constructor(ref self: ContractState, coinflip: ContractAddress) {
        self.coinflip.write(coinflip);
    }
    fn check(self: @ContractState, calls: Span<Call>) {
        assert(calls.len() == 1, 'One public call only');
        let call = calls.at(0);
        assert(*call.to == self.coinflip.read(), 'CoinFlip only');
        assert(*call.selector == selector!("play"), 'Play only');
        assert(call.calldata.len() == 3, 'Three play arguments');
        let bet = *call.calldata.at(2);
        assert(bet == 0 || bet == 1, 'Invalid choice');
        let info = get_execution_info_v3_syscall().unwrap().tx_info.unbox();
        assert(info.chain_id == 'SN_SEPOLIA', 'Sepolia only');
        assert(info.tip == 0, 'No fee tip');
        for bound in info.resource_bounds {
            assert(*bound.max_price_per_unit == 0, 'Virtual execution only');
        }
        assert(info.proof_facts.len() == 0, 'No nested proof');
    }
    #[external(v0)]
    fn __validate__(self: @ContractState, calls: Array<Call>) -> felt252 {
        check(self, calls.span());
        starknet::VALIDATED
    }
    #[external(v0)]
    fn __execute__(self: @ContractState, calls: Array<Call>) -> Array<Span<felt252>> {
        assert(get_caller_address().is_zero(), 'Direct transactions only');
        check(self, calls.span());
        let call = calls.at(0);
        array![call_contract_syscall(*call.to, *call.selector, *call.calldata).unwrap()]
    }
}
