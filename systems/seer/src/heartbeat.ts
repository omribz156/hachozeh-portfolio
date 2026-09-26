import type { ManualSeerSignal } from "./contracts";
import {
  BANK_OF_ISRAEL_PRESS_RELEASES_URL,
  BANK_OF_ISRAEL_RATE_DATES_URL,
  BANK_OF_ISRAEL_SOURCE_ID,
  fetchBankOfIsraelSignals,
  fetchIbbaSignals,
  IBBA_FEED_URL,
  IBBA_SOURCE_ID,
  fetchWinnerLeagueSignals,
  WINNER_LEAGUE_CONFIG_URL,
  WINNER_LEAGUE_SOURCE_ID
} from "./general-source-fetchers";
import {
  fetchGoogleTrendingSignals,
  GOOGLE_TRENDING_IL_FEED_URL,
  GOOGLE_TRENDING_IL_SOURCE_ID
} from "./google-trending";

export type HeartbeatRunStatus = "ok" | "failed";

export type HeartbeatSourceRun = {
  objectType: "heartbeat_source_run";
  sourceId: string;
  label: string;
  feedUrl: string;
  status: HeartbeatRunStatus;
  fetchedCount: number;
  importedCount: number;
  skippedCount: number;
  note?: string;
};

export type SeerHeartbeatResult = {
  objectType: "seer_heartbeat_result";
  generatedAt: string;
  importedSignals: ManualSeerSignal[];
  sourceRuns: HeartbeatSourceRun[];
  fetchedCount: number;
  importedCount: number;
  skippedCount: number;
};

type HeartbeatFetcher = {
  sourceId: string;
  label: string;
  feedUrl: string;
  fetchSignals: (generatedAt: string, fetchImpl?: typeof fetch) => Promise<ManualSeerSignal[]>;
};

const heartbeatFetchers: HeartbeatFetcher[] = [
  {
    sourceId: GOOGLE_TRENDING_IL_SOURCE_ID,
    label: "Google Trending IL",
    feedUrl: GOOGLE_TRENDING_IL_FEED_URL,
    fetchSignals: fetchGoogleTrendingSignals
  },
  {
    sourceId: IBBA_SOURCE_ID,
    label: "IBBA",
    feedUrl: IBBA_FEED_URL,
    fetchSignals: fetchIbbaSignals
  },
  {
    sourceId: WINNER_LEAGUE_SOURCE_ID,
    label: "Winner League",
    feedUrl: WINNER_LEAGUE_CONFIG_URL,
    fetchSignals: fetchWinnerLeagueSignals
  },
  {
    sourceId: BANK_OF_ISRAEL_SOURCE_ID,
    label: "Bank of Israel",
    feedUrl: BANK_OF_ISRAEL_RATE_DATES_URL,
    fetchSignals: fetchBankOfIsraelSignals
  }
];

export async function runSeerHeartbeat(
  generatedAt: string,
  existingSignals: ManualSeerSignal[],
  fetchImpl: typeof fetch = fetch
): Promise<SeerHeartbeatResult> {
  const knownSignalIds = new Set(existingSignals.map((signal) => signal.signalId));
  const importedSignals: ManualSeerSignal[] = [];
  const sourceRuns: HeartbeatSourceRun[] = [];

  for (const fetcher of heartbeatFetchers) {
    try {
      const fetchedSignals = await fetcher.fetchSignals(generatedAt, fetchImpl);
      const newSignals = fetchedSignals.filter((signal) => !knownSignalIds.has(signal.signalId));

      for (const signal of newSignals) {
        knownSignalIds.add(signal.signalId);
        importedSignals.push(signal);
      }

      sourceRuns.push({
        objectType: "heartbeat_source_run",
        sourceId: fetcher.sourceId,
        label: fetcher.label,
        feedUrl: fetcher.feedUrl,
        status: "ok",
        fetchedCount: fetchedSignals.length,
        importedCount: newSignals.length,
        skippedCount: fetchedSignals.length - newSignals.length
      });
    } catch (error) {
      sourceRuns.push({
        objectType: "heartbeat_source_run",
        sourceId: fetcher.sourceId,
        label: fetcher.label,
        feedUrl: fetcher.feedUrl,
        status: "failed",
        fetchedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        note: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    objectType: "seer_heartbeat_result",
    generatedAt,
    importedSignals,
    sourceRuns,
    fetchedCount: sourceRuns.reduce((sum, run) => sum + run.fetchedCount, 0),
    importedCount: sourceRuns.reduce((sum, run) => sum + run.importedCount, 0),
    skippedCount: sourceRuns.reduce((sum, run) => sum + run.skippedCount, 0)
  };
}
