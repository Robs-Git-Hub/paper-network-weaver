
import { openAlexService } from '../services/openAlex';
import { generateShortUid, reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';

interface PaperResult {
  id: string;
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

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  
  console.log('Worker received message:', type, payload);
  
  try {
    switch (type) {
      case 'graph/processMasterPaper':
        await processMasterPaper(payload.paper);
        break;
      default:
        console.warn('Unknown worker message type:', type);
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({
      type: 'error/fatal',
      payload: { message: error instanceof Error ? error.message : 'Unknown worker error' }
    });
  }
};

async function processMasterPaper(paper: PaperResult) {
  console.log('Processing master paper:', paper);
  
  // Step 1: Update progress
  self.postMessage({
    type: 'progress/update',
    payload: { message: 'Fetching citations...' }
  });
  
  try {
    // Step 2: Fetch 1st degree citations from OpenAlex
    console.log('Fetching citations for paper ID:', paper.id);
    const citationsResponse = await openAlexService.fetchCitations(paper.id);
    console.log('Citations response received:', citationsResponse);
    
    // Step 3: Update progress
    self.postMessage({
      type: 'progress/update',
      payload: { message: 'Processing paper data...' }
    });
    
    // Step 4: Build initial graph data structure
    const graphData = buildInitialGraph(paper, citationsResponse.results);
    
    // Step 5: Send complete graph data to main thread
    self.postMessage({
      type: 'graph/setState',
      payload: { data: graphData }
    });
    
    // Step 6: Update app status to show data is ready
    self.postMessage({
      type: 'app/setStatus',
      payload: { state: 'enriching', message: null }
    });
    
    console.log('Initial graph build complete');
    
  } catch (error) {
    console.error('Error in processMasterPaper:', error);
    throw error;
  }
}

function buildInitialGraph(masterPaper: PaperResult, citations: any[]) {
  console.log('Building initial graph with master paper and', citations.length, 'citations');
  
  const papers: Record<string, any> = {};
  const authors: Record<string, any> = {};
  const institutions: Record<string, any> = {};
  const authorships: Record<string, any> = {};
  const paper_relationships: any[] = [];
  const external_id_index: Record<string, string> = {};
  
  // Process master paper
  const masterPaperUid = generateShortUid();
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
  
  // Index master paper by OpenAlex ID
  external_id_index[`openalex:${masterPaper.id}`] = masterPaperUid;
  
  console.log('Master paper processed:', papers[masterPaperUid]);
  
  // Process citations (1st degree)
  citations.forEach((citation, index) => {
    console.log(`Processing citation ${index + 1}:`, citation);
    
    const citationUid = generateShortUid();
    papers[citationUid] = {
      short_uid: citationUid,
      title: citation.title || citation.display_name || 'Untitled',
      publication_year: citation.publication_year,
      publication_date: citation.publication_date,
      location: citation.primary_location?.source?.display_name || null,
      abstract: citation.abstract_inverted_index ? reconstructAbstract(citation.abstract_inverted_index) : null,
      fwci: citation.fwci || null,
      cited_by_count: citation.cited_by_count || 0,
      type: citation.type || 'article',
      language: citation.language || null,
      keywords: citation.keywords ? extractKeywords(citation.keywords) : [],
      best_oa_url: citation.best_oa_location?.pdf_url || null,
      oa_status: citation.open_access?.oa_status || null,
      is_stub: false
    };
    
    // Index citation by OpenAlex ID
    external_id_index[`openalex:${citation.id}`] = citationUid;
    
    // Index by DOI if present
    if (citation.doi) {
      const normalizedDoi = normalizeDoi(citation.doi);
      if (normalizedDoi) {
        external_id_index[`doi:${normalizedDoi}`] = citationUid;
      }
    }
    
    // Create relationship: citation cites master paper
    paper_relationships.push({
      source_short_uid: citationUid,
      target_short_uid: masterPaperUid,
      relationship_type: 'cites'
    });
    
    console.log(`Citation ${index + 1} processed:`, papers[citationUid]);
  });
  
  console.log('Graph data built:', {
    papers: Object.keys(papers).length,
    authors: Object.keys(authors).length,
    institutions: Object.keys(institutions).length,
    authorships: Object.keys(authorships).length,
    paper_relationships: paper_relationships.length,
    external_id_index: Object.keys(external_id_index).length
  });
  
  return {
    papers,
    authors,
    institutions,
    authorships,
    paper_relationships,
    external_id_index
  };
}
