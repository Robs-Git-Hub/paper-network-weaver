
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

// This function clears the state by mutating the existing objects/arrays.
function clearState() {
  for (const key in papers) delete papers[key];
  for (const key in authors) delete authors[key];
  for (const key in institutions) delete institutions[key];
  for (const key in authorships) delete authorships[key];
  for (const key in externalIdIndex) delete externalIdIndex[key];
  paperRelationships.length = 0;
}

export function resetState() {
  clearState();
  masterPaperUid = null;
  stubCreationThreshold = 3;
}

// This function now MUTATES the existing state objects and arrays,
// ensuring all references throughout the worker are updated correctly.
export function setState(newState: {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paperRelationships: PaperRelationship[]; // Expects camelCase
  externalIdIndex: Record<string, string>; // Expects camelCase
  masterPaperUid: string | null;
  stubCreationThreshold: number;
}) {
  // 1. Clear the current state by mutation.
  clearState();

  // 2. Copy the new state into the existing, now-empty objects and arrays.
  Object.assign(papers, newState.papers);
  Object.assign(authors, newState.authors);
  Object.assign(institutions, newState.institutions);
  Object.assign(authorships, newState.authorships);
  Object.assign(externalIdIndex, newState.externalIdIndex);
  
  // For arrays, push the new items into the existing array reference.
  for (const item of newState.paperRelationships) {
    paperRelationships.push(item);
  }

  // 3. Reset primitive values.
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