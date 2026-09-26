import { quoteBuyByCash, quoteSellByShares, type BuyQuote, type LmsrMarketState, type SellQuote } from "../engine/pricing/lmsr";
import { quantizeMoney, quantizeShares, toDecimal } from "../shared/decimals";
import { resolve as resolvePath } from "node:path";
import {
  DAILY_LOGIN_BASELINE_REWARD,
  EMERGENCY_GRANT_AMOUNT,
  EMERGENCY_GRANT_COOLDOWN_HOURS,
  STARTER_GRANT_AMOUNT,
  readDailyStreakReward,
  readNextDailyStreakDay
} from "../economy/economy-config";

export type EconomySimMode = "faucet-sizing" | "wash-transfer";

type PlayerType = "sharp" | "noise" | "anti-sharp";

type Dec = ReturnType<typeof toDecimal>;

type EconomyPlayer = {
  id: number;
  type: PlayerType;
  balance: Dec;
  lastEmergencyClaimDay: number | null;
  streakDay: number;
  positions: Map<string, Map<number, Dec>>;
};

type SimulatedMarket = {
  id: string;
  liquidityClass: string;
  liquidityB: string;
  trueOutcome: 0 | 1;
  state: LmsrMarketState;
};

export type FaucetSizingOptions = {
  mode: "faucet-sizing";
  users: number;
  days: number;
  seed: number;
  json: boolean;
};

export type WashTransferOptions = {
  mode: "wash-transfer";
  seed: number;
  json: boolean;
};

export type EconomySimOptions = FaucetSizingOptions | WashTransferOptions;

type WashTransferRow = {
  liquidityB: string;
  amount: string;
  shares: string;
  cashSpent: string;
  cashReturned: string;
  efficiency: string;
  lossRate: string;
  lossAmount: string;
};

export type EconomySimResult =
  | {
      mode: "faucet-sizing";
      users: number;
      days: number;
      seed: number;
      bustRate: number;
      balanceGini: number;
      treasuryOutflow: string;
      meanBalance: string;
      medianBalance: string;
      activeRate: number;
      byType: {
        sharp: {
          users: number;
          bustRate: number;
          meanBalance: string;
          gini: number;
        };
        noise: {
          users: number;
          bustRate: number;
          meanBalance: string;
          gini: number;
        };
        "anti-sharp": {
          users: number;
          bustRate: number;
          meanBalance: string;
          gini: number;
        };
      };
    }
  | {
      mode: "wash-transfer";
      seed: number;
      transferEfficiency: Record<string, WashTransferRow[]>;
      summary: {
        lowestEfficiencyClass: string;
        mostEfficientClass: string;
        highestLossRate: string;
        lowestLossRate: string;
      };
    };

type EconomyFaucetResult = Extract<EconomySimResult, { mode: "faucet-sizing" }>;
type EconomyWashResult = Extract<EconomySimResult, { mode: "wash-transfer" }>;

type DeterministicRng = {
  next(): number;
};

