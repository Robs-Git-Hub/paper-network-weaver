
import { create } from 'zustand';

// Types from the schema
export type ExternalIdType = 'openalex' | 'doi' | 'mag' | 'ss' | 'ror' | 'CorpusId' | 'DBLP' | 'ACL';
export type RelationshipType = 'cites' | 'similar';

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
  relationship_type: RelationshipType;
}

export interface AppStatus {
  state: 'idle' | 'loading' | 'enriching' | 'extending' | 'error';
  message: string | null;
}

export interface KnowledgeGraphStore {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  external_id_index: Record<string, string>;
  app_status: AppStatus;
  
  // Actions
  setAppStatus: (status: Partial<AppStatus>) => void;
  resetStore: () => void;
  updatePaper: (id: string, changes: Partial<Paper>) => void;
  setPapers: (papers: Record<string, Paper>) => void;
  setAuthors: (authors: Record<string, Author>) => void;
  setInstitutions: (institutions: Record<string, Institution>) => void;
  setAuthorships: (authorships: Record<string, Authorship>) => void;
  setPaperRelationships: (relationships: PaperRelationship[]) => void;
  setExternalIdIndex: (index: Record<string, string>) => void;
  setGraphData: (data: {
    papers?: Record<string, Paper>;
    authors?: Record<string, Author>;
    institutions?: Record<string, Institution>;
    authorships?: Record<string, Authorship>;
    paper_relationships?: PaperRelationship[];
    external_id_index?: Record<string, string>;
  }) => void;
}

const initialState = {
  papers: {},
  authors: {},
  institutions: {},
  authorships: {},
  paper_relationships: [],
  external_id_index: {},
  app_status: {
    state: 'idle' as const,
    message: null,
  },
};

export const useKnowledgeGraphStore = create<KnowledgeGraphStore>((set, get) => ({
  ...initialState,
  
  setAppStatus: (status) => 
    set((state) => ({
      app_status: { ...state.app_status, ...status }
    })),
    
  resetStore: () => set(initialState),
  
  updatePaper: (id, changes) =>
    set((state) => ({
      papers: {
        ...state.papers,
        [id]: { ...state.papers[id], ...changes }
      }
    })),
    
  setPapers: (papers) => set({ papers }),
  setAuthors: (authors) => set({ authors }),
  setInstitutions: (institutions) => set({ institutions }),
  setAuthorships: (authorships) => set({ authorships }),
  setPaperRelationships: (paper_relationships) => set({ paper_relationships }),
  setExternalIdIndex: (external_id_index) => set({ external_id_index }),
  
  setGraphData: (data) =>
    set((state) => ({
      ...state,
      ...data,
    })),
}));
