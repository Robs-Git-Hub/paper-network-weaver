
// Semantic Scholar integration
import { semanticScholarService } from '../../services/semanticScholar';
import { processSemanticScholarRelationships } from './relationship-builder';
import type { Paper } from './types';

export async function enrichMasterPaperWithSemanticScholar(
  papers: Record<string, Paper>,
  externalIdIndex: Record<string, string>,
  masterPaperUid: string | null,
  addToExternalIndex: (idType: string, idValue: string, entityUid: string) => void,
  getGraphState: () => any,
  getUtilityFunctions: () => any
) {
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
    
    const updates: Partial<Paper> = {};
    if (!masterPaper.best_oa_url && ssData.openAccessPdf?.url) {
      updates.best_oa_url = ssData.openAccessPdf.url;
    }
    
    if (Object.keys(updates).length > 0) {
      papers[masterPaperUid] = { ...masterPaper, ...updates };
    }
    
    if (ssData.paperId) {
      addToExternalIndex('ss', ssData.paperId, masterPaperUid);
    }
    if (ssData.corpusId) {
      addToExternalIndex('corpusId', ssData.corpusId.toString(), masterPaperUid);
    }
    
    await processSemanticScholarRelationships(ssData, getGraphState(), getUtilityFunctions());
    
  } catch (error) {
    console.warn('[Worker] Semantic Scholar enrichment failed:', error);
  }
}
