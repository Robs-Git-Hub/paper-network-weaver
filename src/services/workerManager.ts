
import { useKnowledgeGraphStore } from '../store/knowledge-graph-store';

interface WorkerMessage {
  type: string;
  payload: any;
}

class WorkerManager {
  private worker: Worker | null = null;
  private store = useKnowledgeGraphStore;
  
  initialize() {
    if (this.worker) {
      this.worker.terminate();
    }
  
    try {
      console.log('[WorkerManager] Initializing worker...');
      this.worker = new Worker(
        new URL('../workers/enhanced-graph-worker.ts', import.meta.url),
        { type: 'module' }
      );
  
      this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
      this.worker.addEventListener('error', this.handleWorkerError.bind(this));
      
      console.log('[WorkerManager] Worker initialized successfully');
    } catch (error) {
      console.error('[WorkerManager] Failed to initialize worker:', error);
      this.store.getState().setAppStatus({
        state: 'error',
        message: `Worker initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      throw error;
    }
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage | WorkerMessage[]>) {
    if (Array.isArray(event.data)) {
      if (event.data.length > 0) {
        console.log(`[WorkerManager] Received message batch of size ${event.data.length}.`);
      }
    } else if (event.data.type) {
      if (!['progress/update'].includes(event.data.type)) {
        console.log(`[WorkerManager] Received single message of type: ${event.data.type}`);
      }
    }

    const messages = Array.isArray(event.data) ? event.data : [event.data];
    
    const batchableMessages: WorkerMessage[] = [];
    const immediateMessages: WorkerMessage[] = [];

    const BATCHABLE_TYPES = [
      'graph/reset',
      'graph/addPaper',
      'graph/addAuthor',
      'graph/addInstitution',
      'graph/addAuthorship',
      'graph/addRelationship',
      'graph/addRelationshipTag',
      'graph/setExternalId',
      'papers/updateOne',
      'graph/addNodes',
      'graph/applyAuthorMerge',
    ];

    for (const message of messages) {
      if (BATCHABLE_TYPES.includes(message.type)) {
        batchableMessages.push(message);
      } else {
        immediateMessages.push(message);
      }
    }

    if (batchableMessages.length > 0) {
      this.store.getState().applyMessageBatch(batchableMessages);
    }

    if (immediateMessages.length > 0) {
      const storeActions = this.store.getState();
      for (const message of immediateMessages) {
        const { type, payload } = message;
        switch (type) {
          case 'progress/update':
            storeActions.setAppStatus({ 
              message: payload.message, 
              progress: payload.progress 
            });
            break;
          case 'app_status/update':
            storeActions.setAppStatus({ 
              state: payload.state, 
              message: payload.message,
              progress: payload.progress !== undefined ? payload.progress : storeActions.app_status.progress
            });
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
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error('[WorkerManager] Worker error:', error);
    console.error('[WorkerManager] Error details:', {
      message: error.message,
      filename: error.filename,
      lineno: error.lineno,
      colno: error.colno,
      error: error.error
    });
    this.store.getState().setAppStatus({
      state: 'error',
      message: `Worker error: ${error.message || 'Unknown worker error'}`
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
    // FIX: Send a simple command with an empty payload.
    // We are now trusting the worker to maintain its own state. This fixes
    // both the performance issue and the "amnesia" bug.
    this.worker.postMessage({
      type: 'graph/extend',
      payload: {} // No more large data blob.
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
