
import { fetchWithRetry } from '../utils/api-helpers';

interface OpenAlexSearchResponse {
  results: Array<{
    id: string;
    title?: string;
    display_name?: string;
    authorships: Array<{
      author_position: number;
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
    publication_year: number | null;
    publication_date: string | null;
    primary_location?: {
      source?: {
        display_name: string;
      };
    };
    cited_by_count: number;
    type: string;
    language?: string;
    keywords?: Array<{
      id: string;
      display_name: string;
      score: number;
    }>;
    open_access?: {
      oa_url?: string;
      oa_date?: string;
      is_oa: boolean;
    };
    doi?: string;
    referenced_works: string[];
    related_works: string[];
    abstract_inverted_index?: Record<string, number[]>;
    fwci?: number;
  }>;
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
    const url = `${this.baseUrl}/works?filter=title.search:${encodedQuery}&select=id,doi,display_name,publication_year,authorships,primary_location&per_page=25`;
    
    console.log('OpenAlex search URL:', url);
    
    const response = await fetchWithRetry(url);
    
    // Handle 404 gracefully
    if (response.status === 404) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 25 } };
    }
    
    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('OpenAlex search response:', data);
    
    return data;
  }

  async fetchCitations(openAlexId: string): Promise<OpenAlexSearchResponse> {
    const workId = openAlexId.replace('https://openalex.org/', '');
    const url = `${this.baseUrl}/works?filter=cites:${workId}&per_page=200&select=id,ids,doi,title,publication_year,publication_date,type,authorships,fwci,cited_by_count,abstract_inverted_index,primary_location,best_oa_location,open_access,keywords,referenced_works,related_works`;
    
    console.log('OpenAlex citations URL:', url);
    
    const response = await fetchWithRetry(url);
    
    // Handle 404 gracefully
    if (response.status === 404) {
      return { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 200 } };
    }
    
    if (!response.ok) {
      throw new Error(`OpenAlex citations API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('OpenAlex citations response:', data);
    
    return data;
  }

  async fetchPaperDetails(openAlexId: string): Promise<any> {
    const workId = openAlexId.replace('https://openalex.org/', '');
    const url = `${this.baseUrl}/works/${workId}?select=id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works`;
    
    console.log('OpenAlex paper details URL:', url);
    
    const response = await fetchWithRetry(url);
    
    // Handle 404 gracefully
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`OpenAlex paper details API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('OpenAlex paper details response:', data);
    
    return data;
  }
}

export const openAlexService = new OpenAlexService();
