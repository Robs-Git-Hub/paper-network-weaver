
interface OpenAlexSearchResponse {
  results: Array<{
    id: string;
    title: string;
    authors: Array<{
      id: string;
      display_name: string;
      orcid?: string;
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
    const url = `${this.baseUrl}/works?search=${encodedQuery}&per_page=25&select=id,title,authors,publication_year,publication_date,primary_location,cited_by_count,type,language,keywords,open_access,doi`;
    
    console.log('OpenAlex search URL:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('OpenAlex search response:', data);
    
    return data;
  }
}

export const openAlexService = new OpenAlexService();
