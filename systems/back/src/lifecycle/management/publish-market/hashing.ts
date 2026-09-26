import { hashStablePayload } from "../../../shared/stable-hash";
import type { PublishMarketRequest } from "./types";

export function buildRequestHash(marketId: string, request: PublishMarketRequest): string {
  return hashStablePayload({
    marketId,
    ...request
  });
}
