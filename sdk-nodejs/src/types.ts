// SPDX-License-Identifier: MIT
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface EventData {
  eventType: string;
  eventCategory: string;
  severity: Severity;
  source: string;
  occurredAt: string;
  eventVersion?: string;
  assetId?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SingleResult {
  eventId: string;
  duplicate: boolean;
}

export interface BulkItemResult {
  index: number;
  status: 'accepted' | 'duplicate' | 'rejected';
  eventId?: string;
  error?: string;
}

export interface BulkResult {
  results: BulkItemResult[];
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  logger?: (msg: string) => void;
}
