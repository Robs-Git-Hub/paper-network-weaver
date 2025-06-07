
import { openAlexService } from '../services/openAlex';
import { semanticScholarService } from '../services/semanticScholar';
import { generateShortUid, reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';

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

// Simple logger for the worker context
const logger = {
  info: (message: string, data?: any) => console.log(`[Worker] ${message}`, data || ''),
  warn: (message: string, data?: any) => console.warn(`[Worker] ${message}`, data || ''),
  error: (message: string, data?: any) => console.error(`[Worker] ${message}`, data || '')
};

function extractDoiFromPaper(paper: PaperResult): string | null {
  if (paper.doi) {
    // Use the normalizeDoi utility to clean the DOI
    return normalizeDoi(paper.doi);
  }
  logger.warn('No DOI found for master paper:', { title: paper.title });
  return null;
}

async function buildInitialGraph(masterPaper: PaperResult) {
  logger.info('Starting initial graph build for master paper:', { title: masterPaper.title });

  // Initialize data structures
  const papers: any = {};
  const authors: any = {};
  const institutions: any = {};
  const authorships: any = {};
  const paper_relationships: any[] = [];
  const external_id_index: any = {};
  
  // Set for tracking relationships to prevent duplicates
  const relationship_set = new Set<string>();

  // Helper function to add relationships without duplicates
  const addRelationship = (source: string, target: string, type: 'cites' | 'similar') => {
    const key = `${source}|${type}|${target}`;
    if (!relationship_set.has(key)) {
      relationship_set.add(key);
      paper_relationships.push({
        source_short_uid: source,
        target_short_uid: target,
        relationship_type: type
      });
    }
  };

  // Create master paper record
  const masterPaperUid = generateShortUid();
  const masterPaperOpenAlexId = masterPaper.id.replace('https://openalex.org/', '');
  
  // Add to external ID index
  external_id_index[`openalex:${masterPaper.id}`] = masterPaperUid;
  
  // Extract and index DOI if available
  const masterDoi = extractDoiFromPaper(masterPaper);
  if (masterDoi) {
    external_id_index[`doi:${masterDoi}`] = masterPaperUid;
  }

  // Create master paper record
  papers[masterPaperUid] = {
    short_uid: masterPaperUid,
    title: masterPaper.title || masterPaper.display_name || 'Untitled',
    publication_year: masterPaper.publication_year,
    publication_date: null,
    location: masterPaper.primary_location?.source?.display_name || null,
    abstract: null,
    fwci: null,
    cited_by_count: masterPaper.cited_by_count || 0,
    type: 'article',
    language: null,
    keywords: [],
    best_oa_url: null,
    oa_status: null,
    is_stub: false
  };

  // API Call 2: Fetch OpenAlex citations
  self.postMessage({
    type: 'progress/update',
    payload: { message: 'Fetching citations from OpenAlex...' }
  });

  let openAlexCitations: any[] = [];
  try {
    const citationsResponse = await openAlexService.fetchCitations(masterPaper.id);
    openAlexCitations = citationsResponse.results || [];
    logger.info(`Found ${openAlexCitations.length} citations from OpenAlex`);
  } catch (error) {
    logger.error('Failed to fetch OpenAlex citations:', error);
    // Continue without citations - this is not fatal for Phase A
  }

  // Process OpenAlex citations
  openAlexCitations.forEach((citation: any) => {
    const citationUid = generateShortUid();
    const citationOpenAlexId = citation.id;
    
    // Add to external ID index
    external_id_index[`openalex:${citationOpenAlexId}`] = citationUid;
    
    // Process DOI if available
    if (citation.doi) {
      const normalizedDoi = normalizeDoi(citation.doi);
      if (normalizedDoi) {
        external_id_index[`doi:${normalizedDoi}`] = citationUid;
      }
    }
    if (citation.ids?.doi) {
      const normalizedDoi = normalizeDoi(citation.ids.doi);
      if (normalizedDoi) {
        external_id_index[`doi:${normalizedDoi}`] = citationUid;
      }
    }

    // Create paper record
    papers[citationUid] = {
      short_uid: citationUid,
      title: citation.title || 'Untitled',
      publication_year: citation.publication_year,
      publication_date: citation.publication_date,
      location: citation.primary_location?.source?.display_name || null,
      abstract: reconstructAbstract(citation.abstract_inverted_index),
      fwci: citation.fwci,
      cited_by_count: citation.cited_by_count || 0,
      type: citation.type || 'article',
      language: citation.language,
      keywords: extractKeywords(citation.keywords),
      best_oa_url: citation.best_oa_location?.pdf_url || null,
      oa_status: citation.open_access?.oa_status || null,
      is_stub: false
    };

    // Create relationship: citation cites master paper
    addRelationship(citationUid, masterPaperUid, 'cites');

    // Process referenced works (papers this citation cites)
    (citation.referenced_works || []).forEach((targetOpenAlexId: string) => {
      if (!targetOpenAlexId) return;
      
      const targetIdWithPrefix = `openalex:${targetOpenAlexId}`;
      let targetUid = external_id_index[targetIdWithPrefix];

      // If we've never seen this paper before, create a stub for it
      if (!targetUid) {
        targetUid = generateShortUid();
        external_id_index[targetIdWithPrefix] = targetUid;
        papers[targetUid] = {
          short_uid: targetUid,
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
          is_stub: true
        };
      }
      
      // Create the relationship: citation cites target
      addRelationship(citationUid, targetUid, 'cites');
    });

    // Process related works (similar papers)
    (citation.related_works || []).forEach((targetOpenAlexId: string) => {
      if (!targetOpenAlexId) return;
      
      const targetIdWithPrefix = `openalex:${targetOpenAlexId}`;
      let targetUid = external_id_index[targetIdWithPrefix];

      if (!targetUid) {
        targetUid = generateShortUid();
        external_id_index[targetIdWithPrefix] = targetUid;
        papers[targetUid] = {
          short_uid: targetUid,
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
          is_stub: true
        };
      }
      
      // Create the relationship: citation is similar to target
      addRelationship(citationUid, targetUid, 'similar');
    });

    // Process authorships for this citation
    (citation.authorships || []).forEach((authorship: any, index: number) => {
      const authorUid = generateShortUid();
      const authorOpenAlexId = authorship.author?.id;
      
      if (authorOpenAlexId) {
        external_id_index[`openalex:${authorOpenAlexId}`] = authorUid;
      }
      
      if (authorship.author?.orcid) {
        external_id_index[`orcid:${authorship.author.orcid}`] = authorUid;
      }

      // Create author record
      authors[authorUid] = {
        short_uid: authorUid,
        clean_name: authorship.author?.display_name || 'Unknown Author',
        orcid: authorship.author?.orcid || null,
        is_stub: false
      };

      // Create authorship record
      const authorshipId = `${citationUid}_${authorUid}`;
      authorships[authorshipId] = {
        paper_short_uid: citationUid,
        author_short_uid: authorUid,
        author_position: authorship.author_position || index,
        is_corresponding: authorship.is_corresponding || false,
        raw_author_name: authorship.raw_author_name,
        institution_uids: []
      };

      // Process institutions
      (authorship.institutions || []).forEach((institution: any) => {
        const institutionUid = generateShortUid();
        const institutionOpenAlexId = institution.id;
        
        if (institutionOpenAlexId) {
          external_id_index[`openalex:${institutionOpenAlexId}`] = institutionUid;
        }
        
        if (institution.ror) {
          external_id_index[`ror:${institution.ror}`] = institutionUid;
        }

        institutions[institutionUid] = {
          short_uid: institutionUid,
          ror_id: institution.ror || null,
          display_name: institution.display_name || 'Unknown Institution',
          country_code: institution.country_code || null,
          type: institution.type || null
        };

        // Add institution to authorship
        authorships[authorshipId].institution_uids.push(institutionUid);
      });
    });
  });

  // API Call 3: Fetch Semantic Scholar data
  if (masterDoi) {
    self.postMessage({
      type: 'progress/update',
      payload: { message: 'Enriching with Semantic Scholar data...' }
    });

    try {
      const semanticScholarData = await semanticScholarService.fetchPaperDetails(masterDoi);
      
      if (semanticScholarData) {
        logger.info('Found Semantic Scholar data for master paper');

        // Enrich the master paper with SS data
        const masterPaperRecord = papers[masterPaperUid];
        if (masterPaperRecord) {
          masterPaperRecord.best_oa_url = masterPaperRecord.best_oa_url || semanticScholarData.openAccessPdf?.url || null;
          
          // Add SS external IDs
          if (semanticScholarData.paperId) {
            external_id_index[`ss:${semanticScholarData.paperId}`] = masterPaperUid;
          }
          if (semanticScholarData.corpusId) {
            external_id_index[`corpusId:${semanticScholarData.corpusId}`] = masterPaperUid;
          }
        }

        // Process SS citations
        if (semanticScholarData.citations) {
          semanticScholarData.citations.forEach((ssCitation: any) => {
            let existingUid = null;
            if (ssCitation.externalIds?.DOI) {
              const normalizedDoi = normalizeDoi(ssCitation.externalIds.DOI);
              if (normalizedDoi) {
                existingUid = external_id_index[`doi:${normalizedDoi}`];
              }
            }
            
            if (!existingUid) {
              // Create new stub paper
              const newUid = generateShortUid();
              
              // Add to external ID index
              if (ssCitation.paperId) {
                external_id_index[`ss:${ssCitation.paperId}`] = newUid;
              }
              if (ssCitation.externalIds?.DOI) {
                const normalizedDoi = normalizeDoi(ssCitation.externalIds.DOI);
                if (normalizedDoi) {
                  external_id_index[`doi:${normalizedDoi}`] = newUid;
                }
              }
              if (ssCitation.externalIds?.CorpusId) {
                external_id_index[`corpusId:${ssCitation.externalIds.CorpusId}`] = newUid;
              }

              papers[newUid] = {
                short_uid: newUid,
                title: ssCitation.title || 'Unknown Title (Stub)',
                publication_year: ssCitation.year,
                publication_date: null,
                location: ssCitation.venue || null,
                abstract: ssCitation.abstract || null,
                fwci: null,
                cited_by_count: ssCitation.citationCount || 0,
                type: 'article',
                language: null,
                keywords: [],
                best_oa_url: ssCitation.openAccessPdf?.url || null,
                oa_status: null,
                is_stub: true
              };

              // Create stub authors
              (ssCitation.authors || []).forEach((author: any) => {
                const authorUid = generateShortUid();
                
                if (author.authorId) {
                  external_id_index[`ss:${author.authorId}`] = authorUid;
                }

                authors[authorUid] = {
                  short_uid: authorUid,
                  clean_name: author.name || 'Unknown Author',
                  orcid: null,
                  is_stub: true
                };

                const authorshipId = `${newUid}_${authorUid}`;
                authorships[authorshipId] = {
                  paper_short_uid: newUid,
                  author_short_uid: authorUid,
                  author_position: 0,
                  is_corresponding: false,
                  raw_author_name: author.name,
                  institution_uids: []
                };
              });

              existingUid = newUid;
            } else {
              // Enrich existing paper with SS data
              const existingPaper = papers[existingUid];
              if (existingPaper) {
                existingPaper.abstract = existingPaper.abstract || ssCitation.abstract || null;
                existingPaper.location = existingPaper.location || ssCitation.venue || null;
                existingPaper.best_oa_url = existingPaper.best_oa_url || ssCitation.openAccessPdf?.url || null;
              }
            }

            // Create relationship: SS citation cites master paper
            addRelationship(existingUid, masterPaperUid, 'cites');
          });
        }

        // Process SS references (papers the master paper cites)
        if (semanticScholarData.references) {
          semanticScholarData.references.forEach((ssReference: any) => {
            let existingUid = null;
            if (ssReference.externalIds?.DOI) {
              const normalizedDoi = normalizeDoi(ssReference.externalIds.DOI);
              if (normalizedDoi) {
                existingUid = external_id_index[`doi:${normalizedDoi}`];
              }
            }
            
            if (!existingUid) {
              // Create new stub paper
              const newUid = generateShortUid();
              
              // Add to external ID index
              if (ssReference.paperId) {
                external_id_index[`ss:${ssReference.paperId}`] = newUid;
              }
              if (ssReference.externalIds?.DOI) {
                const normalizedDoi = normalizeDoi(ssReference.externalIds.DOI);
                if (normalizedDoi) {
                  external_id_index[`doi:${normalizedDoi}`] = newUid;
                }
              }
              if (ssReference.externalIds?.CorpusId) {
                external_id_index[`corpusId:${ssReference.externalIds.CorpusId}`] = newUid;
              }

              papers[newUid] = {
                short_uid: newUid,
                title: ssReference.title || 'Unknown Title (Stub)',
                publication_year: ssReference.year,
                publication_date: null,
                location: ssReference.venue || null,
                abstract: ssReference.abstract || null,
                fwci: null,
                cited_by_count: ssReference.citationCount || 0,
                type: 'article',
                language: null,
                keywords: [],
                best_oa_url: ssReference.openAccessPdf?.url || null,
                oa_status: null,
                is_stub: true
              };

              // Create stub authors
              (ssReference.authors || []).forEach((author: any) => {
                const authorUid = generateShortUid();
                
                if (author.authorId) {
                  external_id_index[`ss:${author.authorId}`] = authorUid;
                }

                authors[authorUid] = {
                  short_uid: authorUid,
                  clean_name: author.name || 'Unknown Author',
                  orcid: null,
                  is_stub: true
                };

                const authorshipId = `${newUid}_${authorUid}`;
                authorships[authorshipId] = {
                  paper_short_uid: newUid,
                  author_short_uid: authorUid,
                  author_position: 0,
                  is_corresponding: false,
                  raw_author_name: author.name,
                  institution_uids: []
                };
              });

              existingUid = newUid;
            } else {
              // Enrich existing paper with SS data
              const existingPaper = papers[existingUid];
              if (existingPaper) {
                existingPaper.abstract = existingPaper.abstract || ssReference.abstract || null;
                existingPaper.location = existingPaper.location || ssReference.venue || null;
                existingPaper.best_oa_url = existingPaper.best_oa_url || ssReference.openAccessPdf?.url || null;
              }
            }

            // Create relationship: master paper cites SS reference
            addRelationship(masterPaperUid, existingUid, 'cites');
          });
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Semantic Scholar data:', error);
      // Continue without SS data - this is not fatal for Phase A
    }
  } else {
    logger.warn('No DOI available for Semantic Scholar lookup');
  }

  // Return the complete graph data
  return {
    papers,
    authors,
    institutions,
    authorships,
    paper_relationships,
    external_id_index
  };
}

// Worker message handler
self.onmessage = async function(e) {
  const { type, payload } = e.data;
  
  try {
    switch (type) {
      case 'graph/processMasterPaper':
        logger.info('Processing master paper:', payload.paper);
        
        // Update status to loading
        self.postMessage({
          type: 'app/setStatus',
          payload: { state: 'loading', message: 'Building initial graph...' }
        });

        // Build the initial graph
        const graphData = await buildInitialGraph(payload.paper);
        
        // Send the complete graph data to the main thread
        self.postMessage({
          type: 'graph/setState',
          payload: { data: graphData }
        });

        // Update status to active
        self.postMessage({
          type: 'app/setStatus',
          payload: { state: 'active', message: null }
        });

        logger.info('Initial graph build completed');
        break;
        
      default:
        logger.warn('Unknown message type:', type);
    }
  } catch (error) {
    logger.error('Worker error:', error);
    self.postMessage({
      type: 'error/fatal',
      payload: { message: error instanceof Error ? error.message : 'Unknown worker error' }
    });
  }
};
