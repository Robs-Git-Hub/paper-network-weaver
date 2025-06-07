
import { create } from 'zustand';

// Define the interfaces for the knowledge graph data
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
  relationship_type: 'cites' | 'similar';
}

export interface ExternalIdType {
  id_type: 'openalex' | 'doi' | 'ss' | 'corpusId';
  id_value: string;
}

export interface AppStatus {
  state: 'idle' | 'loading' | 'enriching' | 'active' | 'error';
  message: string | null;
}

interface KnowledgeGraphStore {
  // === ENTITY SLICES ===
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;

  // === RELATIONSHIP SLICES ===
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];

  // === DEDUPLICATION INDEX ===
  external_id_index: Record<string, string>;

  // === APP STATUS ===
  app_status: AppStatus;

  // === ACTIONS ===
  setAppStatus: (status: Partial<AppStatus>) => void;
  setState: (data: {
    papers: Record<string, Paper>;
    authors: Record<string, Author>;
    institutions: Record<string, Institution>;
    authorships: Record<string, Authorship>;
    paper_relationships: PaperRelationship[];
    external_id_index: Record<string, string>;
  }) => void;
  updatePaper: (id: string, changes: Partial<Paper>) => void;
  addNodes: (data: {
    papers?: Record<string, Paper>;
    authors?: Record<string, Author>;
    institutions?: Record<string, Institution>;
    authorships?: Record<string, Authorship>;
    paper_relationships?: PaperRelationship[];
  }) => void;
  applyAuthorMerge: (updates: {
    authors: Array<{ id: string; changes: Partial<Author> }>;
    authorships: Array<{ id: string; changes: Partial<Authorship> }>;
  }, deletions: {
    authors: string[];
  }) => void;
}

export const useKnowledgeGraphStore = create<KnowledgeGraphStore>((set, get) => ({
  // Initial state
  papers: {},
  authors: {},
  institutions: {},
  authorships: {},
  paper_relationships: [],
  external_id_index: {},
  app_status: {
    state: 'idle',
    message: null
  },

  // Actions
  setAppStatus: (status) => set((state) => ({
    app_status: { ...state.app_status, ...status }
  })),

  setState: (data) => {
    set({
      papers: data.papers,
      authors: data.authors,
      institutions: data.institutions,
      authorships: data.authorships,
      paper_relationships: data.paper_relationships,
      external_id_index: data.external_id_index
    });
  },

  updatePaper: (id, changes) => set((state) => ({
    papers: {
      ...state.papers,
      [id]: { ...state.papers[id], ...changes }
    }
  })),

  addNodes: (data) => set((state) => ({
    papers: { ...state.papers, ...(data.papers || {}) },
    authors: { ...state.authors, ...(data.authors || {}) },
    institutions: { ...state.institutions, ...(data.institutions || {}) },
    authorships: { ...state.authorships, ...(data.authorships || {}) },
    paper_relationships: [...state.paper_relationships, ...(data.paper_relationships || [])]
  })),

  applyAuthorMerge: (updates, deletions) => set((state) => {
    const newAuthors = { ...state.authors };
    const newAuthorships = { ...state.authorships };

    // Apply author updates
    updates.authors.forEach(({ id, changes }) => {
      if (newAuthors[id]) {
        newAuthors[id] = { ...newAuthors[id], ...changes };
      }
    });

    // Apply authorship updates
    updates.authorships.forEach(({ id, changes }) => {
      if (newAuthorships[id]) {
        newAuthorships[id] = { ...newAuthorships[id], ...changes };
      }
    });

    // Delete authors
    deletions.authors.forEach(id => {
      delete newAuthors[id];
    });

    return {
      authors: newAuthors,
      authorships: newAuthorships
    };
  })
}));
