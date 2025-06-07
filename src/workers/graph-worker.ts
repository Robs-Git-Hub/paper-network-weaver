
import { openAlexService } from '../services/openAlex';
import { semanticScholarService } from '../services/semanticScholar';
import { generateShortUid, reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';
import type { Paper, Author, Institution, Authorship, PaperRelationship } from '@/store/knowledge-graph-store';

// Define the paper result interface to match what we receive from the main thread
interface PaperResult {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  authorships: Array<{
    author: { display_name: string };
  }>;
  publication_year: number | null;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count: number;
}

// Define a type for the state being built
interface GraphState {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  external_id_index: Record<string, string>; // Key: "type:id", Value: "short_uid"
}

// Enhanced logger for the worker context
const logger = {
  info: (message: string, data?: any) => {
    console.log(`[Worker] ${message}`, data || '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`[Worker] ${message}`, data || '');
  },
  error: (message: string, data?: any) => {
    console.error(`[Worker] ${message}`, data || '');
  },
  debug: (message: string, data?: any) => {
    console.log(`[Worker Debug] ${message}`, data || '');
  }
};

/**
 * Progress reporting helper
 */
function reportProgress(message: string) {
  logger.info(`Progress: ${message}`);
  self.postMessage({ 
    type: 'progress/update', 
    payload: { message } 
  });
}

/**
 * Entity processing helpers with debug logging
 */
function processOrGetAuthor(state: GraphState, oaAuthor: any): string {
  logger.debug('Processing author:', { id: oaAuthor.id, name: oaAuthor.display_name });
  
  const oaId = oaAuthor.id;
  if (oaId && state.external_id_index[`openalex_author:${oaId}`]) {
    logger.debug('Found existing author by OpenAlex ID');
    return state.external_id_index[`openalex_author:${oaId}`];
  }
  if (oaAuthor.orcid && state.external_id_index[`orcid:${oaAuthor.orcid}`]) {
    logger.debug('Found existing author by ORCID');
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
  
  logger.debug('Created new author:', { uid: newUid, name: oaAuthor.display_name });
  return newUid;
}

function processOrGetInstitution(state: GraphState, oaInstitution: any): string {
  logger.debug('Processing institution:', { id: oaInstitution.id, name: oaInstitution.display_name });
  
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
  
  logger.debug('Created new institution:', { uid: newUid, name: oaInstitution.display_name });
  return newUid;
}

function processAuthorships(state: GraphState, paperUid: string, oaAuthorships: any[]) {
  if (!oaAuthorships) {
    logger.debug('No authorships to process');
    return;
  }
  
  logger.debug(`Processing ${oaAuthorships.length} authorships for paper ${paperUid}`);
  
  oaAuthorships.forEach((oaAuthorship: any) => {
    if (!oaAuthorship.author) {
      logger.warn('Authorship missing author data');
      return;
    }
    
    const authorUid = processOrGetAuthor(state, oaAuthorship.author);
    const institutionUids = (oaAuthorship.institutions || []).map((inst: any) => 
      processOrGetInstitution(state, inst)
    );
    
    const authorshipId = `${paperUid}_${authorUid}`;
    state.authorships[authorshipId] = {
      paper_short_uid: paperUid,
      author_short_uid: authorUid,
      author_position: oaAuthorship.author_position,
      is_corresponding: oaAuthorship.is_corresponding,
      raw_author_name: oaAuthorship.raw_author_name,
      institution_uids: institutionUids,
    };
    
    logger.debug('Created authorship:', { id: authorshipId, author: authorUid });
  });
}

function createStubPaper(state: GraphState, externalId: string, idType: 'openalex' | 'ss' | 'doi' | 'corpusId'): string {
  const cleanExternalId = externalId.replace('https://openalex.org/', '');
  const prefixedId = `${idType}:${cleanExternalId}`;
  
  if (state.external_id_index[prefixedId]) {
    logger.debug('Found existing stub paper:', prefixedId);
    return state.external_id_index[prefixedId];
  }
  
  const newUid = `p_${generateShortUid()}`;
  state.external_id_index[prefixedId] = newUid;
  
  state.papers[newUid] = {
    short_uid: newUid,
    title: 'Unknown Title (Stub)',
    publication_year: null,
    publication_date: null,
    location: null,
    abstract: null,
    fwci: null,
    cited_by_count: 0,
    type: 'article',
    language: null,
    keywords: [],
    best_oa_url: null,
    oa_status: null,
    is_stub: true,
  };
  
  logger.debug('Created stub paper:', { uid: newUid, type: idType, id: cleanExternalId });
  return newUid;
}

function extractDoiFromPaper(paper: PaperResult): string | null {
  logger.debug('Extracting DOI from paper:', { doi: paper.doi, title: paper.title });
  
  if (paper.doi) {
    const normalizedDoi = normalizeDoi(paper.doi);
    logger.debug('Normalized DOI:', normalizedDoi);
    return normalizedDoi;
  }
  
  logger.warn('No DOI found for master paper:', { title: paper.title });
  return null;
}

/**
 * Main worker message handler
 */
self.onmessage = async function(e) {
  const { type, payload } = e.data;
  
  try {
    logger.info('Received message:', { type, payload: payload ? 'present' : 'null' });
    
    if (type === 'graph/processMasterPaper') {
      const masterPaperFromSearch = payload.paper;
      logger.info('Starting Phase A - Processing master paper:', {
        id: masterPaperFromSearch.id,
        title: masterPaperFromSearch.title || masterPaperFromSearch.display_name,
        doi: masterPaperFromSearch.doi
      });

      // Initialize state
      const state: GraphState = {
        papers: {},
        authors: {},
        institutions: {},
        authorships: {},
        paper_relationships: [],
        external_id_index: {},
      };

      // Relationship deduplication
      const relationship_set = new Set<string>();
      const addRelationship = (source: string, target: string, type: 'cites' | 'similar') => {
        const key = `${source}|${type}|${target}`;
        if (!relationship_set.has(key)) {
          relationship_set.add(key);
          state.paper_relationships.push({
            source_short_uid: source,
            target_short_uid: target,
            relationship_type: type
          });
          logger.debug('Added relationship:', { source, target, type });
        } else {
          logger.debug('Skipped duplicate relationship:', { source, target, type });
        }
      };

      // Step 1: Process Master Paper
      reportProgress('Processing master paper...');
      
      const masterPaperUid = `p_${generateShortUid()}`;
      state.external_id_index[`openalex:${masterPaperFromSearch.id}`] = masterPaperUid;
      
      const masterDoi = extractDoiFromPaper(masterPaperFromSearch);
      if (masterDoi) {
        state.external_id_index[`doi:${masterDoi}`] = masterPaperUid;
        logger.info('Master paper DOI indexed:', masterDoi);
      }
      
      state.papers[masterPaperUid] = {
        short_uid: masterPaperUid,
        title: masterPaperFromSearch.title || masterPaperFromSearch.display_name || 'Untitled',
        publication_year: masterPaperFromSearch.publication_year,
        location: masterPaperFromSearch.primary_location?.source?.display_name || null,
        cited_by_count: masterPaperFromSearch.cited_by_count || 0,
        is_stub: false,
        publication_date: null,
        abstract: null,
        fwci: null,
        type: 'article',
        language: null,
        keywords: [],
        best_oa_url: null,
        oa_status: null,
      };
      
      processAuthorships(state, masterPaperUid, masterPaperFromSearch.authorships);
      logger.info('Master paper processed:', { uid: masterPaperUid });

      // Step 2: Fetch 1st Degree Citations
      reportProgress('Fetching 1st degree citations from OpenAlex...');
      
      try {
        const citationsResponse = await openAlexService.fetchCitations(masterPaperFromSearch.id);
        logger.info('OpenAlex citations response:', {
          count: citationsResponse.results.length,
          totalCount: citationsResponse.meta.count
        });
        
        for (const citingPaper of citationsResponse.results) {
          logger.debug('Processing citing paper:', {
            id: citingPaper.id,
            title: citingPaper.title
          });
          
          const citingPaperUid = createStubPaper(state, citingPaper.id, 'openalex');
          
          // Update the stub with full data
          state.papers[citingPaperUid] = {
            ...state.papers[citingPaperUid],
            title: citingPaper.title || 'Unknown Title',
            publication_year: citingPaper.publication_year,
            publication_date: citingPaper.publication_date,
            location: citingPaper.primary_location?.source?.display_name || null,
            abstract: reconstructAbstract(citingPaper.abstract_inverted_index),
            fwci: citingPaper.fwci,
            cited_by_count: citingPaper.cited_by_count,
            type: citingPaper.type,
            language: citingPaper.language,
            keywords: extractKeywords(citingPaper.keywords),
            best_oa_url: citingPaper.best_oa_location?.pdf_url || null,
            oa_status: citingPaper.open_access?.oa_status || null,
            is_stub: false,
          };
          
          const citingDoi = normalizeDoi(citingPaper.doi || citingPaper.ids?.doi);
          if (citingDoi) {
            state.external_id_index[`doi:${citingDoi}`] = citingPaperUid;
          }

          processAuthorships(state, citingPaperUid, citingPaper.authorships);
          addRelationship(citingPaperUid, masterPaperUid, 'cites');
          
          // Process referenced works
          (citingPaper.referenced_works || []).forEach(refWorkId => {
            if (refWorkId) {
              const targetUid = createStubPaper(state, refWorkId, 'openalex');
              addRelationship(citingPaperUid, targetUid, 'cites');
            }
          });
          
          // Process related works
          (citingPaper.related_works || []).forEach(relWorkId => {
            if (relWorkId) {
              const targetUid = createStubPaper(state, relWorkId, 'openalex');
              addRelationship(citingPaperUid, targetUid, 'similar');
            }
          });
        }
      } catch (error) {
        logger.error('Error fetching OpenAlex citations:', error);
        // Continue with what we have
      }

      // Step 3: Enrich with Semantic Scholar
      if (masterDoi) {
        reportProgress('Enriching with Semantic Scholar data...');
        
        try {
          const ssData = await semanticScholarService.fetchPaperDetails(masterDoi);
          
          if (ssData) {
            logger.info('Semantic Scholar data received:', {
              paperId: ssData.paperId,
              citationsCount: ssData.citations?.length || 0,
              referencesCount: ssData.references?.length || 0
            });
            
            // Index SS identifiers
            if (ssData.paperId) {
              state.external_id_index[`ss:${ssData.paperId}`] = masterPaperUid;
            }
            if (ssData.corpusId) {
              state.external_id_index[`corpusId:${ssData.corpusId}`] = masterPaperUid;
            }
            
            // Enrich master paper
            const masterPaper = state.papers[masterPaperUid];
            if (masterPaper && !masterPaper.best_oa_url) {
              masterPaper.best_oa_url = ssData.openAccessPdf?.url || null;
            }
            
            // Process citations
            (ssData.citations || []).forEach(ssCitation => {
              let paperUid = null;
              
              if (ssCitation.externalIds?.DOI) {
                const normalizedDoi = normalizeDoi(ssCitation.externalIds.DOI);
                if (normalizedDoi) {
                  paperUid = state.external_id_index[`doi:${normalizedDoi}`] || 
                            createStubPaper(state, normalizedDoi, 'doi');
                }
              }
              
              if (!paperUid) {
                paperUid = createStubPaper(state, ssCitation.paperId, 'ss');
              }
              
              addRelationship(paperUid, masterPaperUid, 'cites');
            });
            
            // Process references
            (ssData.references || []).forEach(ssReference => {
              let paperUid = null;
              
              if (ssReference.externalIds?.DOI) {
                const normalizedDoi = normalizeDoi(ssReference.externalIds.DOI);
                if (normalizedDoi) {
                  paperUid = state.external_id_index[`doi:${normalizedDoi}`] || 
                            createStubPaper(state, normalizedDoi, 'doi');
                }
              }
              
              if (!paperUid) {
                paperUid = createStubPaper(state, ssReference.paperId, 'ss');
              }
              
              addRelationship(masterPaperUid, paperUid, 'cites');
            });
          } else {
            logger.info('No Semantic Scholar data found for DOI:', masterDoi);
          }
        } catch (error) {
          logger.error('Error fetching Semantic Scholar data:', error);
          // Continue without SS data
        }
      } else {
        logger.warn('No DOI available for Semantic Scholar lookup');
      }

      // Send completed data to UI
      logger.info('Phase A complete. Final counts:', {
        papers: Object.keys(state.papers).length,
        authors: Object.keys(state.authors).length,
        institutions: Object.keys(state.institutions).length,
        authorships: Object.keys(state.authorships).length,
        relationships: state.paper_relationships.length
      });
      
      self.postMessage({ type: 'graph/setState', payload: { data: state } });
      self.postMessage({ 
        type: 'app/setStatus', 
        payload: { state: 'ready', message: 'Initial graph built successfully' } 
      });
    }
  } catch (error) {
    logger.error('Worker fatal error:', error);
    self.postMessage({ 
      type: 'error/fatal', 
      payload: { 
        message: error instanceof Error ? error.message : 'Unknown worker error' 
      } 
    });
  }
};
