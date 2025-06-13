
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

// A queue to hold messages before sending them in a batch.
let messageQueue: WorkerMessage[] = [];
let batchIntervalId: ReturnType<typeof setInterval> | null = null;

// These message types are safe to batch. Others (like status updates) should be sent immediately.
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

/**
 * Sends the current message queue to the main thread and clears it.
 */
function flushQueue() {
  if (messageQueue.length > 0) {
    // DIAGNOSTIC: Log the batch being sent from the worker.
    console.log(`[Worker] Flushing message queue with ${messageQueue.length} items.`);
    self.postMessage(messageQueue);
    messageQueue = [];
  }
}

/**
 * A replacement for the original postMessage utility.
 * It pushes batchable messages to a queue and sends non-batchable messages immediately.
 * @param type The message type.
 * @param payload The message payload.
 */
function postMessageWithBatching(type: string, payload: any) {
  if (BATCHABLE_TYPES.includes(type)) {
    messageQueue.push({ type, payload });
  } else {
    // Send important, non-batchable messages immediately.
    self.postMessage({ type, payload });
  }
}

/**
 * Starts the batching interval.
 */
function startBatching() {
  if (batchIntervalId === null) {
    batchIntervalId = setInterval(flushQueue, 250); // Flush every 250ms
  }
}

/**
 * Stops the batching interval and performs a final flush to send any remaining messages.
 */
function stopBatching() {
  if (batchIntervalId !== null) {
    clearInterval(batchIntervalId);
    batchIntervalId = null;
  }
  flushQueue(); // Final flush
}

// --- BATCHING LOGIC END ---


export function setupWorkerMessageHandler() {
  self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
      case 'graph/processMasterPaper':
        (async () => {
          // The new utils object uses our batching postMessage function.
          const utils = { postMessage: postMessageWithBatching };
          try {
            console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phase A. ---");
            resetState();
            startBatching();
            
            // --- STREAMING CHANGE: Tell the main thread to reset its state ---
            utils.postMessage('graph/reset', {});

            setStubCreationThreshold(payload.stub_creation_threshold || 3);
            
            utils.postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
            
            console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
            
            const cleanMasterPaper = {
              ...payload.paper,
              id: normalizeOpenAlexId(payload.paper.id)
            };
            
            const initialState = getState();
            const masterUid = await processOpenAlexPaper(
              cleanMasterPaper, 
              false, 
              initialState.papers, 
              initialState.authors, 
              initialState.institutions, 
              initialState.authorships,
              utils // Pass utils with batching down to enable streaming
            );
            setMasterPaperUid(masterUid);
            console.log('[Worker] Phase A, Step 1: Master Paper processed.');
            
            if (cleanMasterPaper.id) {
              await fetchFirstDegreeCitations(cleanMasterPaper.id, getState, utils);              
              
              await enrichMasterPaperWithSemanticScholar(getState, utils);
            }
            
            console.log('--- [Worker] Phase A Complete. All initial data has been streamed. ---');
            
            console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
            utils.postMessage('app_status/update', { state: 'enriching', message: null });
            
            await hydrateMasterPaper(getState, utils);
            await performAuthorReconciliation(getState, utils);
            
            console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');
            utils.postMessage('enrichment/complete', { status: 'success' });

          } catch (error) {
            console.error('[Worker] A fatal error occurred during graph build:', error);
            utils.postMessage('error/fatal', { 
              message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          } finally {
            // Ensure all messages are sent and the interval is cleaned up.
            stopBatching();
          }
        })();
        break;

      case 'graph/extend':
        console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
        
        (async () => {
          const utils = { postMessage: postMessageWithBatching };
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
            
            utils.postMessage('app_status/update', { state: 'extending', message: 'Extending network...' });
            
            await fetchSecondDegreeCitations(getState, utils);
            await hydrateStubPapers(getState, utils);

            console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
            utils.postMessage('app_status/update', { state: 'active', message: null });
          } catch (error) {
            console.error('[Worker] Error during graph extension:', error);
            utils.postMessage('error/fatal', { 
              message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          } finally {
            // Ensure all messages are sent and the interval is cleaned up.
            stopBatching();
          }
        })();
        break;
        
      default:
        console.warn('[Worker] Unknown message type:', type);
    }
  });
}