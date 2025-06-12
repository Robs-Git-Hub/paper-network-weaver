
// src/workers/graph-core/semantic-scholar.ts

import { semanticScholarService } from '../../services/semanticScholar';
import { processSemanticScholarRelationships } from './relationship-builder';
import type { Paper, GraphState, UtilityFunctions } from './types';

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
      // Stream the update for the master paper
      utils.postMessage('papers/updateOne', { id: masterPaperUid, changes: updates });
    }
    
    // --- STREAMING CHANGE: Stream new external IDs immediately ---
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