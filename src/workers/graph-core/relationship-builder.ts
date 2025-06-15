
import { fetchAllPages } from '../../services/openAlex';
import { processOpenAlexPaper, processSemanticScholarPaper } from './entity-processors';
import { getUtilityFunctions, chunkArray } from './utils';
import { Paper, PaperRelationship } from './types';
import { PHASE_C_WEIGHTS } from '../../config/progress-weights';

const API_BATCH_SIZE = 100;

// --- 1st DEGREE CITATIONS ---
export async function fetchFirstDegreeCitations(masterPaperId: string, getState: Function, utils: ReturnType<typeof getUtilityFunctions>) {
  console.log('[Worker] Phase A, Step 2: Fetching 1st degree citations from OpenAlex.');
  
  const allCitations = await fetchAllPages(
    `https://api.openalex.org/works?filter=cites:${masterPaperId}`,
    { select: 'id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works' }
  );

  let referencedBy1stDegreeStubs: Record<string, number> = {};

  for (const citation of allCitations) {
    const { papers, authors, institutions, authorships } = getState();
    const citationUid = await processOpenAlexPaper(citation, true, papers, authors, institutions, authorships, utils);
    
    utils.addRelationship({
      source_short_uid: citationUid,
      target_short_uid: getState().masterPaperUid,
      relationship_type: 'cites',
      tag: '1st_degree'
    });

    // Collect referenced works from this 1st degree citation
    if (citation.referenced_works) {
      for (const refId of citation.referenced_works) {
        if (refId) {
          referencedBy1stDegreeStubs[refId] = (referencedBy1stDegreeStubs[refId] || 0) + 1;
        }
      }
    }
  }

  // Process co-cited papers
  const stubCreationThreshold = getState().stubCreationThreshold;
  const commonlyCoCited = Object.entries(referencedBy1stDegreeStubs)
    .filter(([, count]) => count >= stubCreationThreshold)
    .map(([id]) => id);

  for (const paperId of commonlyCoCited) {
    const { papers, authors, institutions, authorships } = getState();
    const paperUid = await processOpenAlexPaper({ id: paperId }, true, papers, authors, institutions, authorships, utils);
    utils.addRelationship({
      source_short_uid: paperUid,
      target_short_uid: getState().masterPaperUid,
      relationship_type: 'similar',
      tag: 'referenced_by_1st_degree'
    });
  }
  
  console.log(`[Worker] Phase A, Step 2: Processed ${allCitations.length} citations, found ${commonlyCoCited.length} referenced_by_1st_degree stubs.`);
}

// --- 2nd DEGREE CITATIONS ---
export async function fetchSecondDegreeCitations(getState: Function, utils: ReturnType<typeof getUtilityFunctions> & { updateAndPostProgress: Function }) {
  console.log('[Worker] Phase C, Step 8: Fetching 2nd degree citations.');
  const { papers, paperRelationships } = getState();

  const firstDegreePaperUids = paperRelationships
    .filter((r: PaperRelationship) => r.tag === '1st_degree')
    .map((r: PaperRelationship) => r.source_short_uid);

  const firstDegreePapers = firstDegreePaperUids.map((uid: string) => papers[uid]).filter(Boolean);
  
  if (firstDegreePapers.length === 0) return;

  const totalCalls = Math.ceil(firstDegreePapers.length / API_BATCH_SIZE);
  const progressPerCall = PHASE_C_WEIGHTS.FETCH_SECOND_DEGREE / totalCalls;
  let callsMade = 0;

  const chunks = chunkArray(firstDegreePapers, API_BATCH_SIZE);

  for (const chunk of chunks) {
    const filterString = chunk.map(p => p.short_uid).join('|');
    const allCitations = await fetchAllPages(
      `https://api.openalex.org/works?filter=cites:${filterString}`,
      { select: 'id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works' }
    );

    for (const citation of allCitations) {
      const { papers, authors, institutions, authorships } = getState();
      const citationUid = await processOpenAlexPaper(citation, true, papers, authors, institutions, authorships, utils);
      
      utils.addRelationship({
        source_short_uid: citationUid,
        target_short_uid: getState().masterPaperUid, // This relationship is simplified for the graph
        relationship_type: 'cites',
        tag: '2nd_degree'
      });
    }
    callsMade++;
    utils.updateAndPostProgress(progressPerCall, `Fetching second-degree citations... (${callsMade}/${totalCalls})`);
  }
  console.log(`[Worker] Found ${paperRelationships.filter((r: PaperRelationship) => r.tag === '2nd_degree').length} 2nd degree citations.`);
}


// --- HYDRATE STUB PAPERS ---
export async function hydrateStubPapers(getState: Function, utils: ReturnType<typeof getUtilityFunctions> & { updateAndPostProgress: Function }) {
  console.log('[Worker] Phase C, Step 9: Hydrating stub papers.');
  const { papers } = getState();
  const stubPapers = Object.values(papers).filter((p: Paper) => p.is_stub);
  
  if (stubPapers.length === 0) return;

  const totalCalls = Math.ceil(stubPapers.length / API_BATCH_SIZE);
  const progressPerCall = PHASE_C_WEIGHTS.HYDRATE_STUBS / totalCalls;
  let callsMade = 0;

  const chunks = chunkArray(stubPapers, API_BATCH_SIZE);

  for (const chunk of chunks) {
    const filterString = chunk.map(p => p.short_uid).join('|');
    const hydratedPapers = await fetchAllPages(
      `https://api.openalex.org/works?filter=openalex:${filterString}`,
      { select: 'id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works' }
    );

    for (const paperData of hydratedPapers) {
      const { papers, authors, institutions, authorships } = getState();
      await processOpenAlexPaper(paperData, false, papers, authors, institutions, authorships, utils);
    }
    callsMade++;
    utils.updateAndPostProgress(progressPerCall, `Hydrating related papers... (${callsMade}/${totalCalls})`);
  }
  console.log(`[Worker] Successfully hydrated ${stubPapers.length} stub papers.`);
}


// --- HYDRATE MASTER PAPER ---
export async function hydrateMasterPaper(getState: Function, utils: ReturnType<typeof getUtilityFunctions>) {
  console.log('[Worker] Phase B, Step 4: Hydrating Master Paper from OpenAlex.');
  const { masterPaperUid, papers } = getState();
  if (!masterPaperUid || !papers[masterPaperUid] || !papers[masterPaperUid].is_stub) {
    return;
  }

  const masterPaperData = await fetchAllPages(
    `https://api.openalex.org/works/${masterPaperUid}`,
    { select: 'id,ids,doi,title,publication_year,publication_date,type,language,authorships,primary_location,fwci,cited_by_count,abstract_inverted_index,best_oa_location,open_access,keywords,referenced_works,related_works' }
  );

  if (masterPaperData.length > 0) {
    const { papers, authors, institutions, authorships } = getState();
    await processOpenAlexPaper(masterPaperData[0], false, papers, authors, institutions, authorships, utils);
    console.log('[Worker] Phase B, Step 4: Master Paper hydration complete.');
  }
}