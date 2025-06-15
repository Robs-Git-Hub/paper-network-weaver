
// src/workers/graph-core/semantic-scholar.ts

import { semanticScholarService } from '../../services/semanticScholar';
import { processSemanticScholarPaper } from './entity-processors';
import type { Paper, GraphState, UtilityFunctions } from './types';

async function processSemanticScholarRelationships(
  ssData: any,
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  const { masterPaperUid } = getGraphState();
  if (!masterPaperUid) return;

  // Process papers that the master paper cites (references)
  if (ssData.references) {
    for (const reference of ssData.references) {
      if (!reference.paperId) continue;
      const refUid = await processSemanticScholarPaper(reference, utils);
      utils.postMessage('graph/addRelationship', {
        relationship: {
          source_short_uid: masterPaperUid,
          target_short_uid: refUid,
          relationship_type: 'cites',
        },
      });
    }
  }

  // Process papers that cite the master paper
  if (ssData.citations) {
    for (const citation of ssData.citations) {
      if (!citation.paperId) continue;
      const citationUid = await processSemanticScholarPaper(citation, utils);
      utils.postMessage('graph/addRelationship', {
        relationship: {
          source_short_uid: citationUid,
          target_short_uid: masterPaperUid,
          relationship_type: 'cites',
        },
      });
    }
  }
}

export async function enrichMasterPaperWithSemanticScholar(
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  const state = getGraphState();
  const { papers, externalIdIndex, masterPaperUid } = state;

  if (!masterPaperUid) return;
  
  const masterPaper = papers[masterPaperUid];
  if (!masterPaper) return;
  
  const doiKey = Object.keys(externalIdIndex).find(key => 
    key.startsWith('doi:') && externalIdIndex[key] === masterPaperUid
  );
  
  if (!doiKey) {
    console.warn('[Worker] Phase A, Step 3: Skipped Semantic Scholar enrichment, no DOI found for Master Paper.');
    return;
  }
  
  console.log('[Worker] Phase A, Step 3: Enriching with Semantic Scholar data.');
  const doi = doiKey.split('doi:')[1];
  try {
    const ssData = await semanticScholarService.fetchPaperDetails(doi);
    if (!ssData) return;
    
    const currentMasterPaper = getGraphState().papers[masterPaperUid];
    
    const updates: Partial<Paper> = {};
    if (!currentMasterPaper.best_oa_url && ssData.openAccessPdf?.url) {
      updates.best_oa_url = ssData.openAccessPdf.url;
    }
    
    if (Object.keys(updates).length > 0) {
      getGraphState().papers[masterPaperUid] = { ...currentMasterPaper, ...updates };
      utils.postMessage('papers/updateOne', { id: masterPaperUid, changes: updates });
    }
    
    if (ssData.paperId) {
      const key = `ss:${ssData.paperId}`;
      utils.addToExternalIndex('ss', ssData.paperId, masterPaperUid);
      utils.postMessage('graph/setExternalId', { key, uid: masterPaperUid });
    }
    if (ssData.corpusId) {
      const key = `corpusId:${ssData.corpusId.toString()}`;
      utils.addToExternalIndex('corpusId', ssData.corpusId.toString(), masterPaperUid);
      utils.postMessage('graph/setExternalId', { key, uid: masterPaperUid });
    }
    
    await processSemanticScholarRelationships(ssData, getGraphState, utils);
    
  } catch (error) {
    console.warn('[Worker] Semantic Scholar enrichment failed:', error);
  }
}