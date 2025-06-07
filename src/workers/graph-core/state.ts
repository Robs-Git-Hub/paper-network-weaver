
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
  papers = {};
  authors = {};
  institutions = {};
  authorships = {};
  paperRelationships = [];
  externalIdIndex = {};
  masterPaperUid = null;
  stubCreationThreshold = 3;
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
