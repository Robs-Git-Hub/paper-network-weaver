
// Main worker message handling
import { processOpenAlexPaper } from './entity-processors';
import { fetchFirstDegreeCitations, fetchSecondDegreeCitations, hydrateStubPapers, hydrateMasterPaper } from './relationship-builder';
import { enrichMasterPaperWithSemanticScholar } from './semantic-scholar';
import { performAuthorReconciliation } from './author-reconciliation';
import { getUtilityFunctions, addToExternalIndex } from './utils';
import { getState, resetState, setMasterPaperUid, setStubCreationThreshold, setState } from './state';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import type { WorkerMessage } from './types';

export function setupWorkerMessageHandler() {
  self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
      case 'graph/processMasterPaper':
        (async () => {
          try {
            console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phase A. ---");
            resetState();
            
            const state = getState();
            const utils = getUtilityFunctions();
            
            setStubCreationThreshold(payload.stub_creation_threshold || 3);
            
            utils.postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
            
            console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
            
            const cleanMasterPaper = {
              ...payload.paper,
              id: normalizeOpenAlexId(payload.paper.id)
            };
            
            const masterUid = await processOpenAlexPaper(
              cleanMasterPaper, 
              false, 
              state.papers, 
              state.authors, 
              state.institutions, 
              state.authorships
            );
            setMasterPaperUid(masterUid);
            console.log('[Worker] Phase A, Step 1: Master Paper processed.');
            
            if (cleanMasterPaper.id) {
              // --- HYPOTHESIS TEST LOGS ---
              console.log('[Hypothesis-Test | Handler] The `state` object we are about to pass has masterPaperUid:', state.masterPaperUid);
              console.log('[Hypothesis-Test | Handler] A fresh call to getState() NOW has masterPaperUid:', getState().masterPaperUid);
              // --- END TEST LOGS ---

              await fetchFirstDegreeCitations(cleanMasterPaper.id, state, utils);              
              
              await enrichMasterPaperWithSemanticScholar(
                state.papers,
                state.externalIdIndex,
                state.masterPaperUid,
                addToExternalIndex,
                getState,
                () => utils
              );
            }
            
            console.log('--- [Worker] Phase A Complete. Posting initial graph to main thread. ---');
            
            // --- DEBUGGING LOG ADDED ---
            console.log(
              `[Worker-Trace | Step 1] PRE-POSTMESSAGE: state.paperRelationships has ${state.paperRelationships.length} items.`,
              JSON.stringify(state.paperRelationships)
            );
            
            // Translate worker's camelCase to main thread's snake_case for posting
            utils.postMessage('graph/setState', {
              data: {
                papers: state.papers,
                authors: state.authors,
                institutions: state.institutions,
                authorships: state.authorships,
                paper_relationships: state.paperRelationships,
                external_id_index: state.externalIdIndex
              }
            });
            
            console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
            utils.postMessage('app_status/update', { state: 'enriching', message: null });
            
            await hydrateMasterPaper(state, utils);
            await performAuthorReconciliation(
              state.papers,
              state.authors,
              state.authorships,
              state.externalIdIndex,
              addToExternalIndex,
              utils.postMessage
            );
            
            console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');
            utils.postMessage('enrichment/complete', { status: 'success' });

          } catch (error) {
            console.error('[Worker] A fatal error occurred during graph build:', error);
            const utils = getUtilityFunctions();
            utils.postMessage('error/fatal', { 
              message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
        })();
        break;

      case 'graph/extend':
        console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
        
        (async () => {
          try {
            if (payload) {
              // --- DEBUGGING LOG ADDED ---
              console.log(
                `[Worker-Trace | Step 5] PHASE-C-RECEIVED: payload.paper_relationships has ${payload.paper_relationships.length} items.`
              );

              console.log('[Worker] Synchronizing and translating state from main thread.');
              const currentState = getState();
              
              // Translate main thread's snake_case payload to worker's camelCase state
              const translatedState = {
                papers: payload.papers,
                authors: payload.authors,
                institutions: payload.institutions,
                authorships: payload.authorships,
                paperRelationships: payload.paper_relationships,
                externalIdIndex: payload.external_id_index,
                masterPaperUid: currentState.masterPaperUid,
                stubCreationThreshold: currentState.stubCreationThreshold
              };

              setState(translatedState);
            }

            const state = getState();
            const utils = getUtilityFunctions();
            
            utils.postMessage('app_status/update', { state: 'extending', message: 'Extending network...' });
            
            await fetchSecondDegreeCitations(state, utils);
            await hydrateStubPapers(state, utils);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('app_status/update', { state: 'active', message: null });
          } catch (error) {
            console.error('[Worker] Error during graph extension:', error);
            const utils = getUtilityFunctions();
            utils.postMessage('error/fatal', { 
              message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
        })();
        break;
        
      default:
        console.warn('[Worker] Unknown message type:', type);
    }
  });
}