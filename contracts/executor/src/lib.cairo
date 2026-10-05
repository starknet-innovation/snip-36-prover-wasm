// A permissionless executor for this one public computation. It holds no key or
// funds, cannot transfer tokens, and rejects nonzero fee prices. Its purpose is
// to produce virtual CoinFlip statements; the player's wallet authorizes money.
#[starknet::contract(account)]
mod PublicCoinFlipExecutor {
    use core::num::traits::Zero;
    use starknet::account::Call;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::{call_contract_syscall, get_execution_info_v2_syscall};
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
        let info = get_execution_info_v2_syscall().unwrap().tx_info.unbox();
        assert(info.chain_id == 'SN_SEPOLIA', 'Sepolia only');
        assert(info.tip == 0, 'No fee tip');
        for bound in info.resource_bounds {
            assert(*bound.max_price_per_unit == 0, 'Virtual execution only');
        }
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
