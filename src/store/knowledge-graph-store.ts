
// src/store/knowledge-graph-store.ts

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { EnrichedPaper } from '@/types';

// Interfaces remain the same...
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
  relationship_tags?: string[];
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
  relationship_type: 'cites';
}

export interface AppStatus {
  state: 'idle' | 'loading' | 'enriching' | 'extending' | 'active' | 'error';
  message: string | null;
  progress?: number;
  phaseCProgress?: number;
}

interface WorkerMessage {
  type: string;
  payload: any;
}

interface KnowledgeGraphStore {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  relation_to_master: Record<string, string[]>;
  external_id_index: Record<string, string>;
  app_status: AppStatus;
  enriched_papers: Record<string, EnrichedPaper>;

  // --- START: NEW PERFORMANCE FIX ---
  // A new index for O(1) lookup of authorships by paper UID.
  authorshipsByPaperUid: Record<string, Authorship[]>;
  // --- END: NEW PERFORMANCE FIX ---

  setAppStatus: (status: Partial<AppStatus>) => void;
  resetGraph: () => void;
  updatePaper: (id: string, changes: Partial<Paper>) => void;
  applyMessageBatch: (batch: WorkerMessage[]) => void;
}

// Helper function to build an enriched paper object
const createEnrichedPaper = (paper: Paper, state: KnowledgeGraphStore): EnrichedPaper => {
  // FIX: This lookup is now instantaneous using the index.
  const paperAuthorships = state.authorshipsByPaperUid[paper.short_uid] || [];
  
  const paperAuthors = paperAuthorships
    .sort((a, b) => a.author_position - b.author_position)
    .map(auth => state.authors[auth.author_short_uid])
    .filter((author): author is Author => !!author);

  const tags = state.relation_to_master[paper.short_uid] || [];

  return {
    ...paper,
    authors: paperAuthors,
    relationship_tags: tags,
  };
};

export const useKnowledgeGraphStore = create<KnowledgeGraphStore>()(devtools((set) => ({
  papers: {},
  authors: {},
  institutions: {},
  authorships: {},
  paper_relationships: [],
  relation_to_master: {},
  external_id_index: {},
  app_status: { state: 'idle', message: null, progress: 0 },
  enriched_papers: {},

  // Initialize the new index
  authorshipsByPaperUid: {},

  setAppStatus: (status) => set((state) => ({
    app_status: { ...state.app_status, ...status }
  })),

  resetGraph: () => set({
    papers: {},
    authors: {},
    institutions: {},
    authorships: {},
    paper_relationships: [],
    relation_to_master: {},
    external_id_index: {},
    enriched_papers: {},
    authorshipsByPaperUid: {}, // Also reset the index
  }),

  updatePaper: (id, changes) => set((state) => {
    const updatedPaper = { ...state.papers[id], ...changes };
    return {
      papers: { ...state.papers, [id]: updatedPaper },
      enriched_papers: {
        ...state.enriched_papers,
        [id]: createEnrichedPaper(updatedPaper, state),
      }
    };
  }),

  applyMessageBatch: (batch) => set((state) => {
    const nextState = {
      ...state,
      papers: { ...state.papers },
      authors: { ...state.authors },
      institutions: { ...state.institutions },
      authorships: { ...state.authorships },
      paper_relationships: [...state.paper_relationships],
      relation_to_master: { ...state.relation_to_master },
      external_id_index: { ...state.external_id_index },
      enriched_papers: { ...state.enriched_papers },
      // Make a mutable copy of the index for this batch
      authorshipsByPaperUid: { ...state.authorshipsByPaperUid },
    };

    for (const message of batch) {
      const { type, payload } = message;

      switch (type) {
        case 'graph/reset':
          // Full reset logic...
          nextState.papers = {};
          nextState.authors = {};
          nextState.institutions = {};
          nextState.authorships = {};
          nextState.paper_relationships = [];
          nextState.relation_to_master = {};
          nextState.external_id_index = {};
          nextState.enriched_papers = {};
          nextState.authorshipsByPaperUid = {};
          break;
        case 'graph/addPaper':
          const newPaper = payload.paper as Paper;
          nextState.papers[newPaper.short_uid] = newPaper;
          nextState.enriched_papers[newPaper.short_uid] = createEnrichedPaper(newPaper, nextState);
          break;
        case 'graph/addAuthor':
          nextState.authors[payload.author.short_uid] = payload.author;
          break;
        case 'graph/addInstitution':
          nextState.institutions[payload.institution.short_uid] = payload.institution;
          break;
        case 'graph/addAuthorship':
          const newAuthorship = payload.authorship as Authorship;
          const key = `${newAuthorship.paper_short_uid}_${newAuthorship.author_short_uid}`;
          nextState.authorships[key] = newAuthorship;

          // --- FIX: Update the new index ---
          const paperUid = newAuthorship.paper_short_uid;
          if (!nextState.authorshipsByPaperUid[paperUid]) {
            nextState.authorshipsByPaperUid[paperUid] = [];
          }
          nextState.authorshipsByPaperUid[paperUid].push(newAuthorship);
          // --- END FIX ---

          const relatedPaper = nextState.papers[paperUid];
          if (relatedPaper) {
            nextState.enriched_papers[paperUid] = createEnrichedPaper(relatedPaper, nextState);
          }
          break;
        // ... other cases remain the same
        case 'graph/addRelationship':
          nextState.paper_relationships.push(payload.relationship);
          break;
        case 'graph/addRelationshipTag':
          const { paperUid: tagPaperUid, tag } = payload;
          if (!nextState.relation_to_master[tagPaperUid]) {
            nextState.relation_to_master[tagPaperUid] = [];
          }
          if (!nextState.relation_to_master[tagPaperUid].includes(tag)) {
            nextState.relation_to_master[tagPaperUid].push(tag);
          }
          const paperToUpdate = nextState.papers[tagPaperUid];
          if (paperToUpdate) {
            nextState.enriched_papers[tagPaperUid] = createEnrichedPaper(paperToUpdate, nextState);
          }
          break;
        case 'graph/setExternalId':
          nextState.external_id_index[payload.key] = payload.uid;
          break;
        case 'papers/updateOne':
          const paperToUpdateChanges = nextState.papers[payload.id];
          if (paperToUpdateChanges) {
            const updatedPaper = { ...paperToUpdateChanges, ...payload.changes };
            nextState.papers[payload.id] = updatedPaper;
            nextState.enriched_papers[payload.id] = createEnrichedPaper(updatedPaper, nextState);
          }
          break;
      }
    }

    return nextState;
  }),
}), { name: 'KnowledgeGraphStore' }));