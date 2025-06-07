
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

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const { type, payload } = event.data;
    console.log('[WorkerManager] Received message:', type, payload);

    switch (type) {
      case 'progress/update':
        this.store.getState().setAppStatus({ 
          message: payload.message 
        });
        break;

      case 'app_status/update':
        this.store.getState().setAppStatus({ 
          state: payload.state,
          message: payload.message 
        });
        break;

      case 'graph/setState':
        this.store.getState().setState(payload.data);
        break;

      case 'papers/updateOne':
        this.store.getState().updatePaper(payload.id, payload.changes);
        break;

      case 'graph/addNodes':
        this.store.getState().addNodes(payload.data);
        break;

      case 'graph/applyAuthorMerge':
        this.store.getState().applyAuthorMerge(
          payload.updates,
          payload.deletions
        );
        break;

      case 'error/fatal':
        this.store.getState().setAppStatus({
          state: 'error',
          message: payload.message
        });
        break;

      case 'warning/nonCritical':
        // Could show a toast notification
        console.warn('[Worker] Non-critical warning:', payload.message);
        break;

      default:
        console.warn('[WorkerManager] Unknown message type:', type);
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
      throw new Error('Worker not initialized');
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

    this.worker.postMessage({
      type: 'graph/extend',
      payload: null // No payload needed for the simplified action
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
