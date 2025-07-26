
// src/workers/graph-core/worker-handler.ts

import { processOpenAlexPaper } from './entity-processors';
import { fetchFirstDegreeCitations, fetchSecondDegreeCitations, hydrateStubPapers, hydrateMasterPaper } from './relationship-builder';
import { enrichMasterPaperWithSemanticScholar } from './semantic-scholar';
import { performAuthorReconciliation } from './author-reconciliation';
import { getUtilityFunctions } from './utils';
import { getState, resetState, setMasterPaperUid, setStubCreationThreshold } from './state';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import type { WorkerMessage } from './types';
import { PHASE_A_B_WEIGHTS, PHASE_C_WEIGHTS } from '../../config/progress-weights';

let messageQueue: WorkerMessage[] = [];
let batchIntervalId: ReturnType<typeof setInterval> | null = null;
const BATCHABLE_TYPES = ['graph/reset', 'graph/addPaper', 'graph/addAuthor', 'graph/addInstitution', 'graph/addAuthorship', 'graph/addRelationship', 'graph/addRelationshipTag', 'graph/setExternalId', 'papers/updateOne', 'graph/addNodes', 'graph/applyAuthorMerge'];
function flushQueue() { if (messageQueue.length > 0) { self.postMessage(messageQueue); messageQueue = []; } }
function postMessageWithBatching(type: string, payload: any) { if (BATCHABLE_TYPES.includes(type)) { messageQueue.push({ type, payload }); } else { self.postMessage({ type, payload }); } }
function startBatching() { if (batchIntervalId === null) { batchIntervalId = setInterval(flushQueue, 250); } }
function stopBatching() { if (batchIntervalId !== null) { clearInterval(batchIntervalId); batchIntervalId = null; } flushQueue(); }

export function setupWorkerMessageHandler() {
  self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;
    const getEnhancedUtils = () => ({ ...getUtilityFunctions(), postMessage: postMessageWithBatching });

    switch (type) {
      case 'graph/processMasterPaper':
        (async () => {
          const utils = getEnhancedUtils();
          try {
            console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phases A & B. ---");
            resetState();
            startBatching();
            
            utils.postMessage('graph/reset', {});
            utils.postMessage('app_status/update', { state: 'loading' });
            utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.INITIALIZING, message: 'Initializing analysis...' });

            setStubCreationThreshold(payload.stub_creation_threshold || 3);
            
            const cleanMasterPaper = { ...payload.paper, id: normalizeOpenAlexId(payload.paper.id) };
            const initialState = getState();
            const masterUid = await processOpenAlexPaper(cleanMasterPaper, false, initialState.papers, initialState.authors, initialState.institutions, initialState.authorships, utils);
            setMasterPaperUid(masterUid);
            
            if (cleanMasterPaper.id) {
              utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.FETCH_FIRST_DEGREE, message: 'Fetching direct citations...' });
              await fetchFirstDegreeCitations(cleanMasterPaper.id, getState, utils);              
              
              utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.ENRICH_SEMANTIC_SCHOLAR, message: 'Enriching with external data...' });
              await enrichMasterPaperWithSemanticScholar(getState, utils);
            }
            
            utils.postMessage('app_status/update', { state: 'enriching' });
            utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.HYDRATE_MASTER_PAPER, message: 'Hydrating master paper details...' });
            await hydrateMasterPaper(getState, utils);

            utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.RECONCILE_AUTHORS, message: 'Reconciling authors...' });
            await performAuthorReconciliation(getState, utils);
            
            console.log('--- [Worker] Phases A & B Complete. ---');
            utils.postMessage('progress/update', { progress: PHASE_A_B_WEIGHTS.COMPLETE, message: 'Enrichment complete.' });
            utils.postMessage('enrichment/complete', { status: 'success' });

          } catch (error) {
            console.error('[Worker] A fatal error occurred during graph build:', error);
            utils.postMessage('error/fatal', { message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` });
          } finally {
            stopBatching();
          }
        })();
        break;

      case 'graph/extend':
        (async () => {
          const utils = getEnhancedUtils();
          try {
            console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
            startBatching();
            
            // FIX: The logic that accepted and merged a payload has been removed.
            // The worker now trusts its own internal state, which was established
            // during the initial 'graph/processMasterPaper' task. This makes the
            // worker truly stateful and preserves the masterPaperUid.

            utils.postMessage('app_status/update', { state: 'extending' });
            
            let overallProgress = PHASE_A_B_WEIGHTS.COMPLETE;
            let secondDegreeProgress = 0;
            let hydrateProgress = 0;
            
            const updateAndPostProgress = (stepProgress: number, message: string) => {
              // Update individual step progress first
              if (message.includes('second-degree') || message.includes('Fetching second-degree')) {
                secondDegreeProgress += stepProgress;
              } else if (message.includes('Hydrating') || message.includes('hydrating')) {
                hydrateProgress += stepProgress;
              }
              
              // Calculate Phase C progress (0-100%)
              const phaseCProgress = Math.min(
                ((secondDegreeProgress + hydrateProgress) / 
                 (PHASE_C_WEIGHTS.FETCH_SECOND_DEGREE + PHASE_C_WEIGHTS.HYDRATE_STUBS)) * 100,
                100
              );
              
              // Calculate overall progress for legacy purposes
              overallProgress += stepProgress;
              
              utils.postMessage('progress/update', { 
                progress: Math.min(overallProgress, 99), 
                phaseCProgress,
                message 
              });
            };

            const progressAwareUtils = { ...utils, updateAndPostProgress };

            await fetchSecondDegreeCitations(getState, progressAwareUtils, PHASE_C_WEIGHTS);
            await hydrateStubPapers(getState, progressAwareUtils, PHASE_C_WEIGHTS);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('progress/update', { progress: 100, phaseCProgress: 100, message: 'Analysis complete!' });
            utils.postMessage('app_status/update', { state: 'active', message: null });
          } catch (error) {
            console.error('[Worker] Error during graph extension:', error);
            utils.postMessage('error/fatal', { message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` });
          } finally {
            stopBatching();
          }
        })();
        break;
        
      default:
        console.warn('[Worker] Unknown message type:', type);
    }
  });
}