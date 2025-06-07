import { OpenAlexService, openAlexService } from '../services/openAlex';

// Define the interfaces for the knowledge graph data
interface Paper {
  short_uid: string;
  title: string;
  publication_year: number | null;
  publication_date: string | null;
  location: string | null;
  abstract: string | null;
  fwci: number | null;
  cited_by_count: number;
  type: string;
  language: string | null;
  keywords: string[];
  best_oa_url: string | null;
  oa_status: string | null;
  is_stub: boolean;
}

interface Author {
  short_uid: string;
  clean_name: string;
  orcid: string | null;
  is_stub: boolean;
}

interface Institution {
  short_uid: string;
  ror_id: string | null;
  display_name: string;
  country_code: string | null;
  type: string | null;
}

interface Authorship {
  paper_short_uid: string;
  author_short_uid: string;
  author_position: number;
  is_corresponding: boolean;
  raw_author_name: string | null;
  institution_uids: string[];
}

interface PaperRelationship {
  source_short_uid: string;
  target_short_uid: string;
  relationship_type: 'cites' | 'similar';
}

interface ExternalIdType {
  id_type: 'openalex' | 'doi' | 'ss' | 'corpusId';
  id_value: string;
}

interface GraphData {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  external_id_index: Record<string, string>;
}

// Global state for the worker
let graphData: GraphData = {
  papers: {},
  authors: {},
  institutions: {},
  authorships: {},
  paper_relationships: [],
  external_id_index: {}
};

