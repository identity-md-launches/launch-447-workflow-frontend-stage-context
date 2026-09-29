import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { decodeFunctionData, parseEther } from 'viem';
import { makeHarness } from './test/harness';
import { ABIS, ADDR, PLAYER, MANIFEST } from './test/mockChain';
import { ERC20_ABI, PERMIT2_ABI, UNIVERSAL_ROUTER_ABI } from './lib/swap';

function go(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The header and an action gate can both offer "Connect wallet"; click the first. */
async function connect() {
  const buttons = await screen.findAllByRole('button', { name: 'Connect wallet' });
  fireEvent.click(buttons[0]!);
}

describe('Pacts app', () => {
  beforeEach(() => {
    window.location.hash = '#/';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('renders the live map from chain reads without a wallet', async () => {
    const h = await makeHarness({ noWallet: true });
    h.game.start();
    render(h.ui);
    const tile = await screen.findByRole('gridcell', { name: /Tile A1: held by Ember Compact with 3 troops/ });
    expect(tile).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /Tile F7: held by Salt Marchers with 2 troops, under attack/ })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /Tile L12: empty/ })).toBeTruthy();
    // Epoch clock from chain data
    await screen.findByText('Settled epochs');
    expect(screen.getByText(/1 ended, awaiting settlement/)).toBeTruthy();
    // Connect is the primary action
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
    h.game.stop();
  });

  it('selects a tile and shows its holder and pending attacks', async () => {
    const h = await makeHarness({ noWallet: true });
    h.game.start();
    render(h.ui);
    const tile = await screen.findByRole('gridcell', { name: /Tile F7:/ });
    fireEvent.click(tile);
    const card = screen.getByRole('heading', { name: 'Tile F7' }).closest('section')!;
    expect(within(card).getByText('Garrison').nextSibling?.textContent).toBe('2 troops');
    expect(within(card).getByText(/with 3 troops in epoch 5/)).toBeTruthy();
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    h.game.stop();
  });

  it('offers wallet_addEthereumChain when switching fails with 4902, then switches', async () => {
    const h = await makeHarness({ wallet: { chainId: 1, unknownChain: true } });
    h.game.start();
    render(h.ui);
    await connect();
    await screen.findByText('Wrong network');
    const switchBtn = screen.getByRole('button', { name: 'Switch to Sepolia' });
    fireEvent.click(switchBtn);
    await screen.findByText('Sepolia', { selector: '.badge-success' });
    const methods = h.provider.calls.map((c) => c.method);
    const first = methods.indexOf('wallet_switchEthereumChain');
    const add = methods.indexOf('wallet_addEthereumChain');
    expect(first).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(first);
    expect(methods.lastIndexOf('wallet_switchEthereumChain')).toBeGreaterThan(add);
    const addParams = h.provider.calls[add]!.params as [unknown];
    expect(addParams[0]).toEqual(MANIFEST.walletAddChain);
    h.game.stop();
  });

  it('shows the rejection message when the wallet refuses to connect', async () => {
    const h = await makeHarness({ wallet: { rejectAll: true } });
    h.game.start();
    render(h.ui);
    await connect();
    await screen.findByText('Connection request was rejected in the wallet.');
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
    h.game.stop();
  });

  it('walks the approve-then-buy troop flow with fresh allowance reads', async () => {
    const h = await makeHarness();
    h.game.start();
    go('#/play');
    render(h.ui);
    await connect();
    await screen.findByText('Sepolia', { selector: '.badge-success' });
    const input = await screen.findByLabelText('Troops');
    fireEvent.change(input, { target: { value: '2' } });
    const approve = await screen.findByRole('button', { name: /Approve 2 PACT for Realm/ });
    expect(screen.queryByRole('button', { name: /^Buy 2 troops/ })).toBeNull();
    fireEvent.click(approve);
    await screen.findByText('Approved. You can buy now.');
    const approveTx = h.state.sentTransactions[0]!;
    expect(approveTx.to.toLowerCase()).toBe(ADDR.LaunchToken.toLowerCase());
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: approveTx.data });
    expect(decoded.functionName).toBe('approve');
    expect((decoded.args as [string, bigint])[0].toLowerCase()).toBe(ADDR.Realm.toLowerCase());
    expect((decoded.args as [string, bigint])[1]).toBe(parseEther('2'));
    // The chain now reports the allowance; the button becomes Buy after the refresh.
    h.state.allowances[`${PLAYER.toLowerCase()}:${ADDR.Realm.toLowerCase()}`] = parseEther('2');
    await act(async () => {
      await h.game.refresh();
    });
    const buy = await screen.findByRole('button', { name: /Buy 2 troops for 2 PACT/ });
    fireEvent.click(buy);
    await screen.findByText('Troops bought and added to the guild reserve.');
    const buyTx = h.state.sentTransactions[1]!;
    expect(buyTx.to.toLowerCase()).toBe(ADDR.Realm.toLowerCase());
    const d2 = decodeFunctionData({ abi: ABIS.Realm!, data: buyTx.data });
    expect(d2.functionName).toBe('buyTroops');
    expect(d2.args).toEqual([2n]);
    h.game.stop();
  });

  it('shows pending votes with eligibility, a wrong-target warning and casts a vote', async () => {
    const h = await makeHarness();
    h.game.start();
    go('#/guilds/1');
    render(h.ui);
    await connect();
    await screen.findByRole('heading', { name: /Ember Compact/ });
    await screen.findByText(/Attack tile F7 held by/);
    // Proposal 3 targets a stranger instead of Realm.
    expect(screen.getByText(/is not the Realm contract/)).toBeTruthy();
    const yesButtons = await screen.findAllByRole('button', { name: 'Vote yes' });
    expect(yesButtons.length).toBe(2);
    fireEvent.click(yesButtons[0]!);
    await screen.findByText('Vote recorded.');
    const tx = h.state.sentTransactions[0]!;
    expect(tx.to.toLowerCase()).toBe(ADDR.Guilds.toLowerCase());
    const d = decodeFunctionData({ abi: ABIS.Guilds!, data: tx.data });
    expect(d.functionName).toBe('vote');
    // Newest proposal first: #3 is the wrong-target TreasuryTroops proposal.
    expect(d.args).toEqual([3n, true]);
    // Members list from logs
    expect(screen.getByText('you')).toBeTruthy();
    h.game.stop();
  });

  it('quotes an ETH to PACT swap and requires Permit2 approval when selling PACT', async () => {
    const h = await makeHarness();
    h.game.start();
    go('#/swap');
    render(h.ui);
    await connect();
    await screen.findByText('Sepolia', { selector: '.badge-success' });
    fireEvent.change(screen.getByLabelText(/You pay \(ETH\)/), { target: { value: '0.001' } });
    await screen.findByText('50 PACT', {}, { timeout: 3000 });
    const swapBtn = await screen.findByRole('button', { name: /Swap 0.001 ETH for at least 49\.75 PACT/ });
    fireEvent.click(swapBtn);
    await screen.findByText('Swap confirmed.');
    const tx = h.state.sentTransactions[0]!;
    expect(tx.to.toLowerCase()).toBe(MANIFEST.network!.uniswapV4!.universalRouter.toLowerCase());
    expect(tx.value).toBe(parseEther('0.001'));
    const d = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: tx.data });
    expect(d.functionName).toBe('execute');
    expect(d.args![0]).toBe('0x10');

    fireEvent.click(screen.getByRole('button', { name: 'PACT to ETH' }));
    fireEvent.change(screen.getByLabelText(/You pay \(PACT\)/), { target: { value: '10' } });
    const approvePermit2 = await screen.findByRole('button', { name: /Approve 10 PACT for Permit2/ });
    fireEvent.click(approvePermit2);
    await screen.findByText('Token approved for Permit2.');
    const t2 = h.state.sentTransactions[1]!;
    const d2 = decodeFunctionData({ abi: ERC20_ABI, data: t2.data });
    expect((d2.args as [string, bigint])[0].toLowerCase()).toBe(MANIFEST.network!.uniswapV4!.permit2.toLowerCase());
    h.state.allowances[`${PLAYER.toLowerCase()}:${MANIFEST.network!.uniswapV4!.permit2.toLowerCase()}`] = parseEther('10');
    await act(async () => {
      await h.game.refresh();
    });
    const allowRouter = await screen.findByRole('button', { name: 'Allow the router in Permit2' });
    fireEvent.click(allowRouter);
    await screen.findByText('Router allowed in Permit2.');
    const t3 = h.state.sentTransactions[2]!;
    const d3 = decodeFunctionData({ abi: PERMIT2_ABI, data: t3.data });
    expect(d3.functionName).toBe('approve');
    h.game.stop();
  });

  it('translates a contract revert into a plain message and keeps the control usable', async () => {
    const { toFunctionSelector, getAbiItem, encodeErrorResult } = await import('viem');
    const buySel = toFunctionSelector(getAbiItem({ abi: ABIS.Realm!, name: 'buyTroops' }) as never);
    const revertData = encodeErrorResult({ abi: ABIS.Realm!, errorName: 'NotInGuild' });
    const h = await makeHarness({ rpc: { reverts: { [buySel]: revertData } } });
    h.state.allowances[`${PLAYER.toLowerCase()}:${ADDR.Realm.toLowerCase()}`] = parseEther('100');
    h.game.start();
    go('#/play');
    render(h.ui);
    await connect();
    const buyBtn = await screen.findByRole('button', { name: /Buy 1 troops for 1 PACT/ });
    fireEvent.click(buyBtn);
    await screen.findByText('Join or found a guild first.', {}, { timeout: 5000 });
    await waitFor(() => expect((screen.getByRole('button', { name: /Buy 1 troops for 1 PACT/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(h.state.sentTransactions.length).toBe(0);
    h.game.stop();
  });
});
