
/**
 * Data transformation utilities as specified in the Technical Reference
 */

interface KeywordObject {
  id: string;
  display_name: string;
  score: number;
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

export function generateShortUid(): string {
  return Math.random().toString(36).substr(2, 9);
}