// Utility function to generate a short UID
function generateShortUid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 8)}`;
}

// Utility function to add to the external ID index
function addToExternalIdIndex(idType: string, idValue: string, shortUid: string) {
  const key = `${idType}:${idValue}`;
  if (!graphData.external_id_index[key]) {
    graphData.external_id_index[key] = shortUid;
  }
}

// Utility function to check if an external ID exists
function externalIdExists(idType: string, idValue: string): boolean {
  const key = `${idType}:${idValue}`;
  return !!graphData.external_id_index[key];
}

// Main message handler
self.onmessage = async (e) => {
  const { type, payload } = e.data;
  console.log('[Worker] Received message:', type);
  
  try {
    switch (type) {
      case 'graph/processMasterPaper':
        await processMasterPaper(payload.paper);
        break;
      default:
        console.warn('[Worker] Unknown message type:', type);
    }
  } catch (error) {
    console.error('[Worker] Error processing message:', error);
    self.postMessage({
      type: 'error/fatal',
      payload: { message: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
};

function ingestPaper(paperData: any, isStub: boolean): string {
  // Check if paper already exists by its OpenAlex ID
  let paperUid = graphData.external_id_index[`openalex:${paperData.id}`];

  if (!paperUid) {
    // Create the paper if it's new
    paperUid = generateShortUid('p');
    addToExternalIdIndex('openalex', paperData.id, paperUid);
    if (paperData.doi) {
        // Normalize and add DOI
        const cleanDoi = paperData.doi.replace('https://doi.org/', '');
        addToExternalIdIndex('doi', cleanDoi, paperUid);
    }
  }

  // Create or update the paper record
  graphData.papers[paperUid] = {
    ...graphData.papers[paperUid], // Keep existing data if any
    short_uid: paperUid,
    title: paperData.title || paperData.display_name || 'Untitled',
    publication_year: paperData.publication_year,
    publication_date: paperData.publication_date || null,
    location: paperData.primary_location?.source?.display_name || null,
    // Reconstruct abstract only if we have the inverted index
    abstract: paperData.abstract_inverted_index ? 'Abstract will be reconstructed here' : graphData.papers[paperUid]?.abstract || null,
    fwci: paperData.fwci || null,
    cited_by_count: paperData.cited_by_count || 0,
    type: paperData.type || 'article',
    language: paperData.language || null,
    keywords: paperData.keywords ? paperData.keywords.map(k => k.display_name) : [],
    best_oa_url: paperData.best_oa_location?.pdf_url || null,
    oa_status: paperData.open_access?.oa_status || null,
    is_stub: isStub,
  };

  // Process authorships ONLY if they exist and the paper is not a stub
  if (paperData.authorships && !isStub) {
    for (const authorship of paperData.authorships) {
        if (!authorship.author) continue; // Skip if author data is missing

        // Ingest Author
        let authorUid = graphData.external_id_index[`openalex:${authorship.author.id}`];
        if (!authorUid) {
            authorUid = generateShortUid('a');
            graphData.authors[authorUid] = {
                short_uid: authorUid,
                clean_name: authorship.author.display_name,
                orcid: authorship.author.orcid || null,
                is_stub: false,
            };
            addToExternalIdIndex('openalex', authorship.author.id, authorUid);
        }

        // Ingest Institutions and link them
        const institutionUids: string[] = [];
        if(authorship.institutions) {
            for (const institution of authorship.institutions) {
                if (!institution.id) continue;
                let institutionUid = graphData.external_id_index[`openalex:${institution.id}`];
                if (!institutionUid) {
                    institutionUid = generateShortUid('i');
                    graphData.institutions[institutionUid] = {
                        short_uid: institutionUid,
                        ror_id: institution.ror || null,
                        display_name: institution.display_name,
                        country_code: institution.country_code || null,
                        type: institution.type || null,
                    };
                    addToExternalIdIndex('openalex', institution.id, institutionUid);
                }
                institutionUids.push(institutionUid);
            }
        }

        // Create Authorship link
        const authorshipKey = `${paperUid}_${authorUid}`;
        graphData.authorships[authorshipKey] = {
            paper_short_uid: paperUid,
            author_short_uid: authorUid,
            // Simple position mapping, can be improved
            author_position: authorship.author_position === 'first' ? 1 : 2,
            is_corresponding: authorship.is_corresponding,
            raw_author_name: authorship.raw_author_name,
            institution_uids: institutionUids,
        };
    }
  }
  
  return paperUid;
}

async function processMasterPaper(selectedPaper: any) {
  try {
    // Phase A: Build initial graph
    console.log('[Worker] Starting Phase A: Building initial graph');
    
    self.postMessage({
      type: 'progress/update',
      payload: { message: 'Fetching citations...' }
    });

    await buildInitialGraph(selectedPaper);
    
    console.log('[Worker] Phase A complete. Final counts:');
    console.log(`[Worker] - Papers: ${Object.keys(graphData.papers).length} (${Object.values(graphData.papers).filter(p => p.is_stub).length} stubs created with threshold N=3)`);
    console.log(`[Worker] - Authors: ${Object.keys(graphData.authors).length}`);
    console.log(`[Worker] - Institutions: ${Object.keys(graphData.institutions).length}`);
    console.log(`[Worker] - Relationships: ${graphData.paper_relationships.length}`);

    // Send the initial graph data to main thread
    self.postMessage({
      type: 'graph/setState',
      payload: { data: graphData }
    });

    // Phase B: Background enrichment
    console.log('[Worker] Starting Phase B: Background enrichment');
    
    self.postMessage({
      type: 'app/setStatus',
      payload: { state: 'enriching', message: 'Enriching data in background...' }
    });

    await enrichMasterPaper(selectedPaper);
    
    console.log('[Worker] Phase B complete: Background enrichment finished');
    
    // Send updated data and mark as complete
    self.postMessage({
      type: 'graph/setState',
      payload: { data: graphData }
    });
    
    self.postMessage({
      type: 'app/setStatus',
      payload: { state: 'active', message: null }
    });

  } catch (error) {
    console.error('[Worker] Error in processMasterPaper:', error);
    self.postMessage({
      type: 'error/fatal',
      payload: { message: error instanceof Error ? error.message : 'Failed to process master paper' }
    });
  }
}

async function buildInitialGraph(selectedPaper: any) {
  // 1. Ingest the selected paper as the Master Paper (not a stub)
  const masterPaperUid = ingestPaper(selectedPaper, false);

  // 2. Fetch citations for the selected paper
  const citationsResponse = await openAlexService.fetchCitations(selectedPaper.id);
  const citations = citationsResponse.results;

  // 3. Ingest the citations as full papers (not stubs)
  for (const citation of citations) {
    const citationUid = ingestPaper(citation, false); // Use the new function

    // 4. Create a relationship
    graphData.paper_relationships.push({
      source_short_uid: citationUid,
      target_short_uid: masterPaperUid,
      relationship_type: 'cites'
    });
  }
}

async function enrichMasterPaper(selectedPaper: any) {
  try {
    // 1. Fetch the full paper details from OpenAlex
    const fullPaperDetails = await openAlexService.fetchPaperDetails(selectedPaper.id);
    
    if (!fullPaperDetails) {
      console.warn(`[Worker] Could not fetch full details for paper: ${selectedPaper.id}`);
      return;
    }

    // 2. Use our powerful function to update the master paper with all the rich data.
    //    It handles all the authors and institutions automatically.
    ingestPaper(fullPaperDetails, false);

    console.log('[Worker] Master paper enriched with detailed data');
    
  } catch (error) {
    console.error('[Worker] Error enriching master paper:', error);
    throw error;
  }
}
