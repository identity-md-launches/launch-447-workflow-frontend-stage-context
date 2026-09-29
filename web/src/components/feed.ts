import { formatAmount, shortAddress, tileLabel } from '../lib/format';
import { Kind, KIND_LABEL, type FeedItem, type GuildInfo } from '../lib/game';

/** One plain sentence per event, for the feed. */
export function describeEvent(item: FeedItem, guilds: GuildInfo[]): string {
  const a = item.args;
  const g = (v: unknown) => {
    const id = Number(v ?? 0);
    if (id <= 0) return 'nobody';
    const name = guilds.find((x) => x.id === id)?.name;
    return name ? `${name} (#${id})` : `guild #${id}`;
  };
  const n = (v: unknown) => String(v ?? '');
  const amt = (v: unknown) => `${formatAmount((v as bigint) ?? 0n)} PACT`;
  const addr = (v: unknown) => shortAddress(String(v ?? ''));
  const tile = (v: unknown) => tileLabel(Number(v ?? 0));
  switch (`${item.contract}.${item.event}`) {
    case 'Guilds.GuildFounded':
      return `${addr(a.founder)} founded ${g(a.guildId)} “${n(a.name)}”.`;
    case 'Guilds.MemberJoined':
      return `${addr(a.member)} joined ${g(a.guildId)}.`;
    case 'Guilds.MemberLeft':
      return `${addr(a.member)} left ${g(a.guildId)}.`;
    case 'Guilds.MemberExpelled':
      return `${addr(a.member)} was expelled from ${g(a.guildId)} by proposal #${n(a.proposalId)}.`;
    case 'Guilds.ProposalCreated': {
      const kind = Number(a.kind) as Kind;
      let detail = '';
      if (kind === Kind.Attack) detail = ` on tile ${tile(a.data1)} held by ${g(a.data2)} with ${n(a.data3)} troops`;
      else if (kind === Kind.Pact) detail = ` with ${g(a.data1)} for ${n(a.data2)} epochs, bond ${amt(a.amount)}`;
      else if (kind === Kind.Payout) detail = ` of ${amt(a.amount)} to ${addr(a.target)}`;
      else if (kind === Kind.TreasuryTroops) detail = ` spending ${amt(a.amount)}`;
      else if (kind === Kind.Expel) detail = ` of ${addr(a.target)}`;
      return `${addr(a.proposer)} proposed #${n(a.proposalId)} for ${g(a.guildId)}: ${KIND_LABEL[kind] ?? 'proposal'}${detail}.`;
    }
    case 'Guilds.VoteCast':
      return `${addr(a.voter)} voted ${a.support ? 'yes' : 'no'} on proposal #${n(a.proposalId)} (${n(a.yesVotes)} yes, ${n(a.noVotes)} no).`;
    case 'Guilds.ProposalApproved':
      return `Proposal #${n(a.proposalId)} reached a majority.`;
    case 'Guilds.ProposalExecuted':
      return `Proposal #${n(a.proposalId)} was executed.`;
    case 'Guilds.ProposalConsumed':
      return `Proposal #${n(a.proposalId)} was consumed by ${addr(a.consumer)} for ${amt(a.amount)}.`;
    case 'Guilds.TreasuryDeposited':
      return `${addr(a.from)} deposited ${amt(a.amount)} into the treasury of ${g(a.guildId)}.`;
    case 'Guilds.TreasuryPaid':
      return `${g(a.guildId)} paid ${amt(a.amount)} to ${addr(a.to)} (proposal #${n(a.proposalId)}).`;
    case 'Realm.TroopsBought':
      return `${addr(a.payer)} bought ${n(a.troops)} troops for ${g(a.guildId)} (${amt(a.cost)}, fee ${amt(a.fee)}) in epoch ${n(a.epoch)}.`;
    case 'Realm.AttackDeclared':
      return `${g(a.attacker)} declared an attack on ${tile(a.tile)} held by ${g(a.defender)} with ${n(a.troops)} troops in epoch ${n(a.epoch)}.`;
    case 'Realm.AttackResolved':
      return `${g(a.attacker)} ${a.won ? 'won' : 'lost'} at ${tile(a.tile)} in epoch ${n(a.epoch)}: committed ${n(a.committed)}, lost ${n(a.lost)}.`;
    case 'Realm.AttackVoided':
      return `Attack by ${g(a.attacker)} on ${tile(a.tile)} was void: holder changed from ${g(a.expectedHolder)} to ${g(a.actualHolder)}; ${n(a.troops)} troops returned.`;
    case 'Realm.TileResolved':
      return `${tile(a.tile)} is held by ${g(a.holder)} with ${n(a.garrison)} troops after epoch ${n(a.epoch)}${Number(a.previousHolder) !== Number(a.holder) ? ` (taken from ${g(a.previousHolder)})` : ''}.`;
    case 'Realm.EpochSettled':
      return `Epoch ${n(a.epoch)} settled: ${amt(a.income)} of income over ${n(a.heldTiles)} held tiles.`;
    case 'Realm.IncomeCollected':
      return `${amt(a.amount)} of tile income moved to the treasury of ${g(a.guildId)}.`;
    case 'Realm.StandingsRecorded': {
      const ids = (a.guildIds as readonly bigint[]) ?? [];
      return `Season ${n(a.season)} standings recorded: ${ids.map((id) => g(id)).join(', ')}.`;
    }
    case 'Diplomacy.PactSigned':
      return `Pact #${n(a.pactId)} signed between ${g(a.guildA)} (bond ${amt(a.bondA)}) and ${g(a.guildB)} (bond ${amt(a.bondB)}) for epochs ${n(a.startEpoch)} to ${n(a.endEpoch)}.`;
    case 'Diplomacy.PactBroken':
      return `Betrayal: ${g(a.betrayer)} attacked pact partner ${g(a.victim)} in epoch ${n(a.epoch)}; ${amt(a.slashed)} paid to the victim (pact #${n(a.pactId)}).`;
    case 'Diplomacy.PactExpired':
      return `Pact #${n(a.pactId)} expired unbroken and its bonds were returned.`;
    case 'Season.FeeRecorded':
      return `Season ${n(a.season)} prize pool grew by ${amt(a.amount)} to ${amt(a.pool)}.`;
    case 'Season.SeasonClosed':
      return `Season ${n(a.season)} closed with ${amt(a.rollover)} rolled over.`;
    case 'Season.PrizeClaimed':
      return `${addr(a.member)} claimed ${amt(a.amount)} for ${g(a.guildId)} in season ${n(a.season)} (banner #${n(a.tokenId)}).`;
    case 'Season.PeaceBannerMinted':
      return `Peace banner #${n(a.tokenId)} minted for ${g(a.guildId)} for season ${n(a.season)}.`;
    case 'Banners.BannerMinted':
      return `Banner #${n(a.tokenId)} (${Number(a.kind) === 0 ? `Winner, rank ${n(a.rank)}` : 'Peace'}) minted to ${addr(a.to)} for ${g(a.guildId)}, season ${n(a.season)}.`;
    case 'Banners.Transfer':
      return `Banner #${n(a.tokenId)} transferred from ${addr(a.from)} to ${addr(a.to)}.`;
    default:
      return `${item.contract}.${item.event}`;
  }
}
