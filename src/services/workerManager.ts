
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
  
    this.worker = new Worker(
      new URL('../workers/enhanced-graph-worker.ts', import.meta.url),
      { type: 'module' }
    );
  
    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
    this.worker.addEventListener('error', this.handleWorkerError.bind(this));
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage | WorkerMessage[]>) {
    // DIAGNOSTIC: Log the type and size of the incoming message/batch.
    if (Array.isArray(event.data)) {
      console.log(`[WorkerManager] Received message batch of size ${event.data.length}.`);
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
      'graph/setExternalId',
      'papers/updateOne',
      'graph/addNodes',
      'graph/applyAuthorMerge',
    ];

    // 1. Sort all incoming messages into two groups: batchable data and immediate statuses.
    for (const message of messages) {
      if (BATCHABLE_TYPES.includes(message.type)) {
        batchableMessages.push(message);
      } else {
        immediateMessages.push(message);
      }
    }

    // 2. If there are any batchable messages, apply them all in a SINGLE state update.
    if (batchableMessages.length > 0) {
      this.store.getState().applyMessageBatch(batchableMessages);
    }

    // 3. Process all immediate, low-frequency messages individually after the main batch.
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
              // Reset progress when state changes, unless a new progress is provided
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