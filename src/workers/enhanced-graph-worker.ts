
import { semanticScholarService } from '../services/semanticScholar';
import { fetchWithRetry } from '../utils/api-helpers';
import { reconstructAbstract, extractKeywords, normalizeDoi, calculateMatchScore, generateShortUid } from '../utils/data-transformers';
import { processOpenAlexPaper, processOpenAlexAuthor, processOpenAlexInstitution } from './graph-core/entity-processors';
import { 
  fetchFirstDegreeCitations, 
  fetchSecondDegreeCitations, 
  hydrateStubPapers, 
  hydrateMasterPaper, 
  processSemanticScholarRelationships 
} from './graph-core/relationship-builder';
import type { WorkerMessage, Paper, Author, Institution, Authorship, PaperRelationship } from './graph-core/types';

// Worker state
let papers: Record<string, Paper> = {};
let authors: Record<string, Author> = {};
let institutions: Record<string, Institution> = {};
let authorships: Record<string, Authorship> = {};
let paperRelationships: PaperRelationship[] = [];
let externalIdIndex: Record<string, string> = {};

let masterPaperUid: string | null = null;
let stubCreationThreshold = 3;

// Utility functions
function postMessage(type: string, payload: any) {
  self.postMessage({ type, payload });
}

function addToExternalIndex(idType: string, idValue: string, entityUid: string) {
  const key = `${idType}:${idValue}`;
  externalIdIndex[key] = entityUid;
}

function findByExternalId(idType: string, idValue: string): string | null {
  const key = `${idType}:${idValue}`;
  return externalIdIndex[key] || null;
}

// Helper to create state and utils objects
function getGraphState() {
  return {
    papers,
    authors,
    institutions,
    authorships,
    paperRelationships,
    externalIdIndex,
    masterPaperUid,
    stubCreationThreshold
  };
}

function getUtilityFunctions() {
  return {
    postMessage,
    addToExternalIndex,
    findByExternalId
  };
}

// Phase A Implementation
async function processOpenAlexPaperWrapper(paperData: any, isStub = false): Promise<string> {
  return processOpenAlexPaper(
    paperData, 
    isStub, 
    papers, 
    authors, 
    institutions, 
    authorships, 
    externalIdIndex, 
    addToExternalIndex, 
    findByExternalId
  );
}

async function processOpenAlexAuthorWrapper(authorData: any, isStub = false): Promise<string> {
  return processOpenAlexAuthor(
    authorData, 
    isStub, 
    authors, 
    institutions, 
    authorships, 
    externalIdIndex, 
    addToExternalIndex, 
    findByExternalId
  );
}

async function processOpenAlexInstitutionWrapper(instData: any): Promise<string> {
  return processOpenAlexInstitution(
    instData, 
    institutions, 
    externalIdIndex, 
    addToExternalIndex, 
    findByExternalId
  );
}

async function enrichMasterPaperWithSemanticScholar() {
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

async function performAuthorReconciliation() {
  console.log('[Worker] Phase B, Steps 5 & 6: Starting Author Reconciliation.');
  postMessage('progress/update', { message: 'Reconciling authors...' });
  
  const stubAuthors = Object.values(authors).filter(author => author.is_stub);
  
  if (stubAuthors.length === 0) {
    console.log('[Worker] Phase B, Steps 5 & 6: No stub authors to reconcile. Finishing enrichment.');
    postMessage('app_status/update', { state: 'active', message: null });
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
    postMessage('app_status/update', { state: 'active', message: null });
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
    const url = `https://api.openalex.org/works?filter=doi:${dois.join('|')}&select=id,title,authorships`;
    const response = await fetchWithRetry(url);
    
    if (response.ok) {
      const data = await response.json();
      
      for (const paperData of data.results) {
        const paperDoi = normalizeDoi(paperData.doi);
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
      
      addToExternalIndex('openalex_author', openAlexId, plan.winnerUid);
      
      for (const loserUid of plan.loserUids) {
        const loserAuthorships = Object.entries(authorships).filter(
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
    
    postMessage('graph/applyAuthorMerge', {
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
  
  postMessage('app_status/update', { state: 'active', message: null });
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'graph/processMasterPaper':
      (async () => {
        try {
          console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phase A. ---");
          papers = {};
          authors = {};
          institutions = {};
          authorships = {};
          paperRelationships = [];
          externalIdIndex = {};
          
          stubCreationThreshold = payload.stub_creation_threshold || 3;
          
          postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
          
          console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
          masterPaperUid = await processOpenAlexPaperWrapper(payload.paper, false);
          console.log('[Worker] Phase A, Step 1: Master Paper processed.');
          
          if (payload.paper.id) {
            await fetchFirstDegreeCitations(payload.paper.id, getGraphState(), getUtilityFunctions());
            await enrichMasterPaperWithSemanticScholar();
          }
          
          console.log('--- [Worker] Phase A Complete. Posting initial graph to main thread. ---');
          postMessage('graph/setState', {
            data: {
              papers,
              authors,
              institutions,
              authorships,
              paper_relationships: paperRelationships,
              external_id_index: externalIdIndex
            }
          });
          
          console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
          postMessage('app_status/update', { state: 'enriching', message: null });
          
          await hydrateMasterPaper(getGraphState(), getUtilityFunctions());
          await performAuthorReconciliation();
          
          console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');

        } catch (error) {
          console.error('[Worker] A fatal error occurred during graph build:', error);
          postMessage('error/fatal', { 
            message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      })();
      break;

    case 'graph/extend':
      console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
      
      (async () => {
        try {
          postMessage('app_status/update', { state: 'extending', message: 'Extending network...' });
          
          // Fetch 2nd degree citations (Work Plan Step 8)
          await fetchSecondDegreeCitations(getGraphState(), getUtilityFunctions());

          // Hydrate existing stubs (Work Plan Step 9)
          await hydrateStubPapers(getGraphState(), getUtilityFunctions());

          console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
          postMessage('app_status/update', { state: 'active', message: null });
        } catch (error) {
          console.error('[Worker] Error during graph extension:', error);
          postMessage('error/fatal', { 
            message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      })();
      break;
      
    default:
      console.warn('[Worker] Unknown message type:', type);
  }
});

export {};
