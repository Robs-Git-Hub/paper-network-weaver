
// src/workers/graph-core/author-reconciliation.ts

import { openAlexService } from '../../services/openAlex';
import { calculateMatchScore } from '../../utils/data-transformers';
import type { Author, Paper, Authorship, GraphState, UtilityFunctions } from './types';

export async function performAuthorReconciliation(
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase B, Steps 5 & 6: Starting Author Reconciliation.');
  utils.postMessage('progress/update', { message: 'Reconciling authors...' });
  
  const { papers, authors, authorships, externalIdIndex } = getGraphState();
  
  const stubAuthors = Object.values(authors).filter(author => author.is_stub);
  
  if (stubAuthors.length === 0) {
    console.log('[Worker] Phase B, Steps 5 & 6: No stub authors to reconcile. Finishing enrichment.');
    utils.postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
  const reconciliationMap = new Map<string, any[]>();
  
  for (const stubAuthor of stubAuthors) {
    const stubAuthorships = Object.values(authorships).filter(
      auth => auth.author_short_uid === stubAuthor.short_uid
    );
    
    for (const authorship of stubAuthorships) {
      const paper = papers[authorship.paper_short_uid];
      if (!paper) continue;
      
      const doiKey = Object.keys(externalIdIndex).find(key => 
        key.startsWith('doi:') && externalIdIndex[key] === paper.short_uid
      );
      
      if (doiKey) {
        const doi = doiKey.split('doi:')[1];
        if (!reconciliationMap.has(doi)) {
          reconciliationMap.set(doi, []);
        }
        reconciliationMap.get(doi)!.push({
          stubAuthor,
          authorship,
          paper
        });
      }
    }
  }
  
  if (reconciliationMap.size === 0) {
    console.log('[Worker] Phase B, Steps 5 & 6: No DOIs found for stub authors. Finishing enrichment.');
    utils.postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
  const dois = Array.from(reconciliationMap.keys());
  const successfulMatches: Array<{
    stubAuthor: Author;
    candidateAuthor: any;
    score: number;
    paper: Paper;
  }> = [];
  
  try {
    // --- THIS IS THE FIX ---
    // We are now calling the new, dedicated function for fetching by DOI.
    const openAlexResponse = await openAlexService.fetchMultiplePapersByDoi(
      dois, 
      'AUTHOR_RECONCILIATION'
    );
    
    for (const paperData of openAlexResponse.results) {
      const paperDoi = paperData.doi?.replace('https://doi.org/', '') || '';
      if (!paperDoi || !reconciliationMap.has(paperDoi)) continue;
      
      const stubInfo = reconciliationMap.get(paperDoi)!;
      
      for (const stub of stubInfo) {
        for (const openAlexAuthorship of paperData.authorships || []) {
          const score = calculateMatchScore(
            stub.stubAuthor.clean_name,
            openAlexAuthorship.author.display_name
          );
          
          if (score > 0.85) {
            successfulMatches.push({
              stubAuthor: stub.stubAuthor,
              candidateAuthor: openAlexAuthorship.author,
              score,
              paper: stub.paper
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Worker] Author reconciliation API call failed:', error);
  }
  
  if (successfulMatches.length > 0) {
    const mergePlan = new Map<string, {
      winnerUid: string;
      loserUids: string[];
      canonicalData: any;
    }>();
    
    for (const match of successfulMatches) {
      const openAlexId = match.candidateAuthor.id;
      
      if (!mergePlan.has(openAlexId)) {
        mergePlan.set(openAlexId, {
          winnerUid: match.stubAuthor.short_uid,
          loserUids: [],
          canonicalData: match.candidateAuthor
        });
      } else {
        const plan = mergePlan.get(openAlexId)!;
        plan.loserUids.push(match.stubAuthor.short_uid);
      }
    }
    
    const authorUpdates: Array<{ id: string; changes: Partial<Author> }> = [];
    const authorshipUpdates: Array<{ id: string; changes: Partial<Authorship> }> = [];
    const authorDeletions: string[] = [];
    
    for (const [openAlexId, plan] of mergePlan) {
      authorUpdates.push({
        id: plan.winnerUid,
        changes: {
          clean_name: plan.canonicalData.display_name,
          orcid: plan.canonicalData.orcid || null,
          is_stub: false
        }
      });
      
      utils.addToExternalIndex('openalex_author', openAlexId, plan.winnerUid);
      
      for (const loserUid of plan.loserUids) {
        const loserAuthorships = Object.entries(getGraphState().authorships).filter(
          ([_, auth]) => auth.author_short_uid === loserUid
        );
        
        for (const [key, authorship] of loserAuthorships) {
          authorshipUpdates.push({
            id: key,
            changes: {
              author_short_uid: plan.winnerUid
            }
          });
        }
        
        authorDeletions.push(loserUid);
      }
    }
    
    utils.postMessage('graph/applyAuthorMerge', {
      updates: {
        authors: authorUpdates,
        authorships: authorshipUpdates
      },
      deletions: {
        authors: authorDeletions
      }
    });
    
    console.log(`[Worker] Phase B, Steps 5 & 6: Author reconciliation complete. Merged ${authorDeletions.length} stub authors into ${mergePlan.size} canonical authors.`);
  } else {
    console.log('[Worker] Phase B, Steps 5 & 6: No high-confidence author matches found.');
  }
  
  utils.postMessage('app_status/update', { state: 'active', message: null });
}