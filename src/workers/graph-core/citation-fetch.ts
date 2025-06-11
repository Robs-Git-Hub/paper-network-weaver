
import { openAlexService } from '../../services/openAlex';
import { normalizeOpenAlexId } from '../../services/openAlex-util';

export async function fetchFirstDegreeCitations(openAlexId: string) {
  console.log(`[Citation Fetch] Fetching first-degree citations for ${openAlexId}`);
  return await openAlexService.fetchCitations(openAlexId);
}

export async function fetchSecondDegreeCitations(citingPaperIds: string[]) {
  console.log(`[Citation Fetch] Fetching second-degree citations for ${citingPaperIds.length} papers`);
  
  if (citingPaperIds.length === 0) {
    return {
      meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 0 },
      results: []
    };
  }

  const result = await openAlexService.fetchMultiplePapers(citingPaperIds);
  return result;
}

export async function fetchAllCitations(openAlexId: string) {
  console.log(`[Citation Fetch] Fetching all citations with batching for ${openAlexId}`);
  const firstDegree = await openAlexService.fetchCitations(openAlexId);
  const citingIds = firstDegree.results.map(p => normalizeOpenAlexId(p.id));
  
  if (citingIds.length === 0) {
    return firstDegree;
  }

  console.log(`[Citation Fetch] Found ${citingIds.length} citing papers, fetching details`);
  const detailedPapers = await openAlexService.fetchMultiplePapers(citingIds);

  return { 
    meta: firstDegree.meta, 
    results: detailedPapers.results 
  };
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
