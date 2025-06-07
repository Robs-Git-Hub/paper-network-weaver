
// Utility functions for worker operations

export function postMessage(type: string, payload: any) {
  self.postMessage({ type, payload });
}

export function addToExternalIndex(idType: string, idValue: string, entityUid: string, externalIdIndex: Record<string, string>) {
  const key = `${idType}:${idValue}`;
  externalIdIndex[key] = entityUid;
}

export function findByExternalId(idType: string, idValue: string, externalIdIndex: Record<string, string>): string | null {
  const key = `${idType}:${idValue}`;
  return externalIdIndex[key] || null;
}

export function getGraphState(
  papers: Record<string, any>,
  authors: Record<string, any>,
  institutions: Record<string, any>,
  authorships: Record<string, any>,
  paperRelationships: any[],
  externalIdIndex: Record<string, string>,
  masterPaperUid: string | null,
  stubCreationThreshold: number
) {
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

export function getUtilityFunctions(externalIdIndex: Record<string, string>) {
  return {
    postMessage,
    addToExternalIndex: (idType: string, idValue: string, entityUid: string) => addToExternalIndex(idType, idValue, entityUid, externalIdIndex),
    findByExternalId: (idType: string, idValue: string) => findByExternalId(idType, idValue, externalIdIndex)
  };
}