class Mulberry32 implements DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state <= 0) {
      this.state = 1;
    }
  }

  next(): number {
    let t = this.state += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const ZERO = toDecimal(0);
const ONE = toDecimal(1);
const MONEY_EPSILON = toDecimal("0.000001");
const SHARE_EPSILON = toDecimal("0.000001");
const STARTER_GAMMA = toDecimal(STARTER_GRANT_AMOUNT);
const BASELINE = toDecimal(DAILY_LOGIN_BASELINE_REWARD);
const EMERGENCY = toDecimal(EMERGENCY_GRANT_AMOUNT);
const EMERGENCY_COOLDOWN_DAYS = Math.max(1, Math.ceil(EMERGENCY_GRANT_COOLDOWN_HOURS / 24));

const LIQUIDITY_CLASSES: Array<{ className: string; liquidityB: string }> = [
  { className: "toy", liquidityB: "1000.000000" },
  { className: "standard", liquidityB: "25000.000000" },
  { className: "major", liquidityB: "75000.000000" }
];

const WASH_AMOUNTS = [
  "10.000000",
  "25.000000",
  "50.000000",
  "100.000000",
  "250.000000",
  "500.000000",
  "1000.000000",
  "2500.000000"
];

function roundMoney(value: Dec): string {
  return quantizeMoney(value);
}

function roundShares(value: Dec): string {
  return quantizeShares(value);
}

function parseMode(args: string[]): EconomySimMode {
  const first = args.find((value) => !value.startsWith("--"));
  if (!first) {
    throw new Error("Missing simulation mode. Use faucet-sizing or wash-transfer.");
  }
  if (first === "faucet-sizing" || first === "wash-transfer") {
    return first;
  }
  throw new Error(`Unknown simulation mode: ${first}`);
}

function readIntArg(args: string[], name: string, required: boolean): number {
  const prefix = `--${name}=`;
  const raw = args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) {
    if (required) {
      throw new Error(`--${name} is required.`);
    }
    return 42;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function newPlayer(id: number, type: PlayerType): EconomyPlayer {
  return {
    id,
    type,
    balance: STARTER_GAMMA,
    lastEmergencyClaimDay: null,
    streakDay: 0,
    positions: new Map()
  };
}

function buildMarkets(): SimulatedMarket[] {
  return LIQUIDITY_CLASSES.map((entry, index) => ({
    id: `sim-${entry.className}-${index}`,
    liquidityClass: entry.className,
    liquidityB: entry.liquidityB,
    trueOutcome: index % 2 === 0 ? 0 : 1,
    state: {
      liquidityB: entry.liquidityB,
      qShares: ["0.000000", "0.000000"]
    }
  }));
}

function pickPlayerType(rng: DeterministicRng): PlayerType {
  const roll = rng.next();
  if (roll < 0.1) {
    return "sharp";
  }
  if (roll < 0.7) {
    return "noise";
  }
  return "anti-sharp";
}

function hasActivePosition(player: EconomyPlayer): boolean {
  for (const byOutcome of player.positions.values()) {
    for (const shares of byOutcome.values()) {
      if (shares.gt(ZERO)) {
        return true;
      }
    }
  }
  return false;
}

function addPosition(player: EconomyPlayer, marketId: string, outcome: 0 | 1, shares: Dec): void {
  const byMarket = player.positions.get(marketId) ?? new Map<number, Dec>();
  const current = byMarket.get(outcome) ?? ZERO;
  byMarket.set(outcome, current.plus(shares));
  player.positions.set(marketId, byMarket);
}

function removePosition(player: EconomyPlayer, marketId: string, outcome: 0 | 1, shares: Dec): void {
  const byMarket = player.positions.get(marketId);
  if (!byMarket) {
    return;
  }

  const current = byMarket.get(outcome) ?? ZERO;
  const remaining = current.minus(shares);
  if (remaining.lte(SHARE_EPSILON)) {
    byMarket.delete(outcome);
    if (byMarket.size === 0) {
      player.positions.delete(marketId);
    }
    return;
  }

  byMarket.set(outcome, remaining);
}

function applyDailyFaucets(player: EconomyPlayer, day: number): Dec {
  const active = hasActivePosition(player);
  let reward = ZERO;
  let emergency = ZERO;
  const canClaimEmergency = !active
    && player.balance.lte(ZERO)
    && (player.lastEmergencyClaimDay == null || day - player.lastEmergencyClaimDay >= EMERGENCY_COOLDOWN_DAYS);

  if (canClaimEmergency) {
    emergency = EMERGENCY;
    player.lastEmergencyClaimDay = day;
    player.balance = player.balance.plus(emergency);
  }

  if (active) {
    const nextDay = readNextDailyStreakDay(player.streakDay);
    reward = toDecimal(readDailyStreakReward(nextDay));
    player.streakDay = nextDay;
  } else {
    reward = BASELINE;
  }

  player.balance = player.balance.plus(reward);

  return reward.plus(emergency);
}

function confidenceForType(type: PlayerType): number {
  if (type === "sharp") {
    return 0.78;
  }
  if (type === "anti-sharp") {
    return 0.22;
  }
  return 0.5;
}

function selectTradeOutcome(rng: DeterministicRng, player: EconomyPlayer, market: SimulatedMarket): 0 | 1 {
  const followTruth = rng.next() < confidenceForType(player.type);
  return followTruth ? market.trueOutcome : (market.trueOutcome === 0 ? 1 : 0);
}

function chooseStake(player: EconomyPlayer, rng: DeterministicRng, liquidityClass: string): Dec {
  if (player.balance.lte(MONEY_EPSILON)) {
    return ZERO;
  }

  const baseStakeFactor = player.type === "sharp" ? 0.08 : player.type === "anti-sharp" ? 0.06 : 0.05;
  const classFactor = liquidityClass === "toy" ? 0.8 : 1;
  const volatility = 0.20 + rng.next() * 0.60;
  const requested = player.balance.times(baseStakeFactor * volatility * classFactor);
  return toDecimal(roundMoney(requested));
}

function safeBuy(
  rng: DeterministicRng,
  market: SimulatedMarket,
  player: EconomyPlayer,
  outcome: 0 | 1
): BuyQuote | null {
  let requested = chooseStake(player, rng, market.liquidityClass);

  while (requested.gte(MONEY_EPSILON)) {
    try {
      return quoteBuyByCash(market.state, outcome, roundMoney(requested));
    } catch {
      requested = requested.div(2);
    }
  }

  return null;
}

function safeSell(
  rng: DeterministicRng,
  market: SimulatedMarket,
  player: EconomyPlayer,
  marketId: string,
  outcome: 0 | 1
): SellQuote | null {
  const byMarket = player.positions.get(marketId);
  if (!byMarket) {
    return null;
  }
  const available = byMarket.get(outcome) ?? ZERO;
  if (available.lte(SHARE_EPSILON)) {
    return null;
  }

  const ratio = toDecimal(0.2 + 0.6 * rng.next());
  const toSell = available.times(ratio);
  const rounded = toDecimal(roundShares(toSell));
  if (rounded.lte(SHARE_EPSILON)) {
    return null;
  }

  try {
    return quoteSellByShares(market.state, outcome, roundShares(rounded));
  } catch {
    return null;
  }
}

function pickRandomHolding(player: EconomyPlayer, rng: DeterministicRng): { marketId: string; outcome: 0 | 1 } | null {
  const holdings: Array<{ marketId: string; outcome: number }> = [];

  for (const [marketId, byOutcome] of player.positions) {
    for (const outcome of byOutcome.keys()) {
      holdings.push({ marketId, outcome });
    }
  }
  if (holdings.length === 0) {
    return null;
  }
  const chosen = holdings[Math.floor(rng.next() * holdings.length)];
  if (!chosen) {
    return null;
  }
  return { marketId: chosen.marketId, outcome: chosen.outcome as 0 | 1 };
}

function simulatePlayerDay(rng: DeterministicRng, markets: SimulatedMarket[], player: EconomyPlayer): void {
  const trades = 1 + Math.floor(rng.next() * 3);
  for (let tradeIndex = 0; tradeIndex < trades; tradeIndex += 1) {
    if (player.balance.lte(ZERO)) {
      break;
    }

    const market = markets[Math.floor(rng.next() * markets.length)];
    if (!market) {
      continue;
    }

    const activeHoldings = hasActivePosition(player);
    const wantSell = activeHoldings && rng.next() < 0.35;
    if (wantSell) {
      const holding = pickRandomHolding(player, rng);
      if (!holding) {
        continue;
      }
      const holdingMarket = markets.find((candidate) => candidate.id === holding.marketId);
      if (!holdingMarket) {
        continue;
      }

      const quote = safeSell(rng, holdingMarket, player, holding.marketId, holding.outcome);
      if (!quote) {
        continue;
      }

      player.balance = player.balance.plus(toDecimal(quote.proceedsReceived));
      removePosition(player, holding.marketId, holding.outcome, toDecimal(quote.sharesSold));
      holdingMarket.state = { ...holdingMarket.state, qShares: quote.nextQShares };
      continue;
    }

    const outcome = selectTradeOutcome(rng, player, market);
    const quote = safeBuy(rng, market, player, outcome);
    if (!quote) {
      continue;
    }

    player.balance = player.balance.minus(toDecimal(quote.cashSpent));
    if (toDecimal(quote.sharesBought).gt(ZERO)) {
      addPosition(player, market.id, outcome, toDecimal(quote.sharesBought));
      market.state = { ...market.state, qShares: quote.nextQShares };
    }
  }
}

function meanAsString(values: Dec[]): string {
  if (values.length === 0) {
    return "0.000000";
  }
  const sum = values.reduce((acc, value) => acc.plus(value), ZERO);
  return roundMoney(sum.div(values.length));
}

function medianAsString(values: Dec[]): string {
  if (values.length === 0) {
    return "0.000000";
  }
  const numeric = values.map((value) => value.toNumber()).sort((left, right) => left - right);
  return roundMoney(toDecimal(numeric[Math.floor(numeric.length / 2)] ?? 0));
}

function computeGini(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  if (total <= 0) {
    return 0;
  }
  const weighted = sorted.reduce((acc, value, index) => acc + (index + 1) * value, 0);
  return Number((((2 * weighted) / (sorted.length * total)) - ((sorted.length + 1) / sorted.length)).toFixed(6));
}

function byTypeSummary(players: EconomyPlayer[]): EconomyFaucetResult["byType"] {
  const byType = players.reduce(
    (acc, player) => {
      const target = acc[player.type];
      target.users += 1;
      target.balances.push(player.balance.toNumber());
      target.busts += player.balance.lte(ZERO) ? 1 : 0;
      return acc;
    },
    {
      sharp: { users: 0, busts: 0, balances: [] as number[] },
      noise: { users: 0, busts: 0, balances: [] as number[] },
      "anti-sharp": { users: 0, busts: 0, balances: [] as number[] }
    }
  );

  return {
    sharp: {
      users: byType.sharp.users,
      bustRate: byType.sharp.users === 0 ? 0 : Number((byType.sharp.busts / byType.sharp.users).toFixed(6)),
      meanBalance: meanAsString(byType.sharp.balances.map((value) => toDecimal(value))),
      gini: computeGini(byType.sharp.balances)
    },
    noise: {
      users: byType.noise.users,
      bustRate: byType.noise.users === 0 ? 0 : Number((byType.noise.busts / byType.noise.users).toFixed(6)),
      meanBalance: meanAsString(byType.noise.balances.map((value) => toDecimal(value))),
      gini: computeGini(byType.noise.balances)
    },
    "anti-sharp": {
      users: byType["anti-sharp"].users,
      bustRate:
        byType["anti-sharp"].users === 0
          ? 0
          : Number((byType["anti-sharp"].busts / byType["anti-sharp"].users).toFixed(6)),
      meanBalance: meanAsString(byType["anti-sharp"].balances.map((value) => toDecimal(value))),
      gini: computeGini(byType["anti-sharp"].balances)
    }
  };
}

function balanceGiniForPlayers(players: EconomyPlayer[]): number {
  return computeGini(players.map((player) => player.balance.toNumber()));
}

function runFaucetSizing(options: FaucetSizingOptions): EconomyFaucetResult {
  const rng = new Mulberry32(options.seed);
  const markets = buildMarkets();
  const players = Array.from({ length: options.users }, (_, index) =>
    newPlayer(index + 1, pickPlayerType(rng))
  );

  let treasuryOutflow = ZERO;

  for (let day = 1; day <= options.days; day += 1) {
    for (const player of players) {
      treasuryOutflow = treasuryOutflow.plus(applyDailyFaucets(player, day));
    }

    for (const player of players) {
      simulatePlayerDay(rng, markets, player);
    }
  }

  const busted = players.filter((player) => player.balance.lte(ZERO)).length;
  const active = players.filter((player) => hasActivePosition(player)).length;

  return {
    mode: "faucet-sizing",
    users: options.users,
    days: options.days,
    seed: options.seed,
    bustRate: Number((busted / options.users).toFixed(6)),
    balanceGini: balanceGiniForPlayers(players),
    treasuryOutflow: roundMoney(treasuryOutflow),
    meanBalance: meanAsString(players.map((player) => player.balance)),
    medianBalance: medianAsString(players.map((player) => player.balance)),
    activeRate: Number((active / options.users).toFixed(6)),
    byType: byTypeSummary(players)
  };
}

function runWashTransfer(options: WashTransferOptions): EconomyWashResult {
  const transferEfficiency: Record<string, WashTransferRow[]> = {};
  const referenceClass = LIQUIDITY_CLASSES[0]?.className ?? "toy";
  let lowestEfficiencyRow = {
    className: referenceClass,
    efficiency: ONE,
    lossRate: ZERO
  };
  let highestEfficiencyRow = {
    className: referenceClass,
    efficiency: ZERO,
    lossRate: ONE
  };
  let highestLossRow = { className: referenceClass, lossRate: ZERO };
  let lowestLossRow = { className: referenceClass, lossRate: ONE };

  for (const clazz of LIQUIDITY_CLASSES) {
    const rows: WashTransferRow[] = [];

    for (const amount of WASH_AMOUNTS) {
      const baseState: LmsrMarketState = {
        liquidityB: clazz.liquidityB,
        qShares: ["0.000000", "0.000000"]
      };
      let buyQuote: BuyQuote | null = null;
      try {
        buyQuote = quoteBuyByCash(baseState, 0, amount);
      } catch {
        rows.push({
          liquidityB: clazz.liquidityB,
          amount,
          shares: "0.000000",
          cashSpent: amount,
          cashReturned: "0.000000",
          efficiency: "0.000000",
          lossRate: "1.000000",
          lossAmount: amount
        });
        continue;
      }

      let sellQuote: SellQuote;
      try {
        sellQuote = quoteSellByShares(
          {
            ...baseState,
            qShares: buyQuote.nextQShares
          },
          0,
          roundShares(toDecimal(buyQuote.sharesBought))
        );
      } catch {
        rows.push({
          liquidityB: clazz.liquidityB,
          amount,
          shares: buyQuote.sharesBought,
          cashSpent: buyQuote.cashSpent,
          cashReturned: "0.000000",
          efficiency: "0.000000",
          lossRate: "1.000000",
          lossAmount: buyQuote.cashSpent
        });
        continue;
      }

      const spent = toDecimal(buyQuote.cashSpent);
      const returned = toDecimal(sellQuote.proceedsReceived);
      const efficiency = spent.eq(ZERO) ? ZERO : returned.div(spent);
      const lossRate = ONE.minus(efficiency);

      const row: WashTransferRow = {
        liquidityB: clazz.liquidityB,
        amount,
        shares: buyQuote.sharesBought,
        cashSpent: buyQuote.cashSpent,
        cashReturned: sellQuote.proceedsReceived,
        efficiency: roundMoney(efficiency),
        lossRate: roundMoney(lossRate),
        lossAmount: roundMoney(spent.minus(returned))
      };
      rows.push(row);

      if (efficiency.lt(lowestEfficiencyRow.efficiency)) {
        lowestEfficiencyRow = {
          className: clazz.className,
          efficiency,
          lossRate
        };
      }
      if (efficiency.gt(highestEfficiencyRow.efficiency)) {
        highestEfficiencyRow = {
          className: clazz.className,
          efficiency,
          lossRate
        };
      }
      if (lossRate.gt(highestLossRow.lossRate)) {
        highestLossRow = {
          className: clazz.className,
          lossRate
        };
      }
      if (lossRate.lt(lowestLossRow.lossRate)) {
        lowestLossRow = {
          className: clazz.className,
          lossRate
        };
      }
    }

    transferEfficiency[clazz.className] = rows;
  }

  return {
    mode: "wash-transfer",
    seed: options.seed,
    transferEfficiency,
    summary: {
      lowestEfficiencyClass: lowestEfficiencyRow.className,
      mostEfficientClass: highestEfficiencyRow.className,
      highestLossRate: roundMoney(highestLossRow.lossRate),
      lowestLossRate: roundMoney(lowestLossRow.lossRate)
    }
  };
}

export function runEconomySimulation(options: EconomySimOptions): EconomySimResult {
  if (options.mode === "wash-transfer") {
    return runWashTransfer(options);
  }
  return runFaucetSizing(options);
}

export function formatEconomySimReport(result: EconomySimResult): string {
  if (result.mode === "faucet-sizing") {
    const typeRows = [
      `- sharp: users=${result.byType.sharp.users}, bustRate=${(result.byType.sharp.bustRate * 100).toFixed(2)}%, meanBalance=${result.byType.sharp.meanBalance}, gini=${result.byType.sharp.gini.toFixed(6)}`,
      `- noise: users=${result.byType.noise.users}, bustRate=${(result.byType.noise.bustRate * 100).toFixed(2)}%, meanBalance=${result.byType.noise.meanBalance}, gini=${result.byType.noise.gini.toFixed(6)}`,
      `- anti-sharp: users=${result.byType["anti-sharp"].users}, bustRate=${(result.byType["anti-sharp"].bustRate * 100).toFixed(2)}%, meanBalance=${result.byType["anti-sharp"].meanBalance}, gini=${result.byType["anti-sharp"].gini.toFixed(6)}`
    ].join("\n");

    return [
      "# Economy simulation (faucet-sizing)",
      `- Users: ${result.users}`,
      `- Days: ${result.days}`,
      `- Seed: ${result.seed}`,
      `- Bust rate: ${(result.bustRate * 100).toFixed(2)}%`,
      `- Active rate: ${(result.activeRate * 100).toFixed(2)}%`,
      `- Balance Gini: ${result.balanceGini.toFixed(6)}`,
      `- Treasury outflow: ${result.treasuryOutflow}`,
      `- Mean balance: ${result.meanBalance}`,
      `- Median balance: ${result.medianBalance}`,
      "",
      "## By player type",
      typeRows
    ].join("\n");
  }

  const classRows = Object.entries(result.transferEfficiency)
    .map(([liquidityClass, rows]) => {
      const lines = rows
        .map(
          (row) =>
            `  - amount=${row.amount} | shares=${row.shares} | spent=${row.cashSpent} | returned=${row.cashReturned} | efficiency=${row.efficiency} | lossRate=${row.lossRate}`
        )
        .join("\n");
      return `- ${liquidityClass}\n${lines}`;
    })
    .join("\n\n");

  return [
    "# Economy simulation (wash-transfer)",
    `- Seed: ${result.seed}`,
    `- Lowest efficiency class: ${result.summary.lowestEfficiencyClass}`,
    `- Most efficient class: ${result.summary.mostEfficientClass}`,
    `- Lowest loss rate: ${result.summary.lowestLossRate}`,
    `- Highest loss rate: ${result.summary.highestLossRate}`,
    "",
    "## Transfer efficiency sweep",
    classRows
  ].join("\n");
}

export function parseEconomySimArgs(argv: string[]): EconomySimOptions {
  const mode = parseMode(argv);
  const json = argv.includes("--json");
  const seed = readIntArg(argv, "seed", false);

  if (mode === "faucet-sizing") {
    const users = readIntArg(argv, "users", true);
    const days = readIntArg(argv, "days", true);
    return { mode, users, days, seed, json };
  }

  return { mode, seed, json };
}

function main(): void {
  const options = parseEconomySimArgs(process.argv.slice(2));
  const result = runEconomySimulation(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatEconomySimReport(result));
}

if (process.argv[1] && resolvePath(process.argv[1]).endsWith("economy-sim.ts")) {
  main();
}
