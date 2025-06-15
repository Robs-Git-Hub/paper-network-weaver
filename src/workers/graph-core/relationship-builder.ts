
import { openAlexService } from '../../services/openAlex';
import { processOpenAlexPaper } from './entity-processors';
import { getUtilityFunctions, chunkArray } from './utils';
// --- FIX: Import GraphState to provide strong typing for the worker's state object. ---
import { Paper, PaperRelationship, UtilityFunctions, GraphState } from './types';

const API_BATCH_SIZE = 100;

// --- 1st DEGREE CITATIONS ---
export async function fetchFirstDegreeCitations(masterPaperId: string, getState: Function, utils: UtilityFunctions) {
  console.log('[Worker] Phase A, Step 2: Fetching 1st degree citations from OpenAlex.');
  
  const response = await openAlexService.fetchCitations(masterPaperId);
  const allCitations = response.results;

  let referencedBy1stDegreeStubs: Record<string, number> = {};

  for (const citation of allCitations) {
    const { papers, authors, institutions, authorships } = getState();
    const citationUid = await processOpenAlexPaper(citation, true, papers, authors, institutions, authorships, utils);
    
    utils.postMessage('graph/addRelationship', {
      relationship: {
        source_short_uid: citationUid,
        target_short_uid: getState().masterPaperUid,
        relationship_type: 'cites',
        tag: '1st_degree'
      }
    });

    if (citation.referenced_works) {
      for (const refId of citation.referenced_works) {
        if (refId) {
          referencedBy1stDegreeStubs[refId] = (referencedBy1stDegreeStubs[refId] || 0) + 1;
        }
      }
    }
  }

  const stubCreationThreshold = getState().stubCreationThreshold;
  const commonlyCoCited = Object.entries(referencedBy1stDegreeStubs)
    .filter(([, count]) => count >= stubCreationThreshold)
    .map(([id]) => id);

  for (const paperId of commonlyCoCited) {
    const { papers, authors, institutions, authorships } = getState();
    const paperUid = await processOpenAlexPaper({ id: paperId }, true, papers, authors, institutions, authorships, utils);
    utils.postMessage('graph/addRelationship', {
      relationship: {
        source_short_uid: paperUid,
        target_short_uid: getState().masterPaperUid,
        relationship_type: 'similar',
        tag: 'referenced_by_1st_degree'
      }
    });
  }
  
  console.log(`[Worker] Phase A, Step 2: Processed ${allCitations.length} citations, found ${commonlyCoCited.length} referenced_by_1st_degree stubs.`);
}

// --- 2nd DEGREE CITATIONS ---
export async function fetchSecondDegreeCitations(getState: Function, utils: UtilityFunctions & { updateAndPostProgress: Function }, progressWeights: { FETCH_SECOND_DEGREE: number }) {
  console.log('[Worker] Phase C, Step 8: Fetching 2nd degree citations.');
  // --- FIX: Assert the return type of getState() to ensure type safety. ---
  const { papers, paperRelationships, externalIdIndex } = getState() as GraphState;

  const firstDegreePaperUids = paperRelationships
    .filter((r: PaperRelationship) => r.tag === '1st_degree')
    .map((r: PaperRelationship) => r.source_short_uid);

  const firstDegreePapers = firstDegreePaperUids.map((uid: string) => papers[uid]).filter(Boolean);
  
  if (firstDegreePapers.length === 0) return;

  const reverseIndex: Record<string, string> = {};
  for (const [key, value] of Object.entries(externalIdIndex)) {
    if (key.startsWith('openalex:')) {
      const openAlexId = key.substring('openalex:'.length);
      reverseIndex[value] = openAlexId;
    }
  }

  const totalCalls = Math.ceil(firstDegreePapers.length / API_BATCH_SIZE);
  const progressPerCall = progressWeights.FETCH_SECOND_DEGREE / totalCalls;
  let callsMade = 0;

  const chunks = chunkArray(firstDegreePapers, API_BATCH_SIZE);

  for (const chunk of chunks) {
    const workIds = chunk
      .map((p: Paper) => reverseIndex[p.short_uid])
      .filter(Boolean);

    if (workIds.length === 0) continue;

    const response = await openAlexService.fetchCitationsForMultiplePapers(workIds);
    const allCitations = response.results;

    for (const citation of allCitations) {
      const { papers, authors, institutions, authorships } = getState();
      const citationUid = await processOpenAlexPaper(citation, true, papers, authors, institutions, authorships, utils);
      
      utils.postMessage('graph/addRelationship', {
        relationship: {
          source_short_uid: citationUid,
          target_short_uid: getState().masterPaperUid,
          relationship_type: 'cites',
          tag: '2nd_degree'
        }
      });
    }
    callsMade++;
    utils.updateAndPostProgress(progressPerCall, `Fetching second-degree citations... (${callsMade}/${totalCalls})`);
  }
  const secondDegreeRelationships = getState().paperRelationships.filter((r: PaperRelationship) => r.tag === '2nd_degree');
  console.log(`[Worker] Found ${secondDegreeRelationships.length} 2nd degree citations.`);
}

// --- HYDRATE STUB PAPERS ---
export async function hydrateStubPapers(getState: Function, utils: UtilityFunctions & { updateAndPostProgress: Function }, progressWeights: { HYDRATE_STUBS: number }) {
  console.log('[Worker] Phase C, Step 9: Hydrating stub papers.');
  // --- FIX: Assert the return type of getState() to ensure type safety. ---
  const { papers, externalIdIndex } = getState() as GraphState;
  const stubPapers = Object.values(papers).filter((p: Paper) => p.is_stub);
  
  if (stubPapers.length === 0) return;

  const reverseIndex: Record<string, string> = {};
  for (const [key, value] of Object.entries(externalIdIndex)) {
    if (key.startsWith('openalex:')) {
      const openAlexId = key.substring('openalex:'.length);
      reverseIndex[value] = openAlexId;
    }
  }

  const totalCalls = Math.ceil(stubPapers.length / API_BATCH_SIZE);
  const progressPerCall = progressWeights.HYDRATE_STUBS / totalCalls;
  let callsMade = 0;

  const chunks = chunkArray(stubPapers, API_BATCH_SIZE);

  for (const chunk of chunks) {
    const workIds = chunk
      .map((p: Paper) => reverseIndex[p.short_uid])
      .filter(Boolean);

    if (workIds.length === 0) continue;

    const response = await openAlexService.fetchMultiplePapers(workIds);
    const hydratedPapers = response.results;

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
export async function hydrateMasterPaper(getState: Function, utils: UtilityFunctions) {
  console.log('[Worker] Phase B, Step 4: Hydrating Master Paper from OpenAlex.');
  const { masterPaperUid, papers } = getState();
  if (!masterPaperUid || !papers[masterPaperUid] || !papers[masterPaperUid].is_stub) {
    return;
  }

  const masterPaperData = await openAlexService.fetchPaperDetails(masterPaperUid);

  if (masterPaperData) {
    const { papers, authors, institutions, authorships } = getState();
    await processOpenAlexPaper(masterPaperData, false, papers, authors, institutions, authorships, utils);
    console.log('[Worker] Phase B, Step 4: Master Paper hydration complete.');
  }
}