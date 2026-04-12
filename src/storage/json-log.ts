import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.LOGS_DIR
  ?? join(import.meta.dirname, '../../data/logs');

mkdirSync(DATA_DIR, { recursive: true });

export type LogType = 'scrape' | 'analysis' | 'prediction';

export interface ScrapeLogEntry {
  timestamp: string;
  source: string;
  sport: string;
  dataType: string;
  records: number;
  gate: 'CLEAR' | 'WARN' | 'FAIL';
  gateReason?: string;
  durationMs: number;
  error?: string;
}

export interface AnalysisLogEntry {
  timestamp: string;
  hypothesisId: string;
  iterations: number;
  bestMetric: number;
  metricType: string;
  improvement: number;
  gate: 'CLEAR' | 'WARN' | 'FAIL';
  gateReason?: string;
}

export interface PredictionLogEntry {
  timestamp: string;
  predictionId: string;
  type: string;
  subject: string;
  claim: string;
  confidence: number;
  sourceCount: number;
  gate: 'CLEAR' | 'WARN' | 'FAIL';
  published: boolean;
}

type LogEntry = ScrapeLogEntry | AnalysisLogEntry | PredictionLogEntry;

function logPath(type: LogType): string {
  return join(DATA_DIR, `${type}-log.jsonl`);
}

export function appendLog(type: LogType, entry: LogEntry): void {
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(logPath(type), line, 'utf-8');
  // Track rate-limit counter in memory (P1-2)
  if (type === 'scrape' && 'source' in entry) {
    recordRequest((entry as ScrapeLogEntry).source);
  }
}

export function readLog<T extends LogEntry>(type: LogType, lastN?: number): T[] {
  const path = logPath(type);
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean);

  const entries = lines.map((line) => JSON.parse(line) as T);
  return lastN ? entries.slice(-lastN) : entries;
}

/**
 * In-memory rate-limit counter. Replaces the old approach of reading the
 * entire JSONL file on every call (P1-2: OOM risk on 512MB Fly VM).
 *
 * Node.js is single-threaded so no data races, but rapid bursts can briefly
 * inflate counts before pruning runs. This is conservative (overcount = slower,
 * not faster). Counter resets on process restart, which is acceptable since
 * Fly machine rolls reset the rate-limit window anyway.
 */
const recentTimestamps = new Map<string, number[]>();

function recordRequest(source: string): void {
  if (!recentTimestamps.has(source)) recentTimestamps.set(source, []);
  const arr = recentTimestamps.get(source)!;
  arr.push(Date.now());
  // Prune entries older than 5 minutes to prevent memory growth
  const cutoff = Date.now() - 5 * 60 * 1000;
  const firstValid = arr.findIndex(t => t > cutoff);
  if (firstValid > 0) arr.splice(0, firstValid);
}

export function countRecentRequests(source: string, windowMinutes: number): number {
  const arr = recentTimestamps.get(source);
  if (!arr) return 0;
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  return arr.filter(t => t > cutoff).length;
}
