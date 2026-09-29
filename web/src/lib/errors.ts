// Turns wallet, RPC and contract errors into one plain sentence that says what to do next.
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError, formatUnits } from 'viem';
import { isUserRejection } from './wallet';

const TOKEN = 'PACT';

function amount(v: unknown): string {
  return typeof v === 'bigint' ? `${formatUnits(v, 18)} ${TOKEN}` : String(v);
}

const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  // Guilds
  AlreadyInGuild: () => 'This wallet is already in a guild. Leave it before founding or joining another.',
  AlreadyVoted: () => 'This wallet has already voted on the proposal.',
  InsufficientTreasury: (a) => `The guild treasury holds ${amount(a[0])} but ${amount(a[1])} is needed.`,
  InvalidName: () => 'Use a guild name of 1 to 32 bytes.',
  InvalidProposal: () => 'The proposal is invalid: check the tile, the named guild and the holder.',
  NoSuchGuild: () => 'That guild does not exist.',
  NoSuchProposal: () => 'That proposal does not exist.',
  NotEligibleVoter: () => 'Only members who joined before the proposal was created can vote on it.',
  NotInGuild: () => 'Join or found a guild first.',
  NotMember: () => 'This wallet is not a member of the guild.',
  NotTarget: () => 'Only the proposal target may consume it.',
  ProposalAlreadyExecuted: () => 'The proposal has already been executed.',
  ProposalExpired: () => 'The proposal expired at the end of the epoch after it was created.',
  ProposalNotApproved: () => 'The proposal does not have a majority yet.',
  TransferFailed: () => 'The token transfer failed. Check the balance and allowance.',
  WrongKind: () => 'The proposal is of a different kind than this action expects.',
  ZeroAddress: () => 'An address in this action is the zero address.',
  // Realm
  AlreadyAttacking: () => 'The guild already attacks that tile this epoch.',
  BetrayalRequiresMember: () => 'This attack breaks a pact, so only a member eligible for the vote can declare it.',
  CannotAttackOwnTile: () => 'A guild cannot attack a tile it holds.',
  EpochNotEnded: () => 'The epoch has not ended yet. Settlement opens when the clock reaches the epoch end.',
  HolderChanged: (a) => `The tile holder changed from guild ${String(a[0])} to guild ${String(a[1])}, so the attack is void.`,
  InsufficientTroops: (a) => `The guild reserve holds ${String(a[0])} troops but ${String(a[1])} are needed.`,
  InvalidParameters: () => 'The parameters are invalid.',
  InvalidTile: () => 'Choose a tile between A1 and L12.',
  NotWholeTroops: () => 'The treasury amount must buy a whole number of troops.',
  ZeroSteps: () => 'Use a step size of at least 1.',
  ZeroTroops: () => 'Buy at least 1 troop.',
  // Diplomacy
  AttackPending: () => 'An attack between these guilds is pending in an unsettled epoch. Settle it first.',
  NoSuchPact: () => 'That pact does not exist.',
  NotRealm: () => 'Only Realm may call this.',
  PactAlreadyActive: () => 'These guilds already have an active pact.',
  PactNotActive: () => 'The pact is not active.',
  PactNotEnded: () => 'The pact has not run out yet. Bonds return after its last epoch.',
  ProposalsDoNotMatch: () => 'The two pact proposals do not name each other with the same length and acceptable bonds.',
  SameGuild: () => 'A guild cannot sign a pact with itself.',
  // Season
  AlreadyClaimed: () => 'This prize has already been claimed by this wallet.',
  GuildNotEligible: () => 'The guild is not eligible: it broke a pact this season or did not exist at season end.',
  NotAWinner: () => 'The guild did not finish in the top three.',
  NotMemberAtSeasonEnd: () => 'Only members at the second the season ended can claim.',
  PreviousSeasonNotClosed: () => 'Close the previous season first.',
  SeasonAlreadyClosed: () => 'The season is already closed.',
  SeasonNotClosed: () => 'Close the season before claiming.',
  SeasonNotEnded: () => 'The season has not ended yet.',
  SeasonNotRecorded: () => 'Settle the last epoch of the season before closing it.',
  // Token
  InsufficientAllowance: (a) => `Allowance is ${amount(a[0])} but ${amount(a[1])} is needed. Approve first.`,
  InsufficientBalance: (a) => `Balance is ${amount(a[0])} but ${amount(a[1])} is needed.`,
  // Banners
  NoSuchToken: () => 'That banner does not exist.',
  NotAuthorized: () => 'This wallet is not authorised for that banner.',
  NotMinter: () => 'Only Season mints banners.',
};

export function describeError(e: unknown): string {
  if (isUserRejection(e)) return 'Rejected in the wallet. Nothing was sent.';
  if (e instanceof BaseError) {
    const rejected = e.walk((x) => x instanceof UserRejectedRequestError);
    if (rejected) return 'Rejected in the wallet. Nothing was sent.';
    const funds = e.walk((x) => x instanceof InsufficientFundsError);
    if (funds) return 'Not enough ETH to pay for gas. Add Sepolia ETH from a faucet and try again.';
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName ?? reverted.reason;
      if (name && MESSAGES[name]) return MESSAGES[name]!(reverted.data?.args ?? []);
      if (name) return `The contract rejected the call (${name}).`;
      return 'The contract rejected the call without a reason.';
    }
    if (/insufficient funds/i.test(e.shortMessage)) {
      return 'Not enough ETH to pay for gas. Add Sepolia ETH from a faucet and try again.';
    }
    return e.shortMessage;
  }
  if (e instanceof Error) {
    if (/insufficient funds/i.test(e.message)) return 'Not enough ETH to pay for gas.';
    return e.message.split('\n')[0] ?? 'Unable to complete the action.';
  }
  return 'Unable to complete the action.';
}
