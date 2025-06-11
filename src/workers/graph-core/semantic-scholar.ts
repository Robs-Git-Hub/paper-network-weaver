
// Semantic Scholar integration
import { semanticScholarService } from '../../services/semanticScholar';
import { processSemanticScholarRelationships } from './relationship-builder';
import type { Paper, GraphState } from './types'; // Added GraphState import

// --- REFACTORED SIGNATURE ---
// This function now accepts getState directly, making it robust and self-sufficient.
export async function enrichMasterPaperWithSemanticScholar(
  getGraphState: () => GraphState,
  addToExternalIndex: (idType: string, idValue: string, entityUid: string) => void,
  getUtilityFunctions: () => any
) {
  // --- FIX: Get fresh state at the beginning of execution ---
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
    
    // Get a fresh reference to the master paper before updating
    const currentMasterPaper = getGraphState().papers[masterPaperUid];
    
    const updates: Partial<Paper> = {};
    if (!currentMasterPaper.best_oa_url && ssData.openAccessPdf?.url) {
      updates.best_oa_url = ssData.openAccessPdf.url;
    }
    
    if (Object.keys(updates).length > 0) {
      // Mutate the state directly using the fresh reference
      getGraphState().papers[masterPaperUid] = { ...currentMasterPaper, ...updates };
    }
    
    if (ssData.paperId) {
      addToExternalIndex('ss', ssData.paperId, masterPaperUid);
    }
    if (ssData.corpusId) {
      addToExternalIndex('corpusId', ssData.corpusId.toString(), masterPaperUid);
    }
    
    // --- FIX: Pass the getState function, not a stale state object ---
    await processSemanticScholarRelationships(ssData, getGraphState, getUtilityFunctions());
    
  } catch (error) {
    console.warn('[Worker] Semantic Scholar enrichment failed:', error);
  }
}