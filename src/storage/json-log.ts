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

export function countRecentRequests(source: string, windowMinutes: number): number {
  const entries = readLog<ScrapeLogEntry>('scrape');
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  return entries.filter(
    (e) => e.source === source && new Date(e.timestamp).getTime() > cutoff
  ).length;
}
