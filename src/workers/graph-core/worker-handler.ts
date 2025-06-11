
// Main worker message handling
import { processOpenAlexPaper } from './entity-processors';
import { fetchFirstDegreeCitations, fetchSecondDegreeCitations, hydrateStubPapers, hydrateMasterPaper } from './relationship-builder';
import { enrichMasterPaperWithSemanticScholar } from './semantic-scholar';
import { performAuthorReconciliation } from './author-reconciliation';
import { getUtilityFunctions } from './utils';
import { getState, resetState, setMasterPaperUid, setStubCreationThreshold } from './state';
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
            
            // *** DIAGNOSTIC ***: Tag this instance of the index object with a unique ID.
            (state.externalIdIndex as any).debugId = 'RUN_' + Math.random().toString(36).substr(2, 9);
            console.log('[DEBUG] Created new state with Index ID:', (state.externalIdIndex as any).debugId);
            
            setStubCreationThreshold(payload.stub_creation_threshold || 3);
            const utils = getUtilityFunctions(state.externalIdIndex);
            
            utils.postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
            
            console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
            
            // Clean the master paper data to ensure normalized IDs
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
              state.authorships, 
              state.externalIdIndex, 
              utils.addToExternalIndex, 
              utils.findByExternalId
            );
            setMasterPaperUid(masterUid);
            console.log('[Worker] Phase A, Step 1: Master Paper processed.');
            
            if (cleanMasterPaper.id) {
              console.log('[Worker] Phase A, Step 2: Fetching and recording 1st-degree citations.');
              // use our relationship-builder which both fetches AND pushes paperRelationships
              await fetchFirstDegreeCitations(cleanMasterPaper.id, state, utils);              
              
              await enrichMasterPaperWithSemanticScholar(
                state.papers,
                state.externalIdIndex,
                state.masterPaperUid,
                utils.addToExternalIndex,
                getState,
                () => utils
              );
            }
            
            console.log('--- [Worker] Phase A Complete. Posting initial graph to main thread. ---');
            const finalState = getState();
            
            // *** DIAGNOSTIC ***: Check the ID at the end of Phase A.
            console.log('[DEBUG] State at end of Phase A - Index ID:', (finalState.externalIdIndex as any).debugId, 'Size:', Object.keys(finalState.externalIdIndex).length);
            
            utils.postMessage('graph/setState', {
              data: {
                papers: finalState.papers,
                authors: finalState.authors,
                institutions: finalState.institutions,
                authorships: finalState.authorships,
                paper_relationships: finalState.paperRelationships,
                external_id_index: finalState.externalIdIndex
              }
            });
            
            console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
            utils.postMessage('app_status/update', { state: 'enriching', message: null });
            
            await hydrateMasterPaper(getState(), utils);
            await performAuthorReconciliation(
              finalState.papers,
              finalState.authors,
              finalState.authorships,
              finalState.externalIdIndex,
              utils.addToExternalIndex,
              utils.postMessage
            );
            
            console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');

          } catch (error) {
            console.error('[Worker] A fatal error occurred during graph build:', error);
            const utils = getUtilityFunctions(getState().externalIdIndex);
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
            const stateForC = getState();
            
            // *** DIAGNOSTIC ***: Check the ID at the very start of Phase C.
            console.log('[DEBUG] State at start of Phase C - Index ID:', (stateForC.externalIdIndex as any).debugId, 'Size:', Object.keys(stateForC.externalIdIndex).length);

            const utils = getUtilityFunctions(stateForC.externalIdIndex);
            utils.postMessage('app_status/update', { state: 'extending', message: 'Extending network...' });
            
            await fetchSecondDegreeCitations(stateForC, utils);
            await hydrateStubPapers(stateForC, utils);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('app_status/update', { state: 'active', message: null });
          } catch (error) {
            console.error('[Worker] Error during graph extension:', error);
            const utils = getUtilityFunctions(getState().externalIdIndex);
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