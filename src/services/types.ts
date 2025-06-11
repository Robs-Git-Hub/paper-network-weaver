
export interface OpenAlexPaper {
  id: string;
  ids?: {
    openalex?: string;
    doi?: string;
    mag?: string;
    pmid?: string;
    pmcid?: string;
  };
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  type?: string;
  language?: string;
  authorships?: Array<{
    author_position?: string;
    author?: {
      id?: string;
      display_name?: string;
      orcid?: string;
    };
    institutions?: Array<{
      id?: string;
      display_name?: string;
      country_code?: string;
    }>;
  }>;
  primary_location?: {
    source?: {
      id?: string;
      display_name?: string;
      type?: string;
    };
  };
  fwci?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  best_oa_location?: {
    is_oa?: boolean;
    landing_page_url?: string;
    pdf_url?: string;
  };
  open_access?: {
    is_oa?: boolean;
    oa_date?: string;
  };
  keywords?: Array<{
    keyword?: string;
    score?: number;
  }>;
  referenced_works?: string[];
  related_works?: string[];
}

export interface OpenAlexSearchResponse {
  results: OpenAlexPaper[];
  meta: {
    count: number;
    db_response_time_ms: number;
    page: number;
    per_page: number;
  };
}
