// Uniswap v4 swap helpers: pool key, pool id, quoting and Universal Router calldata.
// Router, quoter, Permit2 and StateView addresses come from the network block of
// imd-deployment.json at runtime; nothing here names an address.
import { encodeAbiParameters, keccak256, parseAbi, zeroAddress, type Address, type Hex } from 'viem';

export const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

export const PERMIT2_ABI = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export const QUOTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

export const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** Builds the pool key: native ETH (zero address) always sorts first; otherwise sort ascending. */
export function buildPoolKey(token: Address, paired: Address, fee: number, tickSpacing: number, hooks: Address): PoolKey {
  const [c0, c1] =
    paired === zeroAddress || BigInt(paired) < BigInt(token) ? [paired, token] : [token, paired];
  return { currency0: c0, currency1: c1, fee, tickSpacing, hooks };
}

export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ],
      [key],
    ),
  );
}

export const V4_SWAP_COMMAND: Hex = '0x10';
/** SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f). */
export const V4_ACTIONS: Hex = '0x060c0f';

const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;

export interface SwapPlan {
  key: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

/** Encodes `execute(commands, inputs, deadline)` arguments for one exact-input single-pool swap. */
export function encodeV4Swap(plan: SwapPlan): { commands: Hex; inputs: Hex[]; value: bigint } {
  const inputCurrency = plan.zeroForOne ? plan.key.currency0 : plan.key.currency1;
  const outputCurrency = plan.zeroForOne ? plan.key.currency1 : plan.key.currency0;
  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      {
        poolKey: plan.key,
        zeroForOne: plan.zeroForOne,
        amountIn: plan.amountIn,
        amountOutMinimum: plan.amountOutMinimum,
        hookData: '0x',
      },
    ],
  );
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, plan.amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputCurrency, plan.amountOutMinimum]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [V4_ACTIONS, [swapParams, settle, take]]);
  return {
    commands: V4_SWAP_COMMAND,
    inputs: [input],
    value: inputCurrency === zeroAddress ? plan.amountIn : 0n,
  };
}

/** Applies slippage in basis points to a quoted output. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** token1 per token0 from sqrtPriceX96 (both 18 decimals here). Returns a JS number for display. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const q96 = 2 ** 96;
  const sqrt = Number(sqrtPriceX96) / q96;
  return sqrt * sqrt * 10 ** (decimals0 - decimals1);
}

export const PERMIT2_MAX_UINT160 = (1n << 160n) - 1n;
export const PERMIT2_MAX_EXPIRATION = (1 << 30) * 4 - 1; // fits uint48; about year 2106
