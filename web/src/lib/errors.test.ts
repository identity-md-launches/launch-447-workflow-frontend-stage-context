import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, parseEther } from 'viem';
import { describeError } from './errors';
import { ABIS } from '../test/mockChain';

describe('describeError', () => {
  it('maps custom errors with arguments to plain sentences', () => {
    const revert = new ContractFunctionRevertedError({
      abi: ABIS.Realm!,
      functionName: 'buyTroops',
      data: '0x' + 'e1c9b3d5'.padEnd(8, '0') as `0x${string}`,
    });
    // Force the decoded shape the way viem produces it for a known error.
    Object.assign(revert, { data: { errorName: 'InsufficientTroops', args: [3n, 5n] } });
    const wrapped = new BaseError('reverted', { cause: revert });
    expect(describeError(wrapped)).toBe('The guild reserve holds 3 troops but 5 are needed.');
    Object.assign(revert, { data: { errorName: 'InsufficientBalance', args: [parseEther('1'), parseEther('2')] } });
    expect(describeError(new BaseError('reverted', { cause: revert }))).toBe('Balance is 1 PACT but 2 PACT is needed.');
  });

  it('reports wallet rejection without blaming the user', () => {
    expect(describeError(new UserRejectedRequestError(new Error('User rejected')))).toBe('Rejected in the wallet. Nothing was sent.');
    expect(describeError({ code: 4001, message: 'User rejected the request.' })).toBe('Rejected in the wallet. Nothing was sent.');
  });

  it('falls back to a short message for unknown errors', () => {
    expect(describeError(new Error('boom\nstack'))).toBe('boom');
    expect(describeError('x')).toBe('Unable to complete the action.');
  });
});
