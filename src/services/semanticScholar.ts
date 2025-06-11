
// src/services/semanticScholar.ts

import { fetchWithRetry } from '../utils/api-helpers';

// We need a more specific type for the paginated fields
interface PaginatedResponse {
  data: any[];
  next: number;
}

// The full response type remains the same
interface SemanticScholarResponse {
  paperId: string;
  corpusId: number;
  externalIds: {
    MAG?: string;
    DOI?: string;
    CorpusId?: string;
  };
  url: string;
  title: string;
  citationCount: number;
  openAccessPdf?: {
    url: string;
  };
  citationStyles: {
    bibtex: string;
  };
  authors: Array<{
    authorId: string;
    name: string;
  }>;
  citations: Array<any>; // Using 'any' for simplicity as the structure is complex
  references: Array<any>;
}

export class SemanticScholarService {
  private readonly baseUrl = 'https://api.semanticscholar.org/graph/v1';
  private readonly PAGINATION_LIMIT = 1000; // Max limit allowed by the API

  // --- NEW HELPER FOR PAGINATION ---
  private async fetchAllPaginatedFields(
    paperId: string,
    field: 'citations' | 'references'
  ): Promise<any[]> {
    let allResults: any[] = [];
    let offset = 0;
    let hasMore = true;

    // Define the fields to retrieve for each citation/reference
    const subFields = 'externalIds,url,title,abstract,venue,year,citationStyles,authors';

    while (hasMore) {
      const url = `${this.baseUrl}/paper/${paperId}?fields=${field}(${subFields},limit:${this.PAGINATION_LIMIT},offset:${offset})`;
      
      const response = await fetchWithRetry(url);
      if (!response.ok) {
        console.warn(`Failed to fetch a page for ${field} on paper ${paperId}. Status: ${response.status}`);
        break;
      }

      const pageData = await response.json();
      const results = pageData[field]?.data;

      if (results && results.length > 0) {
        allResults.push(...results);
        offset += results.length; // Use actual length in case it's the last, smaller page
      } else {
        hasMore = false; // No more results, stop the loop
      }
      
      // If we received fewer results than the limit, it must be the last page.
      if (!results || results.length < this.PAGINATION_LIMIT) {
        hasMore = false;
      }
    }
    return allResults;
  }
  
  // --- REFACTORED FUNCTION ---
  async fetchPaperDetails(doi: string): Promise<SemanticScholarResponse | null> {
    // Step 1: Fetch the base paper details WITHOUT citations and references
    const baseFields = 'paperId,corpusId,externalIds,url,citationStyles,citationCount,authors,title';
    const initialUrl = `${this.baseUrl}/paper/DOI:${doi}?fields=${baseFields}`;
    
    console.log('Semantic Scholar Base URL:', initialUrl);
    
    const response = await fetchWithRetry(initialUrl);
    
    if (response.status === 404) {
      console.warn(`Paper with DOI ${doi} not found in Semantic Scholar, continuing gracefully`);
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status} ${response.statusText}`);
    }
    
    const baseData = await response.json();
    if (!baseData || !baseData.paperId) {
        return null; // Paper found but has no ID, treat as not found
    }

    // Step 2: Fetch all citations and references in parallel using the pagination helper
    const [allCitations, allReferences] = await Promise.all([
      this.fetchAllPaginatedFields(baseData.paperId, 'citations'),
      this.fetchAllPaginatedFields(baseData.paperId, 'references')
    ]);

    // Step 3: Combine the base data with the fully paginated lists
    const fullData: SemanticScholarResponse = {
      ...baseData,
      citations: allCitations,
      references: allReferences,
    };

    console.log(`Semantic Scholar response: Found ${fullData.citations.length} citations and ${fullData.references.length} references.`);
    
    return fullData;
  }
}

export const semanticScholarService = new SemanticScholarService();