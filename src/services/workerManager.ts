
import { useKnowledgeGraphStore } from '../store/knowledge-graph-store';

interface WorkerMessage {
  type: string;
  payload: any;
}

// We'll process messages in chunks to keep the main thread responsive.
const BATCH_CHUNK_SIZE = 250; 

class WorkerManager {
  private worker: Worker | null = null;
  private store = useKnowledgeGraphStore;
  
  private messageQueue: WorkerMessage[] = [];
  private isUpdateScheduled = false;

  initialize() {
    if (this.worker) {
      this.worker.terminate();
    }
  
    this.worker = new Worker(
      new URL('../workers/enhanced-graph-worker.ts', import.meta.url),
      { type: 'module' }
    );
  
    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
    this.worker.addEventListener('error', this.handleWorkerError.bind(this));
  }

  // This function processes the queue in small, manageable chunks.
  private processQueue() {
    // Correctly reset the scheduling flag at the beginning of the processing cycle.
    this.isUpdateScheduled = false;

    if (this.messageQueue.length === 0) {
      return;
    }

    // Take a small chunk from the front of the queue.
    const chunk = this.messageQueue.splice(0, BATCH_CHUNK_SIZE);

    // Process the chunk by sending it to the store.
    this.store.getState().applyMessageBatch(chunk);

    // If there are still more items left in the queue, schedule the next chunk processing.
    if (this.messageQueue.length > 0) {
      this.scheduleUpdate();
    }
  }

  // This function ensures we only schedule one processing loop at a time.
  private scheduleUpdate() {
    if (!this.isUpdateScheduled) {
      this.isUpdateScheduled = true;
      requestAnimationFrame(this.processQueue.bind(this));
    }
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage | WorkerMessage[]>) {
    // DIAGNOSTIC: Log the type and size of the incoming message/batch.
    if (Array.isArray(event.data)) {
      console.log(`[WorkerManager] Received message batch of size ${event.data.length}.`);
    } else if (event.data.type) {
      // For single messages, log their type for clarity.
      if (!['progress/update'].includes(event.data.type)) { // Avoid overly noisy logs
        console.log(`[WorkerManager] Received single message of type: ${event.data.type}`);
      }
    }

    // The worker can send a single message or an array of batched messages.
    const messages = Array.isArray(event.data) ? event.data : [event.data];

    for (const message of messages) {
      const { type, payload } = message;

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

      if (BATCHABLE_TYPES.includes(type)) {
        this.messageQueue.push(message);
      } else {
        // Process non-batchable, low-frequency messages immediately.
        const storeActions = this.store.getState();
        switch (type) {
          case 'progress/update':
            storeActions.setAppStatus({ message: payload.message });
            break;

          case 'app_status/update':
            storeActions.setAppStatus({ state: payload.state, message: payload.message });
            break;
          
          case 'error/fatal':
            storeActions.setAppStatus({
              state: 'error',
              message: payload.message
            });
            break;

          case 'enrichment/complete':
            console.log('[WorkerManager] Phase B complete. Triggering Phase C (extendGraph).');
            this.extendGraph();
            break;

          case 'warning/nonCritical':
            console.warn('[Worker] Non-critical warning:', payload.message);
            break;

          default:
            console.warn(`[WorkerManager] Received unknown message type: ${type}`);
        }
      }
    }

    // After adding new messages (potentially a large batch), schedule an update.
    if (this.messageQueue.length > 0) {
      this.scheduleUpdate();
    }
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error('[WorkerManager] Worker error:', error);
    this.store.getState().setAppStatus({
      state: 'error',
      message: 'Worker encountered an error'
    });
  }

  processMasterPaper(paper: any, stubCreationThreshold = 3) {
    if (!this.worker) {
      this.initialize();
      if (!this.worker) {
          throw new Error('Worker initialization failed');
      }
    }

    // Reset the queue for a new analysis
    this.messageQueue = [];
    this.isUpdateScheduled = false;

    this.worker.postMessage({
      type: 'graph/processMasterPaper',
      payload: {
        paper,
        stub_creation_threshold: stubCreationThreshold
      }
    });
  }

  extendGraph() {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    const currentState = this.store.getState();
    this.worker.postMessage({
      type: 'graph/extend',
      payload: {
        papers: currentState.papers,
        authors: currentState.authors,
        institutions: currentState.institutions,
        authorships: currentState.authorships,
        paper_relationships: currentState.paper_relationships,
        external_id_index: currentState.external_id_index,
      }
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const workerManager = new WorkerManager();