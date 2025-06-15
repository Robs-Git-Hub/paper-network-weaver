
// src/workers/graph-core/worker-handler.ts

import { processOpenAlexPaper } from './entity-processors';
import { fetchFirstDegreeCitations, fetchSecondDegreeCitations, hydrateStubPapers, hydrateMasterPaper } from './relationship-builder';
import { enrichMasterPaperWithSemanticScholar } from './semantic-scholar';
import { performAuthorReconciliation } from './author-reconciliation';
import { getUtilityFunctions } from './utils';
import { getState, resetState, setMasterPaperUid, setStubCreationThreshold, setState } from './state';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import type { WorkerMessage } from './types';

// --- BATCHING LOGIC START ---

let messageQueue: WorkerMessage[] = [];
let batchIntervalId: ReturnType<typeof setInterval> | null = null;

const BATCHABLE_TYPES = [
  'graph/reset',
  'graph/addPaper',
  'graph/addAuthor',
  'graph/addInstitution',
  'graph/addAuthorship',
  'graph/addRelationship',
  'graph/setExternalId',
  'papers/updateOne',
  'graph/addNodes',
  'graph/applyAuthorMerge',
];

function flushQueue() {
  if (messageQueue.length > 0) {
    console.log(`[Worker] Flushing message queue with ${messageQueue.length} items.`);
    self.postMessage(messageQueue);
    messageQueue = [];
  }
}

function postMessageWithBatching(type: string, payload: any) {
  if (BATCHABLE_TYPES.includes(type)) {
    messageQueue.push({ type, payload });
  } else {
    // Send important, non-batchable messages immediately.
    self.postMessage({ type, payload });
  }
}

function startBatching() {
  if (batchIntervalId === null) {
    batchIntervalId = setInterval(flushQueue, 250);
  }
}

function stopBatching() {
  if (batchIntervalId !== null) {
    clearInterval(batchIntervalId);
    batchIntervalId = null;
  }
  flushQueue(); // Final flush to send any remaining messages.
}

// --- BATCHING LOGIC END ---

export function setupWorkerMessageHandler() {
  self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    const getEnhancedUtils = () => {
      const originalUtils = getUtilityFunctions();
      return {
        ...originalUtils,
        postMessage: postMessageWithBatching,
      };
    };

    switch (type) {
      case 'graph/processMasterPaper':
        (async () => {
          const utils = getEnhancedUtils();
          try {
            console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phase A. ---");
            resetState();
            startBatching();
            
            utils.postMessage('graph/reset', {});
            utils.postMessage('app_status/update', { state: 'loading' });
            utils.postMessage('progress/update', { progress: 0, message: 'Initializing analysis...' });

            setStubCreationThreshold(payload.stub_creation_threshold || 3);
            
            console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
            const cleanMasterPaper = { ...payload.paper, id: normalizeOpenAlexId(payload.paper.id) };
            const initialState = getState();
            const masterUid = await processOpenAlexPaper(cleanMasterPaper, false, initialState.papers, initialState.authors, initialState.institutions, initialState.authorships, utils);
            setMasterPaperUid(masterUid);
            console.log('[Worker] Phase A, Step 1: Master Paper processed.');
            
            if (cleanMasterPaper.id) {
              utils.postMessage('progress/update', { progress: 10, message: 'Fetching direct citations...' });
              await fetchFirstDegreeCitations(cleanMasterPaper.id, getState, utils);              
              
              utils.postMessage('progress/update', { progress: 40, message: 'Enriching with external data...' });
              await enrichMasterPaperWithSemanticScholar(getState, utils);
            }
            
            console.log('--- [Worker] Phase A Complete. All initial data has been streamed. ---');
            console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
            utils.postMessage('app_status/update', { state: 'enriching' });
            
            utils.postMessage('progress/update', { progress: 50, message: 'Hydrating master paper details...' });
            await hydrateMasterPaper(getState, utils);

            utils.postMessage('progress/update', { progress: 55, message: 'Reconciling authors...' });
            await performAuthorReconciliation(getState, utils);
            
            console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');
            utils.postMessage('progress/update', { progress: 70, message: 'Enrichment complete.' });
            utils.postMessage('enrichment/complete', { status: 'success' });

          } catch (error) {
            console.error('[Worker] A fatal error occurred during graph build:', error);
            utils.postMessage('error/fatal', { 
              message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          } finally {
            stopBatching();
          }
        })();
        break;

      case 'graph/extend':
        console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
        
        (async () => {
          const utils = getEnhancedUtils();
          try {
            startBatching();
            if (payload) {
              console.log('[Worker] Synchronizing and translating state from main thread.');
              const currentState = getState();
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
            
            utils.postMessage('app_status/update', { state: 'extending' });
            utils.postMessage('progress/update', { progress: 70, message: 'Fetching second-degree citations...' });
            await fetchSecondDegreeCitations(getState, utils);

            utils.postMessage('progress/update', { progress: 90, message: 'Hydrating related papers...' });
            await hydrateStubPapers(getState, utils);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('progress/update', { progress: 100, message: 'Analysis complete!' });
            utils.postMessage('app_status/update', { state: 'active', message: null });
          } catch (error) {
            console.error('[Worker] Error during graph extension:', error);
            utils.postMessage('error/fatal', { 
              message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
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