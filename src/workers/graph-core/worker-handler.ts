
// src/workers/graph-core/worker-handler.ts

import { processOpenAlexPaper } from './entity-processors';
import { fetchFirstDegreeCitations, fetchSecondDegreeCitations, hydrateStubPapers, hydrateMasterPaper } from './relationship-builder';
import { enrichMasterPaperWithSemanticScholar } from './semantic-scholar';
import { performAuthorReconciliation } from './author-reconciliation';
import { getUtilityFunctions } from './utils';
import { getState, resetState, setMasterPaperUid, setStubCreationThreshold, setState } from './state';
import { normalizeOpenAlexId } from '@/services/openAlex-util';
import type { WorkerMessage } from './types';
// *** THIS IS THE PATH FIX: Using the '@/' alias from tsconfig.json ***
import { PHASE_A_B_WEIGHTS, PHASE_C_WEIGHTS } from '@/config/progress-weights';

// --- BATCHING LOGIC (Unchanged) ---
let messageQueue: WorkerMessage[] = [];
let batchIntervalId: ReturnType<typeof setInterval> | null = null;
const BATCHABLE_TYPES = ['graph/reset', 'graph/addPaper', 'graph/addAuthor', 'graph/addInstitution', 'graph/addAuthorship', 'graph/addRelationship', 'graph/setExternalId', 'papers/updateOne', 'graph/addNodes', 'graph/applyAuthorMerge'];
function flushQueue() { if (messageQueue.length > 0) { self.postMessage(messageQueue); messageQueue = []; } }
function postMessageWithBatching(type: string, payload: any) { if (BATCHABLE_TYPES.includes(type)) { messageQueue.push({ type, payload }); } else { self.postMessage({ type, payload }); } }
function startBatching() { if (batchIntervalId === null) { batchIntervalId = setInterval(flushQueue, 250); } }
function stopBatching() { if (batchIntervalId !== null) { clearInterval(batchIntervalId); batchIntervalId = null; } flushQueue(); }
// --- BATCHING LOGIC END ---

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
            if (payload) {
              const currentState = getState();
              const translatedState = {
                ...payload,
                paperRelationships: payload.paper_relationships || [],
                masterPaperUid: currentState.masterPaperUid,
                stubCreationThreshold: currentState.stubCreationThreshold,
              };
              delete (translatedState as any).paper_relationships;
              setState(translatedState);
            }
            
            utils.postMessage('app_status/update', { state: 'extending' });
            
            let overallProgress = PHASE_A_B_WEIGHTS.COMPLETE;
            const updateAndPostProgress = (stepProgress: number, message: string) => {
              overallProgress += stepProgress;
              utils.postMessage('progress/update', { progress: Math.min(overallProgress, 99), message });
            };

            const progressAwareUtils = { ...utils, updateAndPostProgress };

            await fetchSecondDegreeCitations(getState, progressAwareUtils);
            await hydrateStubPapers(getState, progressAwareUtils);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('progress/update', { progress: 100, message: 'Analysis complete!' });
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