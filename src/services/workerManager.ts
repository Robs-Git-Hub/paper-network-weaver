
import { useKnowledgeGraphStore } from '../store/knowledge-graph-store';

interface WorkerMessage {
  type: string;
  payload: any;
}

const BATCH_CHUNK_SIZE = 250; // Process 250 messages at a time

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

  // The processQueue function is now a chunk processor.
  private processQueue() {
    // If the queue is empty, we're done.
    if (this.messageQueue.length === 0) {
      this.isUpdateScheduled = false;
      return;
    }

    // Take a small chunk from the front of the queue.
    const chunk = this.messageQueue.splice(0, BATCH_CHUNK_SIZE);

    // --- VERIFICATION STEP ---
    // Log the chunk we are about to process, and how many items are left.
    console.log(
      `%c[WorkerManager] VERIFICATION: Processing chunk of ${chunk.length}. Queue length: ${this.messageQueue.length}`,
      'color: #FFA500; font-weight: bold;'
    );
    // In the final implementation, we will call the store here:
    // this.store.getState().applyMessageBatch(chunk);
    // --- END VERIFICATION STEP ---

    // If there are more items in the queue, schedule the next chunk.
    if (this.messageQueue.length > 0) {
      this.scheduleUpdate();
    } else {
      this.isUpdateScheduled = false;
    }
  }

  // This function just kicks off the queue processing loop.
  private scheduleUpdate() {
    if (!this.isUpdateScheduled) {
      this.isUpdateScheduled = true;
      requestAnimationFrame(this.processQueue.bind(this));
    }
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;
    const { type, payload } = message;
    
    // We can keep this log for now; it's useful for debugging the raw stream.
    // console.log('[WorkerManager] Received message:', type, payload);

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
      this.scheduleUpdate(); // This will kick off the chunking process if it's not already running.
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