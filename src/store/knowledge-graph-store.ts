
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
  // relationship_tags has been removed, as this is now handled by `relation_to_master`
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
  // 'tag' has been removed. This is a pure graph relationship now.
}

export interface ExternalIdType {
  id_type: 'openalex' | 'doi' | 'ss' | 'corpusId';
  id_value: string;
}

export interface AppStatus {
  state: 'idle' | 'loading' | 'enriching' | 'extending' | 'active' | 'error';
  message: string | null;
  progress?: number;
}

// Used for batch processing messages from the worker
interface WorkerMessage {
  type: string;
  payload: any;
}

interface KnowledgeGraphStore {
  // === ENTITY SLICES ===
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;

  // === RELATIONSHIP SLICES ===
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  // NEW: The UI context index, as per the new architecture.
  relation_to_master: Record<string, string[]>;

  // === DEDUPLICATION INDEX ===
  external_id_index: Record<string, string>;

  // === APP STATUS ===
  app_status: AppStatus;

  // === ACTIONS ===
  setAppStatus: (status: Partial<AppStatus>) => void;
  
  // New actions to handle streaming data
  resetGraph: () => void;
  addPaper: (paper: Paper) => void;
  addAuthor: (author: Author) => void;
  addInstitution: (institution: Institution) => void;
  addAuthorship: (authorship: Authorship) => void;
  addRelationship: (relationship: PaperRelationship) => void;
  setExternalId: (key: string, uid: string) => void;

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

  // --- START: NEW BATCH UPDATE ACTION ---
  applyMessageBatch: (batch: WorkerMessage[]) => void;
  // --- END: NEW BATCH UPDATE ACTION ---
}

export const useKnowledgeGraphStore = create<KnowledgeGraphStore>((set) => ({
  // Initial state
  papers: {},
  authors: {},
  institutions: {},
  authorships: {},
  paper_relationships: [],
  relation_to_master: {}, // NEW: Initialize new state
  external_id_index: {},
  app_status: {
    state: 'idle',
    message: null,
    progress: 0,
  },

  // Actions
  setAppStatus: (status) => set((state) => ({
    app_status: { ...state.app_status, ...status }
  })),

  // --- START OF NEW STREAMING ACTIONS ---
  
  // Action to clear the entire graph state, called before a new analysis begins.
  resetGraph: () => set({
    papers: {},
    authors: {},
    institutions: {},
    authorships: {},
    paper_relationships: [],
    relation_to_master: {}, // NEW: Reset new state
    external_id_index: {},
  }),

  // Adds a single paper to the store.
  addPaper: (paper) => set((state) => ({
    papers: { ...state.papers, [paper.short_uid]: paper }
  })),
  
  // Adds a single author to the store.
  addAuthor: (author) => set((state) => ({
    authors: { ...state.authors, [author.short_uid]: author }
  })),

  // Adds a single institution to the store.
  addInstitution: (institution) => set((state) => ({
    institutions: { ...state.institutions, [institution.short_uid]: institution }
  })),

  // Adds a single authorship to the store.
  addAuthorship: (authorship) => {
    const key = `${authorship.paper_short_uid}_${authorship.author_short_uid}`;
    set((state) => ({
      authorships: { ...state.authorships, [key]: authorship }
    }));
  },

  // Adds a single paper relationship to the store.
  addRelationship: (relationship) => set((state) => ({
    paper_relationships: [...state.paper_relationships, relationship]
  })),
  
  // Adds a single external ID mapping to the index.
  setExternalId: (key, uid) => set((state) => ({
    external_id_index: { ...state.external_id_index, [key]: uid }
  })),

  // --- END OF NEW STREAMING ACTIONS ---

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
  }),
  
  // --- START: NEW BATCH UPDATE ACTION IMPLEMENTATION ---
  applyMessageBatch: (batch) => set((state) => {
    // Create mutable drafts of the state slices we will be updating.
    // This is more performant than spreading the state for every single message in the batch.
    const nextState = {
      papers: { ...state.papers },
      authors: { ...state.authors },
      institutions: { ...state.institutions },
      authorships: { ...state.authorships },
      paper_relationships: [...state.paper_relationships],
      relation_to_master: { ...state.relation_to_master }, // NEW: Include new state in draft
      external_id_index: { ...state.external_id_index },
    };

    // Process each message in the batch and apply it to our draft state.
    for (const message of batch) {
      const { type, payload } = message;

      switch (type) {
        case 'graph/reset':
          nextState.papers = {};
          nextState.authors = {};
          nextState.institutions = {};
          nextState.authorships = {};
          nextState.paper_relationships = [];
          nextState.relation_to_master = {}; // NEW: Reset new state
          nextState.external_id_index = {};
          break;
        case 'graph/addPaper':
          nextState.papers[payload.paper.short_uid] = payload.paper;
          break;
        case 'graph/addAuthor':
          nextState.authors[payload.author.short_uid] = payload.author;
          break;
        case 'graph/addInstitution':
          nextState.institutions[payload.institution.short_uid] = payload.institution;
          break;
        case 'graph/addAuthorship':
          const key = `${payload.authorship.paper_short_uid}_${payload.authorship.author_short_uid}`;
          nextState.authorships[key] = payload.authorship;
          break;
        case 'graph/addRelationship':
          nextState.paper_relationships.push(payload.relationship);
          break;
        // NEW: Handle adding tags to the new UI index
        case 'graph/addRelationshipTag':
          const { paperUid, tag } = payload;
          if (!nextState.relation_to_master[paperUid]) {
            nextState.relation_to_master[paperUid] = [];
          }
          // Avoid duplicate tags
          if (!nextState.relation_to_master[paperUid].includes(tag)) {
            nextState.relation_to_master[paperUid].push(tag);
          }
          break;
        case 'graph/setExternalId':
          nextState.external_id_index[payload.key] = payload.uid;
          break;
        case 'papers/updateOne':
          if (nextState.papers[payload.id]) {
            nextState.papers[payload.id] = { ...nextState.papers[payload.id], ...payload.changes };
          }
          break;
        case 'graph/addNodes':
          Object.assign(nextState.papers, payload.data.papers || {});
          Object.assign(nextState.authors, payload.data.authors || {});
          Object.assign(nextState.institutions, payload.data.institutions || {});
          Object.assign(nextState.authorships, payload.data.authorships || {});
          nextState.paper_relationships.push(...(payload.data.paper_relationships || []));
          break;
        case 'graph/applyAuthorMerge':
          // This logic is complex, so we'll reuse the existing applyAuthorMerge logic,
          // but apply it to our draft state `nextState` instead of the original state.
          const { updates, deletions } = payload;
          updates.authors.forEach(({ id, changes }: { id: string, changes: Partial<Author> }) => {
            if (nextState.authors[id]) {
              nextState.authors[id] = { ...nextState.authors[id], ...changes };
            }
          });
          updates.authorships.forEach(({ id, changes }: { id: string, changes: Partial<Authorship> }) => {
            if (nextState.authorships[id]) {
              nextState.authorships[id] = { ...nextState.authorships[id], ...changes };
            }
          });
          deletions.authors.forEach((id: string) => {
            delete nextState.authors[id];
          });
          break;
      }
    }

    // Return the final, updated state. Zustand will handle the single re-render.
    return nextState;
  }),
  // --- END: NEW BATCH UPDATE ACTION IMPLEMENTATION ---
}));