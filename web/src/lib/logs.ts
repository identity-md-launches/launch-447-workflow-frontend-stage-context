// Event log retrieval in bounded block ranges, with adaptive halving when a public RPC rejects a
// range. The feed, membership, betrayals and banners are rebuilt from these logs.
import { parseEventLogs, type Abi, type Address, type Log, type PublicClient } from 'viem';
import type { FeedItem } from './game';

export const LOG_CHUNK = 10_000n;
export const MIN_CHUNK = 500n;

export async function fetchLogsChunked(
  client: PublicClient,
  addresses: Address[],
  fromBlock: bigint,
  toBlock: bigint,
  chunk = LOG_CHUNK,
): Promise<Log[]> {
  const out: Log[] = [];
  let from = fromBlock;
  let size = chunk;
  while (from <= toBlock) {
    const to = from + size - 1n > toBlock ? toBlock : from + size - 1n;
    try {
      const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
      out.push(...logs);
      from = to + 1n;
      if (size < chunk) size = size * 2n > chunk ? chunk : size * 2n;
    } catch (e) {
      if (size <= MIN_CHUNK) throw e;
      size = size / 2n;
    }
  }
  return out;
}

export function decodeFeed(logs: Log[], abis: Record<string, Abi>, addressToName: Map<string, string>): FeedItem[] {
  const items: FeedItem[] = [];
  const byContract = new Map<string, Log[]>();
  for (const log of logs) {
    const name = addressToName.get(log.address.toLowerCase());
    if (!name) continue;
    const list = byContract.get(name) ?? [];
    list.push(log);
    byContract.set(name, list);
  }
  for (const [name, list] of byContract) {
    const abi = abis[name];
    if (!abi) continue;
    const parsed = parseEventLogs({ abi, logs: list, strict: false });
    for (const p of parsed) {
      if (p.blockNumber === null || p.logIndex === null || p.transactionHash === null) continue;
      items.push({
        key: `${p.transactionHash}-${p.logIndex}`,
        blockNumber: p.blockNumber,
        logIndex: p.logIndex,
        txHash: p.transactionHash,
        contract: name,
        event: p.eventName,
        args: (p.args ?? {}) as Record<string, unknown>,
      });
    }
  }
  items.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return items;
}
