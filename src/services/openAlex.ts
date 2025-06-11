
// src/services/openAlex.ts

import { fetchWithRetry } from '../utils/api-helpers';
import { normalizeOpenAlexId } from './openAlex-util';
import type { OpenAlexPaper, OpenAlexSearchResponse } from '../workers/graph-core/types';

const OPENALEX_API_BATCH_SIZE = 50;

// Utility function to chunk arrays
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

const OPENALEX_FIELD_SETS = {
  SEARCH_PREVIEW: [
    'id', 'doi', 'display_name', 'publication_year', 'authorships', 'primary_location'
  ],
  FULL_INGESTION: [
    'id', 'ids', 'doi', 'title', 'publication_year', 'publication_date', 'type', 'language',
    'authorships', 'primary_location', 'fwci', 'cited_by_count', 'abstract_inverted_index',
    'best_oa_location', 'open_access', 'keywords', 'referenced_works', 'related_works'
  ],
  AUTHOR_RECONCILIATION: [
    'doi', 'authorships'
  ],
  STUB_CREATION: [
    'id', 'ids', 'doi', 'title', 'display_name', 'publication_year', 'publication_date', 
    'primary_location', 'cited_by_count', 'type', 'authorships'
  ]
};

export class OpenAlexService {
  private readonly baseUrl = 'https://api.openalex.org';

  private buildOpenAlexUrl(
    filter: string,
    fieldSetName: keyof typeof OPENALEX_FIELD_SETS,
    perPage: number | null = null
  ): string {
    const fields = OPENALEX_FIELD_SETS[fieldSetName].join(',');
    let url = `${this.baseUrl}/works?filter=${filter}&select=${fields}`;
    if (perPage) {
      url += `&per_page=${perPage}`;
    }
    return url;
  }

  // --- NEW HELPER FOR PAGINATION ---
  private async fetchAllPages(initialUrl: string): Promise<OpenAlexPaper[]> {
    let allResults: OpenAlexPaper[] = [];
    let nextCursor: string | null = '*'; // Use '*' for the first request
    let currentUrl = initialUrl;

    while (nextCursor) {
      const urlWithCursor = `${currentUrl}&cursor=${nextCursor}`;
      const response = await fetchWithRetry(urlWithCursor);

      if (!response.ok) {
        console.warn(`[Worker] A page failed during pagination for ${currentUrl}: ${response.status}`);
        break; // Exit loop on page failure
      }

      const data: OpenAlexSearchResponse = await response.json();
      if (data.results) {
        allResults.push(...data.results);
      }
      
      nextCursor = data.meta.next_cursor;
    }

    return allResults;
  }

  async searchPapers(query: string): Promise<OpenAlexSearchResponse> {
    const encodedQuery = encodeURIComponent(query);
    const filter = `title.search:${encodedQuery}`;
    const url = this.buildOpenAlexUrl(filter, 'SEARCH_PREVIEW', 25);
    
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`OpenAlex API error: ${response.status}`);
    return response.json();
  }

  // --- REFACTORED FOR PAGINATION ---
  async fetchCitations(openAlexId: string): Promise<OpenAlexSearchResponse> {
    const workId = normalizeOpenAlexId(openAlexId);
    const filter = `cites:${workId}`;
    const initialUrl = this.buildOpenAlexUrl(filter, 'FULL_INGESTION', 200);
    
    const allResults = await this.fetchAllPages(initialUrl);

    return {
      results: allResults,
      meta: { count: allResults.length, db_response_time_ms: 0, page: 1, per_page: allResults.length },
    };
  }

  // --- REFACTORED FOR BATCHING & PAGINATION ---
  async fetchCitationsForMultiplePapers(workIds: string[]): Promise<OpenAlexSearchResponse> {
    const normalizedIds = workIds.map(normalizeOpenAlexId);
    if (normalizedIds.length === 0) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 0 } };
    }
    
    const idChunks = chunkArray(normalizedIds, OPENALEX_API_BATCH_SIZE);

    const promises = idChunks.map(chunk => {
      const filter = `cites:${chunk.join('|')}`;
      const initialUrl = this.buildOpenAlexUrl(filter, 'FULL_INGESTION', 200);
      return this.fetchAllPages(initialUrl); // Use the pagination helper for each chunk
    });

    const resultsFromAllChunks = await Promise.all(promises);
    const allResults = resultsFromAllChunks.flat();

    return {
      results: allResults,
      meta: { count: allResults.length, db_response_time_ms: 0, page: 1, per_page: allResults.length },
    };
  }

  async fetchPaperDetails(openAlexId: string): Promise<OpenAlexPaper | null> {
    const workId = normalizeOpenAlexId(openAlexId);
    const fields = OPENALEX_FIELD_SETS['FULL_INGESTION'].join(',');
    const url = `${this.baseUrl}/works/${workId}?select=${fields}`;
    
    const response = await fetchWithRetry(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OpenAlex paper details API error: ${response.status}`);
    return response.json();
  }

  async fetchMultiplePapers(
    workIds: string[], 
    fieldSetName: keyof typeof OPENALEX_FIELD_SETS = 'FULL_INGESTION'
  ): Promise<OpenAlexSearchResponse> {
    const normalizedIds = workIds.map(normalizeOpenAlexId);
    if (normalizedIds.length === 0) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 0 } };
    }

    const idChunks = chunkArray(normalizedIds, OPENALEX_API_BATCH_SIZE);

    const promises = idChunks.map(chunk => {
      const filter = `openalex:${chunk.join('|')}`;
      const initialUrl = this.buildOpenAlexUrl(filter, fieldSetName, 200);
      return this.fetchAllPages(initialUrl);
    });

    const resultsFromAllChunks = await Promise.all(promises);
    const allResults = resultsFromAllChunks.flat();

    return {
      results: allResults,
      meta: { count: allResults.length, db_response_time_ms: 0, page: 1, per_page: allResults.length },
    };
  }
}

export const openAlexService = new OpenAlexService();