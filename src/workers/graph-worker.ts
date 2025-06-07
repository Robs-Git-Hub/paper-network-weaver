
import { openAlexService } from '../services/openAlex';
import { semanticScholarService } from '../services/semanticScholar';
import { generateShortUid, reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';
import type { Paper, Author, Institution, Authorship, PaperRelationship } from '@/store/knowledge-graph-store';

// Define a type for the state being built to avoid using 'any'
interface GraphState {
    papers: Record<string, Paper>;
    authors: Record<string, Author>;
    institutions: Record<string, Institution>;
    authorships: Record<string, Authorship>;
    paper_relationships: PaperRelationship[];
    external_id_index: Record<string, string>; // Key: "type:id", Value: "short_uid"
}

// Simple logger for the worker context
const logger = {
  info: (message: string, data?: any) => console.log(`[Worker] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[Worker] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[Worker] ${message}`, data || '')
};

/**
 * ===================================================================================
 * ENTITY PROCESSING HELPERS (with deduplication)
 * ===================================================================================
 */
function processOrGetAuthor(state: GraphState, oaAuthor: any): string {
    const oaId = oaAuthor.id;
    if (oaId && state.external_id_index[`openalex_author:${oaId}`]) {
        return state.external_id_index[`openalex_author:${oaId}`];
    }
    if (oaAuthor.orcid && state.external_id_index[`orcid:${oaAuthor.orcid}`]) {
        return state.external_id_index[`orcid:${oaAuthor.orcid}`];
    }
    const newUid = `a_${generateShortUid()}`;
    if (oaId) {
        state.external_id_index[`openalex_author:${oaId}`] = newUid;
    }
    if (oaAuthor.orcid) {
        state.external_id_index[`orcid:${oaAuthor.orcid}`] = newUid;
    }
    state.authors[newUid] = {
        short_uid: newUid,
        clean_name: oaAuthor.display_name || 'Unknown Author',
        orcid: oaAuthor.orcid || null,
        is_stub: false
    };
    return newUid;
}

function processOrGetInstitution(state: GraphState, oaInstitution: any): string {
    const oaId = oaInstitution.id;
    if (oaId && state.external_id_index[`openalex_institution:${oaId}`]) {
        return state.external_id_index[`openalex_institution:${oaId}`];
    }
    if (oaInstitution.ror && state.external_id_index[`ror:${oaInstitution.ror}`]) {
        return state.external_id_index[`ror:${oaInstitution.ror}`];
    }
    const newUid = `i_${generateShortUid()}`;
    if (oaId) {
        state.external_id_index[`openalex_institution:${oaId}`] = newUid;
    }
    if (oaInstitution.ror) {
        state.external_id_index[`ror:${oaInstitution.ror}`] = newUid;
    }
    state.institutions[newUid] = {
        short_uid: newUid,
        display_name: oaInstitution.display_name || 'Unknown Institution',
        ror_id: oaInstitution.ror || null,
        country_code: oaInstitution.country_code || null,
        type: oaInstitution.type || null,
    };
    return newUid;
}

function processAuthorships(state: GraphState, paperUid: string, oaAuthorships: any[]) {
    if (!oaAuthorships) return;
    oaAuthorships.forEach((oaAuthorship: any) => {
        if (!oaAuthorship.author) return;
        const authorUid = processOrGetAuthor(state, oaAuthorship.author);
        const institutionUids = (oaAuthorship.institutions || []).map((inst: any) => processOrGetInstitution(state, inst));
        const authorshipId = `${paperUid}_${authorUid}`;
        state.authorships[authorshipId] = {
            paper_short_uid: paperUid,
            author_short_uid: authorUid,
            author_position: oaAuthorship.author_position,
            is_corresponding: oaAuthorship.is_corresponding,
            raw_author_name: oaAuthorship.raw_author_name,
            institution_uids: institutionUids,
        };
    });
}

function createStubPaper(state: GraphState, externalId: string, idType: 'openalex' | 'ss' | 'doi' | 'corpusId'): string {
    const cleanExternalId = externalId.replace('https://openalex.org/', '');
    const prefixedId = `${idType}:${cleanExternalId}`;
    if (state.external_id_index[prefixedId]) {
        return state.external_id_index[prefixedId];
    }
    const newUid = `p_${generateShortUid()}`;
    state.external_id_index[prefixedId] = newUid;
    state.papers[newUid] = {
        short_uid: newUid,
        title: 'Unknown Title (Stub)',
        publication_year: null, publication_date: null, location: null, abstract: null,
        fwci: null, cited_by_count: 0, type: 'article', language: null, keywords: [],
        best_oa_url: null, oa_status: null, is_stub: true,
    };
    return newUid;
}

/**
 * ===================================================================================
 * MAIN WORKER LOGIC
 * ===================================================================================
 */
self.onmessage = async function(e) {
  const { type, payload } = e.data;
  
  try {
    if (type === 'graph/processMasterPaper') {
        const masterPaperFromSearch = payload.paper;
        logger.info('Received master paper, starting Phase A.', masterPaperFromSearch);

        const state: GraphState = {
            papers: {}, authors: {}, institutions: {},
            authorships: {}, paper_relationships: [], external_id_index: {},
        };

        const relationship_set = new Set<string>();
        const addRelationship = (source: string, target: string, type: 'cites' | 'similar') => {
            const key = `${source}|${type}|${target}`;
            if (!relationship_set.has(key)) {
                relationship_set.add(key);
                state.paper_relationships.push({ source_short_uid: source, target_short_uid: target, relationship_type: type });
            }
        };

        // --- STEP 1: Process Sparse Master Paper ---
        const masterPaperUid = `p_${generateShortUid()}`;
        state.external_id_index[`openalex:${masterPaperFromSearch.id}`] = masterPaperUid;
        const masterDoi = normalizeDoi(masterPaperFromSearch.doi);
        if (masterDoi) {
            state.external_id_index[`doi:${masterDoi}`] = masterPaperUid;
        }
        state.papers[masterPaperUid] = {
            short_uid: masterPaperUid,
            title: masterPaperFromSearch.display_name,
            publication_year: masterPaperFromSearch.publication_year,
            location: masterPaperFromSearch.primary_location?.source?.display_name || null,
            cited_by_count: masterPaperFromSearch.cited_by_count || 0,
            is_stub: false,
            publication_date: null, abstract: null, fwci: null, type: 'article', language: null, keywords: [], best_oa_url: null, oa_status: null,
        };
        // This processes the authors/institutions from the sparse object, fixing a key bug.
        processAuthorships(state, masterPaperUid, masterPaperFromSearch.authorships);
        
        // --- STEP 2: Fetch and Process 1st Degree Citations ---
        self.postMessage({ type: 'progress/update', payload: { message: 'Fetching 1st degree citations...' } });
        const citationsResponse = await openAlexService.fetchCitations(masterPaperFromSearch.id);
        
        for (const citingPaper of citationsResponse.results) {
            const citingPaperUid = createStubPaper(state, citingPaper.id, 'openalex');
            state.papers[citingPaperUid] = {
                ...state.papers[citingPaperUid],
                title: citingPaper.title, publication_year: citingPaper.publication_year, publication_date: citingPaper.publication_date,
                location: citingPaper.primary_location?.source?.display_name || null, abstract: reconstructAbstract(citingPaper.abstract_inverted_index),
                fwci: citingPaper.fwci, cited_by_count: citingPaper.cited_by_count, type: citingPaper.type, language: citingPaper.language,
                keywords: extractKeywords(citingPaper.keywords), best_oa_url: citingPaper.best_oa_location?.pdf_url || null,
                oa_status: citingPaper.open_access?.oa_status || null, is_stub: false,
            };
            const citingDoi = normalizeDoi(citingPaper.doi || citingPaper.ids?.doi);
            if (citingDoi) { state.external_id_index[`doi:${citingDoi}`] = citingPaperUid; }

            processAuthorships(state, citingPaperUid, citingPaper.authorships);
            addRelationship(citingPaperUid, masterPaperUid, 'cites');
            (citingPaper.referenced_works || []).forEach(id => addRelationship(citingPaperUid, createStubPaper(state, id, 'openalex'), 'cites'));
            (citingPaper.related_works || []).forEach(id => addRelationship(citingPaperUid, createStubPaper(state, id, 'openalex'), 'similar'));
        }

        // --- STEP 3: Fetch and Process Semantic Scholar Data ---
        if (masterDoi) {
            self.postMessage({ type: 'progress/update', payload: { message: 'Enriching with Semantic Scholar...' } });
            const ssData = await semanticScholarService.fetchPaperDetails(masterDoi);
            if (ssData) {
                if (ssData.paperId) state.external_id_index[`ss:${ssData.paperId}`] = masterPaperUid;
                if (ssData.corpusId) state.external_id_index[`corpusId:${ssData.corpusId}`] = masterPaperUid;
                if (!state.papers[masterPaperUid].best_oa_url) { state.papers[masterPaperUid].best_oa_url = ssData.openAccessPdf?.url || null; }
                
                (ssData.citations || []).forEach(ssCitingPaper => {
                    const doi = normalizeDoi(ssCitingPaper.externalIds?.DOI);
                    const paperUid = doi ? createStubPaper(state, doi, 'doi') : createStubPaper(state, ssCitingPaper.paperId, 'ss');
                    addRelationship(paperUid, masterPaperUid, 'cites');
                });
                (ssData.references || []).forEach(ssReferencedPaper => {
                    const doi = normalizeDoi(ssReferencedPaper.externalIds?.DOI);
                    const paperUid = doi ? createStubPaper(state, doi, 'doi') : createStubPaper(state, ssReferencedPaper.paperId, 'ss');
                    addRelationship(masterPaperUid, paperUid, 'cites');
                });
            }
        }
        
        // --- Send completed Phase A data to UI ---
        logger.info('Phase A complete. Sending initial graph to UI.');
        self.postMessage({ type: 'graph/setState', payload: { data: state } });
        self.postMessage({ type: 'app/setStatus', payload: { state: 'enriching', message: "Enriching graph data in the background..." } });

        // --- Phase B Begins Here (in the background) ---
        // The full hydration of the master paper (Step 4) will now happen here,
        // which matches the original UX-focused plan.
        logger.info('Phase B (enrichment) will start now.');
    }
  } catch (error) {
    logger.error('Worker error:', error);
    self.postMessage({ type: 'error/fatal', payload: { message: error instanceof Error ? error.message : 'Unknown worker error' } });
  }
};