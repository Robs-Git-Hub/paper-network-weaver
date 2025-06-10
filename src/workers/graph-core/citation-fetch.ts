
import { openAlexService } from '../../services/openAlex';
import { normalizeOpenAlexId } from '../../services/openAlex-util';

const BATCH_SIZE = 20;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function fetchFirstDegreeCitations(openAlexId: string) {
  console.log(`[Citation Fetch] Fetching first-degree citations for ${openAlexId}`);
  return await openAlexService.fetchCitations(openAlexId);
}

export async function fetchSecondDegreeCitations(citingPaperIds: string[]) {
  console.log(`[Citation Fetch] Fetching second-degree citations for ${citingPaperIds.length} papers`);
  const cleanIds = citingPaperIds.map(normalizeOpenAlexId);
  const idChunks = chunkArray(cleanIds, BATCH_SIZE);
  const detailedResults = [];

  for (const chunk of idChunks) {
    console.log(`[Citation Fetch] Processing batch of ${chunk.length} papers`);
    const batch = await openAlexService.fetchMultiplePapers(chunk);
    detailedResults.push(...batch.results);
  }

  return {
    meta: { count: detailedResults.length, db_response_time_ms: 0, page: 1, per_page: detailedResults.length },
    results: detailedResults
  };
}

export async function fetchAllCitations(openAlexId: string) {
  console.log(`[Citation Fetch] Fetching all citations with batching for ${openAlexId}`);
  const firstDegree = await openAlexService.fetchCitations(openAlexId);
  const citingIds = firstDegree.results.map(p => normalizeOpenAlexId(p.id));
  
  if (citingIds.length === 0) {
    return firstDegree;
  }

  console.log(`[Citation Fetch] Found ${citingIds.length} citing papers, fetching in batches of ${BATCH_SIZE}`);
  const idChunks = chunkArray(citingIds, BATCH_SIZE);
  const detailedResults = [];

  for (const chunk of idChunks) {
    console.log(`[Citation Fetch] Processing batch of ${chunk.length} papers`);
    const batch = await openAlexService.fetchMultiplePapers(chunk);
    detailedResults.push(...batch.results);
  }

  return { meta: firstDegree.meta, results: detailedResults };
}

export function createStubsFromOpenAlexIds(openAlexIds: string[]) {
  console.log(`[Citation Fetch] Creating stubs for ${openAlexIds.length} OpenAlex IDs`);
  return openAlexIds.map(id => ({
    id,
    display_name: 'Loading...',
    publication_year: null,
    cited_by_count: 0,
    authorships: [],
    type: 'article'
  }));
}
