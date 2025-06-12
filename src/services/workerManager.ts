
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
    // This log is helpful for debugging the stream of messages from the worker.
    console.log('[WorkerManager] Received message:', type, payload);

    const storeActions = this.store.getState();

    switch (type) {
      // --- START: NEW STREAMING HANDLERS ---
      case 'graph/reset':
        storeActions.resetGraph();
        break;
      case 'graph/addPaper':
        storeActions.addPaper(payload.paper);
        break;
      case 'graph/addAuthor':
        storeActions.addAuthor(payload.author);
        break;
      case 'graph/addInstitution':
        storeActions.addInstitution(payload.institution);
        break;
      case 'graph/addAuthorship':
        storeActions.addAuthorship(payload.authorship);
        break;
      case 'graph/addRelationship':
        storeActions.addRelationship(payload.relationship);
        break;
      case 'graph/setExternalId':
        storeActions.setExternalId(payload.key, payload.uid);
        break;
      // --- END: NEW STREAMING HANDLERS ---

      case 'progress/update':
        storeActions.setAppStatus({ message: payload.message });
        break;

      case 'app_status/update':
        storeActions.setAppStatus({ state: payload.state, message: payload.message });
        break;
      
      // `graph/setState` is now removed, as it's been replaced by the streaming handlers.

      case 'papers/updateOne':
        storeActions.updatePaper(payload.id, payload.changes);
        break;

      case 'graph/addNodes': // Primarily used by the 'extend' phase
        storeActions.addNodes(payload.data);
        break;

      case 'graph/applyAuthorMerge':
        storeActions.applyAuthorMerge(payload.updates, payload.deletions);
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