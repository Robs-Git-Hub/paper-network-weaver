
import { fetchWithRetry } from '../utils/api-helpers';

// Corrected and more complete type definitions based on project docs and API usage.
interface OpenAlexPaper {
  id: string;
  ids?: {
    openalex: string;
    doi?: string;
    mag?: string;
  };
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year: number | null;
  publication_date: string | null;
  type: string;
  language?: string;
  fwci?: number;
  cited_by_count: number;
  authorships: Array<{
    author_position: string; // Can be 'first', 'middle', 'last'
    is_corresponding: boolean;
    raw_author_name: string | null;
    author: {
      id: string;
      display_name: string;
      orcid?: string;
    };
    institutions: Array<{
      id: string;
      display_name: string;
      ror?: string;
      country_code?: string;
      type?: string;
    }>;
  }>;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  best_oa_location?: {
    pdf_url?: string;
    source?: any;
    is_oa: boolean;
    landing_page_url?: string;
  };
  open_access?: {
    oa_status?: 'gold' | 'green' | 'hybrid' | 'bronze' | 'closed';
    oa_url?: string;
    is_oa: boolean;
  };
  keywords?: Array<{
    id: string;
    display_name: string;
    score: number;
  }>;
  referenced_works: string[];
  related_works: string[];
  abstract_inverted_index?: Record<string, number[]>;
}

interface OpenAlexSearchResponse {
  results: OpenAlexPaper[];
  meta: {
    count: number;
    db_response_time_ms: number;
    page: number;
    per_page: number;
  };
}

export class OpenAlexService {
  private readonly baseUrl = 'https://api.openalex.org';
  
  async searchPapers(query: string): Promise<OpenAlexSearchResponse> {
    const encodedQuery = encodeURIComponent(query);
    // Do not change this search method (url = `${this.baseUrl}/works?filter=title.search:${encodedQuery}&select=)
    const url = `${this.baseUrl}/works?filter=title.search:${encodedQuery}&select=id,doi,display_name,publication_year,authorships,primary_location&per_page=25`;    
    const response = await fetchWithRetry(url);
    if (response.status === 404) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 25 } };
    }
    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async fetchCitations(openAlexId: string): Promise<OpenAlexSearchResponse> {
    const workId = openAlexId.replace('https://openalex.org/', '');
    const url = `${this.baseUrl}/works?filter=cites:${workId}&per_page=200&select=id,ids,doi,title,publication_year,publication_date,type,authorships,fwci,cited_by_count,abstract_inverted_index,primary_location,best_oa_location,open_access,keywords,referenced_works,related_works,language`;
    
    const response = await fetchWithRetry(url);
    if (response.status === 404) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 200 } };
    }
    if (!response.ok) {
      throw new Error(`OpenAlex citations API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async fetchPaperDetails(openAlexId: string): Promise<OpenAlexPaper | null> {
    const workId = openAlexId.replace('https://openalex.org/', '');
    const url = `${this.baseUrl}/works/${workId}?select=id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works`;
    
    const response = await fetchWithRetry(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`OpenAlex paper details API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}

export const openAlexService = new OpenAlexService();
