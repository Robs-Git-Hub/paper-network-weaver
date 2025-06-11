
/**
 * Data transformation utilities as specified in the Technical Reference
 */

import { compareTwoStrings } from 'string-similarity';

interface KeywordObject {
  id: string;
  display_name: string;
  score?: number; // <-- FIX IS HERE: Made score optional to match API data
}

export function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return null;
  }
  const words: string[] = [];
  // Using a try-catch block for safety against malformed data
  try {
    for (const word in invertedIndex) {
      const positions = invertedIndex[word];
      for (const pos of positions) {
        words[pos] = word;
      }
    }
    return words.join(' ');
  } catch (e) {
    console.error("Failed to reconstruct abstract", e);
    return null; // Return null if something goes wrong
  }
}

export function extractKeywords(
  keywords: KeywordObject[] | null
): string[] {
  if (!keywords) {
    return [];
  }
  return keywords.map(kw => kw.display_name);
}

export function normalizeDoi(doiUrl: string | null): string | null {
  if (!doiUrl) {
    return null;
  }
  // This regex handles http, https, and the presence or absence of "doi.org/"
  const doiRegex = /(?:https?:\/\/doi\.org\/)?(10\..+)/;
  const match = doiUrl.match(doiRegex);
  return match ? match[1] : doiUrl; // Return the DOI part, or the original string if it doesn't match
}

/**
 * Calculates a confidence score between a stub author name and a candidate author name.
 * @param stubName The name from the stub author record (e.g., "J. Smith").
 * @param candidateName The name from the high-quality OpenAlex record (e.g., "Jane Smith").
 * @returns A score from 0.0 (no match) to 1.0 (perfect match).
 */
export function calculateMatchScore(
  stubName: string,
  candidateName: string
): number {
  if (!stubName || !candidateName) return 0.0;

  // 1. Normalize names: remove periods, convert to lower case for consistent comparison.
  const normStub = stubName.toLowerCase().replace(/\./g, '').trim();
  const normCandidate = candidateName.toLowerCase().replace(/\./g, '').trim();

  if (normStub === normCandidate) return 1.0;

  const stubParts = normStub.split(' ').filter(part => part.length > 0);
  const candidateParts = normCandidate.split(' ').filter(part => part.length > 0);
  
  if (stubParts.length === 0 || candidateParts.length === 0) return 0.0;

  const stubLastName = stubParts[stubParts.length - 1];
  const candidateLastName = candidateParts[candidateParts.length - 1];

  // 2. Strong Prerequisite: Last names must be a very close match.
  // This is a powerful filter to prevent matching completely different people.
  const lastNameSimilarity = compareTwoStrings(stubLastName, candidateLastName);
  if (lastNameSimilarity < 0.9) {
    return 0.0;
  }

  // 3. Score based on the full name similarity
  let score = compareTwoStrings(normStub, normCandidate);

  // 4. Heuristic Boost: If the stub name uses an initial that matches the
  // first letter of the candidate's first name, boost the confidence.
  if (stubParts.length > 1 && stubParts[0].length === 1 && 
      candidateParts.length > 1 && candidateParts[0].length > 1 && 
      stubParts[0] === candidateParts[0][0]) {
    // e.g., stub "j smith" vs candidate "john smith"
    score = Math.min(1.0, score * 1.15); // Give a 15% boost, capped at 1.0
  }

  return score;
}

export function generateShortUid(): string {
  return Math.random().toString(36).substr(2, 9);
}
