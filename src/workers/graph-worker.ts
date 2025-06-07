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
  // 1. Add the selected paper to the graph
  const masterPaperUid = await addPaper(selectedPaper, false);

  // 2. Fetch citations for the selected paper
  const citationsResponse = await openAlexService.fetchCitations(selectedPaper.id);
  const citations = citationsResponse.results;

  // 3. Add the citations to the graph, creating stubs if necessary
  for (const citation of citations) {
    const citationUid = await addPaper(citation, true);

    // 4. Create a relationship between the selected paper and the citation
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

    // 2. Update the paper in the graph with the full details
    const paperUid = graphData.external_id_index[`openalex:${selectedPaper.id}`];
    if (!paperUid) {
      console.warn(`[Worker] Paper not found in graph: ${selectedPaper.id}`);
      return;
    }

    graphData.papers[paperUid] = {
      ...graphData.papers[paperUid],
      title: fullPaperDetails.title || graphData.papers[paperUid].title,
      publication_year: fullPaperDetails.publication_year,
      publication_date: fullPaperDetails.publication_date,
      location: fullPaperDetails.primary_location?.source?.display_name || null,
      abstract: fullPaperDetails.abstract_inverted_index ? 'Abstract available' : null,
      fwci: fullPaperDetails.fwci || null,
      cited_by_count: fullPaperDetails.cited_by_count,
      type: fullPaperDetails.type,
      language: fullPaperDetails.language || null,
      keywords: fullPaperDetails.keywords ? fullPaperDetails.keywords.map(k => k.display_name) : [],
      best_oa_url: fullPaperDetails.best_oa_location?.url || null,
      oa_status: fullPaperDetails.open_access?.oa_status || null,
      is_stub: false // No longer a stub
    };

    // 3. Process authors and institutions
    for (const authorship of fullPaperDetails.authorships) {
      let authorUid = graphData.external_id_index[`openalex:${authorship.author.id}`];

      if (!authorUid) {
        authorUid = generateShortUid('a');
        graphData.authors[authorUid] = {
          short_uid: authorUid,
          clean_name: authorship.author.display_name,
          orcid: authorship.author.orcid || null,
          is_stub: false
        };
        addToExternalIdIndex('openalex', authorship.author.id, authorUid);
      }

      const authorshipUid = generateShortUid('au');
      graphData.authorships[authorshipUid] = {
        paper_short_uid: paperUid,
        author_short_uid: authorUid,
        author_position: authorship.author_position === 'first' ? 1 : authorship.author_position === 'last' ? 3 : 2,
        is_corresponding: authorship.is_corresponding,
        raw_author_name: authorship.raw_author_name,
        institution_uids: []
      };

      for (const institution of authorship.institutions) {
        let institutionUid = graphData.external_id_index[`ror:${institution.ror}`];

        if (!institutionUid) {
          institutionUid = generateShortUid('i');
          graphData.institutions[institutionUid] = {
            short_uid: institutionUid,
            ror_id: institution.ror || null,
            display_name: institution.display_name,
            country_code: institution.country_code || null,
            type: institution.type || null
          };
          addToExternalIdIndex('ror', institution.ror, institutionUid);
        }

        graphData.authorships[authorshipUid].institution_uids.push(institutionUid);
      }
    }
  } catch (error) {
    console.error('[Worker] Error enriching master paper:', error);
    throw error;
  }
}

async function addPaper(paper: any, isStub: boolean): Promise<string> {
  let paperUid = graphData.external_id_index[`openalex:${paper.id}`];

  if (!paperUid) {
    paperUid = generateShortUid('p');
    graphData.papers[paperUid] = {
      short_uid: paperUid,
      title: paper.title || paper.display_name || 'Untitled',
      publication_year: paper.publication_year,
      publication_date: paper.publication_date || null,
      location: paper.primary_location?.source?.display_name || null,
      abstract: null,
      fwci: paper.fwci || null,
      cited_by_count: paper.cited_by_count || 0,
      type: paper.type || 'article',
      language: paper.language || null,
      keywords: paper.keywords ? paper.keywords.map(k => k.display_name) : [],
      best_oa_url: paper.best_oa_location?.pdf_url || null,
      oa_status: paper.open_access?.oa_status || null,
      is_stub: isStub
    };
    addToExternalIdIndex('openalex', paper.id, paperUid);
  }

  return paperUid;
}
