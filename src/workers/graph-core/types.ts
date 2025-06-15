
// src/workers/graph-core/types.ts

// Shared types for the graph worker modules

export interface Paper {
  short_uid: string;
  title: string;
  publication_year: number | null;
  publication_date: string | null;
  location: string | null;
  abstract: string | null;
  fwci: number | null;
  cited_by_count: number;
  type: string;
  language: string | null;
  keywords: string[];
  best_oa_url: string | null;
  oa_status: string | null;
  is_stub: boolean;
  relationship_tags: string[];
}

export interface Author {
  short_uid: string;
  clean_name: string;
  orcid: string | null;
  is_stub: boolean;
}

export interface Institution {
  short_uid: string;
  ror_id: string | null;
  display_name: string;
  country_code: string | null;
  type: string | null;
}

export interface Authorship {
  paper_short_uid: string;
  author_short_uid: string;
  author_position: number;
  is_corresponding: boolean;
  raw_author_name: string | null;
  institution_uids: string[];
}

export interface PaperRelationship {
  source_short_uid: string;
  target_short_uid: string;
  relationship_type: 'cites' | 'similar';
  tag?: string;
}

// Worker message types
export interface WorkerMessage {
  type: string;
  payload: any;
}

export interface OpenAlexPaper {
  id: string;
  ids?: Record<string, string>;
  doi?: string | null;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  type?: string;
  language?: string;
  authorships?: {
    author_position?: string;
    // --- FIX: Added the missing 'is_corresponding' property to match the API response. ---
    is_corresponding?: boolean;
    author?: {
      id?: string;
      display_name: string;
      orcid?: string;
    };
    raw_author_name?: string;
    institutions?: {
      id?: string;
      display_name?: string;
      country_code?: string;
    }[];
  }[];
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
  fwci?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  best_oa_location?: any;
  open_access?: {
    oa_status?: string;
    oa_url?: string;
  };
  keywords?: {
    id: string;
    display_name: string;
    score?: number;
  }[];
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
    next_cursor?: string | null;
  };
}

export interface GraphState {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paperRelationships: PaperRelationship[];
  externalIdIndex: Record<string, string>;
  masterPaperUid: string | null;
  stubCreationThreshold: number;
}

export interface UtilityFunctions {
  postMessage: (type: string, payload: any) => void;
  addToExternalIndex: (idType: string, idValue: string, entityUid: string) => void;
  findByExternalId: (idType: string, idValue: string) => string | null;
}