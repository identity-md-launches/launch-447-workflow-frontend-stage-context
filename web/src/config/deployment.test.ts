import { describe, expect, it } from 'vitest';
import { DeploymentError, loadAppConfig, validateDeployment } from './deployment';
import { loadTestConfig } from '../test/harness';
import { ABIS, MANIFEST } from '../test/mockChain';

describe('deployment configuration', () => {
  it('loads addresses, chain, RPCs, Uniswap block and ABIs from imd-deployment.json only', async () => {
    const config = await loadTestConfig();
    expect(config.chain.id).toBe(11155111);
    expect(config.chainIdHex).toBe('0xaa36a7');
    expect(config.rpcUrls).toEqual(MANIFEST.network!.rpcUrls);
    expect(config.addresses.Realm.toLowerCase()).toBe('0x206bbcb9b91793decd1819e366334ab6dbbdc990');
    expect(config.uniswap?.universalRouter).toBe(MANIFEST.network!.uniswapV4!.universalRouter);
    expect(config.abis.Guilds.length).toBeGreaterThan(10);
    expect(config.abis.Banners.length).toBeGreaterThan(5);
    expect(config.swapDisabledReason).toBeNull();
    expect(config.walletAddChain).toEqual(MANIFEST.walletAddChain);
  });

  it('disables swaps when the network block is absent', async () => {
    const config = await loadTestConfig((m) => {
      delete m.network;
      delete m.walletAddChain;
      return m;
    });
    expect(config.swapDisabledReason).toMatch(/not in the vetted network table/);
    expect(config.rpcUrls).toEqual([]);
  });

  it('rejects manifests missing a handoff contract or with unsafe ABI paths', () => {
    expect(() => validateDeployment({ ...MANIFEST, contracts: MANIFEST.contracts.filter((c) => c.name !== 'Realm') })).toThrow(DeploymentError);
    expect(() =>
      validateDeployment({ ...MANIFEST, contracts: MANIFEST.contracts.map((c) => ({ ...c, abiPath: '../abi/x.json' })) }),
    ).toThrow(/relative/);
    expect(() => validateDeployment({ ...MANIFEST, version: 2 })).toThrow(/version/);
  });

  it('fails clearly when an ABI is not an array', async () => {
    await expect(
      loadAppConfig('./', async (path) => (path === './imd-deployment.json' ? MANIFEST : path.includes('Guilds') ? { bad: true } : ABIS.Realm)),
    ).rejects.toThrow(/not an ABI array/);
  });
});
