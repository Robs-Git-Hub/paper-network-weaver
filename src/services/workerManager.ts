
import { useKnowledgeGraphStore } from '../store/knowledge-graph-store';

interface WorkerMessage {
  type: string;
  payload: any;
}

class WorkerManager {
  private worker: Worker | null = null;
  private store = useKnowledgeGraphStore;

  // --- START: BATCHING MECHANISM ---
  private messageQueue: WorkerMessage[] = [];
  private isUpdateScheduled = false;
  // --- END: BATCHING MECHANISM ---

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

  private processQueue() {
    if (this.messageQueue.length === 0) {
      this.isUpdateScheduled = false;
      return;
    }

    const batch = this.messageQueue.slice(); // Create a copy of the queue for processing
    this.messageQueue = []; // Clear the main queue immediately for incoming messages

    // --- VERIFICATION STEP ---
    // Instead of calling the store, we will log the batch to verify our mechanism.
    // In the final implementation, this is where we'll call the store's batch update action.
    console.log(
      `%c[WorkerManager] VERIFICATION: Processing batch of ${batch.length} messages.`,
      'color: #4CAF50; font-weight: bold;'
    );
    // --- END VERIFICATION STEP ---

    this.isUpdateScheduled = false;

    // If more messages arrived while processing, schedule another update.
    if (this.messageQueue.length > 0) {
      this.scheduleUpdate();
    }
  }

  private scheduleUpdate() {
    if (!this.isUpdateScheduled) {
      this.isUpdateScheduled = true;
      requestAnimationFrame(this.processQueue.bind(this));
    }
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;
    const { type, payload } = message;
    
    // This log remains helpful to see the raw firehose of messages.
    console.log('[WorkerManager] Received message:', type, payload);

    // We only batch the high-frequency data messages. Control messages are processed immediately.
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
      this.scheduleUpdate();
    } else {
      // --- Process non-batchable, low-frequency messages immediately ---
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
          // When Phase B is confirmed complete, we trigger Phase C.
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