
// Global worker state management
import type { Paper, Author, Institution, Authorship, PaperRelationship } from './types';

export let papers: Record<string, Paper> = {};
export let authors: Record<string, Author> = {};
export let institutions: Record<string, Institution> = {};
export let authorships: Record<string, Authorship> = {};
export let paperRelationships: PaperRelationship[] = [];
export let externalIdIndex: Record<string, string> = {};
export let masterPaperUid: string | null = null;
export let stubCreationThreshold = 3;

export function resetState() {
  // Clear mutable objects and arrays without breaking references
  for (const key in papers) delete papers[key];
  for (const key in authors) delete authors[key];
  for (const key in institutions) delete institutions[key];
  for (const key in authorships) delete authorships[key];
  for (const key in externalIdIndex) delete externalIdIndex[key];
  paperRelationships.length = 0;

  // Reset primitive values
  masterPaperUid = null;
  stubCreationThreshold = 3;
}

// *** ADDED THIS ENTIRE FUNCTION ***
// This function re-hydrates the worker's state from the main thread's authoritative state.
export function setState(newState: {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  external_id_index: Record<string, string>;
  masterPaperUid: string | null;
  stubCreationThreshold: number;
}) {
  papers = newState.papers;
  authors = newState.authors;
  institutions = newState.institutions;
  authorships = newState.authorships;
  paperRelationships = newState.paper_relationships; // Note the mapping from snake_case to camelCase
  externalIdIndex = newState.external_id_index;     // Note the mapping from snake_case to camelCase
  masterPaperUid = newState.masterPaperUid;
  stubCreationThreshold = newState.stubCreationThreshold;
}

export function setMasterPaperUid(uid: string) {
  masterPaperUid = uid;
}

export function setStubCreationThreshold(threshold: number) {
  stubCreationThreshold = threshold;
}

export function getState() {
  return {
    papers,
    authors,
    institutions,
    authorships,
    paperRelationships,
    externalIdIndex,
    masterPaperUid,
    stubCreationThreshold
  };
}