import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, parseEther, zeroAddress, type Address } from 'viem';
import { applySlippage, buildPoolKey, encodeV4Swap, poolId, priceFromSqrtX96, V4_ACTIONS } from './swap';

const TOKEN: Address = '0x7f88ad727adeb8fc70fd198f2d2319349846818c';

describe('swap helpers', () => {
  it('puts native ETH first in the pool key and reproduces the on-chain pool id', () => {
    const key = buildPoolKey(TOKEN, zeroAddress, 3000, 60, zeroAddress);
    expect(key.currency0).toBe(zeroAddress);
    expect(key.currency1).toBe(TOKEN);
    // Computed independently with `cast keccak (cast abi-encode ...)` against the deployed token.
    expect(poolId(key)).toBe('0xe23ebe92495b48485a2f5b010725213223a5cac69e92044e20d4f5f784013095');
  });

  it('sorts two ERC-20 currencies ascending', () => {
    const a: Address = '0x0000000000000000000000000000000000000002';
    const b: Address = '0x0000000000000000000000000000000000000001';
    const key = buildPoolKey(a, b, 500, 10, zeroAddress);
    expect(key.currency0).toBe(b);
    expect(key.currency1).toBe(a);
  });

  it('encodes a V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL and TAKE_ALL', () => {
    const key = buildPoolKey(TOKEN, zeroAddress, 3000, 60, zeroAddress);
    const plan = encodeV4Swap({ key, zeroForOne: true, amountIn: parseEther('0.001'), amountOutMinimum: 123n });
    expect(plan.commands).toBe('0x10');
    expect(plan.value).toBe(parseEther('0.001'));
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], plan.inputs[0]!);
    expect(actions).toBe(V4_ACTIONS);
    expect(params.length).toBe(3);
    const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    expect(settleCurrency).toBe(zeroAddress);
    expect(settleAmount).toBe(parseEther('0.001'));
    const [takeCurrency, takeMin] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!);
    expect(takeCurrency.toLowerCase()).toBe(TOKEN);
    expect(takeMin).toBe(123n);
    const [swap] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              name: 'poolKey',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[0]!,
    );
    expect(swap.zeroForOne).toBe(true);
    expect(swap.poolKey.fee).toBe(3000);
    expect(swap.poolKey.tickSpacing).toBe(60);
    expect(swap.hookData).toBe('0x');
  });

  it('sends no ETH value when the token is the input', () => {
    const key = buildPoolKey(TOKEN, zeroAddress, 3000, 60, zeroAddress);
    const plan = encodeV4Swap({ key, zeroForOne: false, amountIn: 5n, amountOutMinimum: 1n });
    expect(plan.value).toBe(0n);
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], plan.inputs[0]!);
    const [settleCurrency] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    expect(settleCurrency.toLowerCase()).toBe(TOKEN);
  });

  it('applies slippage in basis points and clamps', () => {
    expect(applySlippage(10_000n, 50)).toBe(9_950n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 20_000)).toBe(0n);
  });

  it('converts sqrtPriceX96 to a token1-per-token0 price', () => {
    const price = priceFromSqrtX96(2n ** 96n, 18, 18);
    expect(price).toBeCloseTo(1, 9);
  });
});
