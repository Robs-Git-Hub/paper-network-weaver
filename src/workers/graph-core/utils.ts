
// Utility functions for worker operations
import { externalIdIndex as globalExternalIdIndex } from './state';

export function postMessage(type: string, payload: any) {
  self.postMessage({ type, payload });
}

export function addToExternalIndex(idType: string, idValue: string, entityUid: string) {
  const key = `${idType}:${idValue}`;
  globalExternalIdIndex[key] = entityUid;
}

export function findByExternalId(idType: string, idValue: string): string | null {
  const key = `${idType}:${idValue}`;
  return globalExternalIdIndex[key] || null;
}

// *** THIS IS THE NEW, MISSING FUNCTION ***
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// This function is now simplified as it no longer needs to manage the index reference.
export function getUtilityFunctions() {
  return {
    postMessage,
    addToExternalIndex,
    findByExternalId
  };
}
