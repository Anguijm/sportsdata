/**
 * Data normalizer — transforms raw scrape responses into unified schema.
 * Each source has its own quirks; this module handles the translation.
 */

import type { Sport, Provenance } from '../schema/provenance.js';

/** Generate a normalized ID in the format "sport:identifier" */
export function normalizeId(sport: Sport, identifier: string): string {
  return `${sport}:${identifier.toUpperCase().replace(/\s+/g, '_')}`;
}

/** Generate a game ID in the format "sport:season-identifier" */
export function normalizeGameId(sport: Sport, season: string, identifier: string): string {
  return `${sport}:${season}-${identifier}`;
}

/** Create provenance metadata for a data retrieval */
export function createProvenance(source: string, url?: string): Provenance {
  return {
    source: source as Provenance['source'],
    retrievedAt: new Date().toISOString(),
    stalenessSeconds: 0,
    url,
  };
}

/** Calculate staleness in seconds from retrieval time */
export function calculateStaleness(retrievedAt: string): number {
  return Math.floor((Date.now() - new Date(retrievedAt).getTime()) / 1000);
}

/** Validate that a record has all required fields */
export function validateRequiredFields(
  record: Record<string, unknown>,
  requiredFields: string[]
): { valid: boolean; missingFields: string[] } {
  const missing = requiredFields.filter(
    (field) => record[field] === undefined || record[field] === null
  );
  return { valid: missing.length === 0, missingFields: missing };
}
