
import { reconstructAbstract, extractKeywords, normalizeDoi, generateShortUid } from '../utils/data-transformers';
import type { Paper, Author, Institution, Authorship, PaperRelationship, ExternalIdType } from '../store/knowledge-graph-store';

interface Message {
  type: string;
  payload: object;
}

class GraphWorker {
  private papers: Record<string, Paper> = {};
  private authors: Record<string, Author> = {};
  private institutions: Record<string, Institution> = {};
  private authorships: Record<string, Authorship> = {};
  private paper_relationships: PaperRelationship[] = [];
  private external_id_index: Record<string, string> = {};

  async processMasterPaper(masterPaper: any) {
    try {
      this.postMessage({
        type: 'progress/update',
        payload: { message: 'Processing master paper...' }
      });

      // Step 1: Create the master paper record
      const masterPaperUid = this.createPaperFromOpenAlex(masterPaper, false);

      // Step 2: Fetch 1st degree citations from OpenAlex
      await this.fetchFirstDegreeCitations(masterPaper.id, masterPaperUid);

      // Step 3: Fetch Semantic Scholar data for enrichment and discovery
      if (masterPaper.doi) {
        await this.fetchSemanticScholarData(masterPaper.doi, masterPaperUid);
      }

      // Send initial graph to main thread
      this.postMessage({
        type: 'graph/setState',
        payload: {
          data: {
            papers: this.papers,
            authors: this.authors,
            institutions: this.institutions,
            authorships: this.authorships,
            paper_relationships: this.paper_relationships,
            external_id_index: this.external_id_index
          }
        }
      });

      // Start Phase B - Background enrichment
      this.postMessage({
        type: 'app/setStatus',
        payload: { state: 'enriching', message: 'Enriching data in background...' }
      });

    } catch (error) {
      this.postMessage({
        type: 'error/fatal',
        payload: { message: `Failed to process master paper: ${error.message}` }
      });
    }
  }

  private createPaperFromOpenAlex(paperData: any, isStub: boolean): string {
    const paperUid = generateShortUid();
    
    // Create paper record
    this.papers[paperUid] = {
      short_uid: paperUid,
      title: paperData.title || paperData.display_name || 'Untitled',
      publication_year: paperData.publication_year,
      publication_date: paperData.publication_date,
      location: paperData.primary_location?.source?.display_name || null,
      abstract: reconstructAbstract(paperData.abstract_inverted_index),
      fwci: paperData.fwci || null,
      cited_by_count: paperData.cited_by_count || 0,
      type: paperData.type || 'article',
      language: paperData.language || null,
      keywords: extractKeywords(paperData.keywords),
      best_oa_url: paperData.best_oa_location?.pdf_url || null,
      oa_status: paperData.open_access?.oa_status || null,
      is_stub: isStub
    };

    // Add external IDs
    if (paperData.id) {
      this.external_id_index[`openalex:${paperData.id}`] = paperUid;
    }
    if (paperData.doi) {
      const normalizedDoi = normalizeDoi(paperData.doi);
      if (normalizedDoi) {
        this.external_id_index[`doi:${normalizedDoi}`] = paperUid;
      }
    }

    // Process authorships
    if (paperData.authorships) {
      paperData.authorships.forEach((authorship: any) => {
        const authorUid = this.createAuthorFromOpenAlex(authorship.author, false);
        const institutionUids = authorship.institutions.map((inst: any) => 
          this.createInstitutionFromOpenAlex(inst)
        );

        // Create authorship record
        const authorshipKey = `${paperUid}_${authorUid}`;
        this.authorships[authorshipKey] = {
          paper_short_uid: paperUid,
          author_short_uid: authorUid,
          author_position: authorship.author_position || 0,
          is_corresponding: authorship.is_corresponding || false,
          raw_author_name: authorship.raw_author_name,
          institution_uids: institutionUids
        };
      });
    }

    return paperUid;
  }

  private createAuthorFromOpenAlex(authorData: any, isStub: boolean): string {
    // Check if author already exists
    const existingUid = this.external_id_index[`openalex:${authorData.id}`];
    if (existingUid) {
      return existingUid;
    }

    const authorUid = generateShortUid();
    
    this.authors[authorUid] = {
      short_uid: authorUid,
      clean_name: authorData.display_name || 'Unknown Author',
      orcid: authorData.orcid || null,
      is_stub: isStub
    };

    // Add external ID
    this.external_id_index[`openalex:${authorData.id}`] = authorUid;

    return authorUid;
  }

  private createInstitutionFromOpenAlex(institutionData: any): string {
    // Check if institution already exists
    const existingUid = this.external_id_index[`openalex:${institutionData.id}`];
    if (existingUid) {
      return existingUid;
    }

    const institutionUid = generateShortUid();
    
    this.institutions[institutionUid] = {
      short_uid: institutionUid,
      ror_id: institutionData.ror || null,
      display_name: institutionData.display_name || 'Unknown Institution',
      country_code: institutionData.country_code || null,
      type: institutionData.type || null
    };

    // Add external ID
    this.external_id_index[`openalex:${institutionData.id}`] = institutionUid;

    return institutionUid;
  }

  private async fetchFirstDegreeCitations(masterPaperId: string, masterPaperUid: string) {
    this.postMessage({
      type: 'progress/update',
      payload: { message: 'Fetching 1st degree citations...' }
    });

    const openAlexId = masterPaperId.replace('https://openalex.org/', '');
    const url = `https://api.openalex.org/works?filter=cites:${openAlexId}&per_page=200&select=id,ids,doi,title,publication_year,publication_date,type,authorships,fwci,cited_by_count,abstract_inverted_index,primary_location,referenced_works,related_works`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status}`);
    }

    const data = await response.json();
    
    data.results.forEach((paper: any) => {
      const paperUid = this.createPaperFromOpenAlex(paper, false);
      
      // Create citation relationship
      this.paper_relationships.push({
        source_short_uid: paperUid,
        target_short_uid: masterPaperUid,
        relationship_type: 'cites'
      });

      // Create stub papers for referenced and related works
      paper.referenced_works?.forEach((refWorkId: string) => {
        this.createStubPaper(refWorkId, paperUid, 'cites');
      });

      paper.related_works?.forEach((relWorkId: string) => {
        this.createStubPaper(relWorkId, paperUid, 'similar');
      });
    });
  }

  private async fetchSemanticScholarData(doi: string, masterPaperUid: string) {
    this.postMessage({
      type: 'progress/update',
      payload: { message: 'Fetching Semantic Scholar data...' }
    });

    const normalizedDoi = normalizeDoi(doi);
    if (!normalizedDoi) return;

    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${normalizedDoi}?fields=paperId,corpusId,externalIds,openAccessPdf,citations,citations.externalIds,citations.title,citations.year,citations.citationCount,citations.abstract,citations.venue,citations.authors,references,references.externalIds,references.title,references.year,references.citationCount,references.abstract,references.venue,references.authors`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.log('Paper not found in Semantic Scholar');
          return;
        }
        throw new Error(`Semantic Scholar API error: ${response.status}`);
      }

      const data = await response.json();

      // Enrich master paper with additional external IDs
      if (data.paperId) {
        this.external_id_index[`ss:${data.paperId}`] = masterPaperUid;
      }
      if (data.corpusId) {
        this.external_id_index[`CorpusId:${data.corpusId}`] = masterPaperUid;
      }

      // Update best_oa_url if null
      if (data.openAccessPdf?.url && !this.papers[masterPaperUid].best_oa_url) {
        this.papers[masterPaperUid].best_oa_url = data.openAccessPdf.url;
      }

      // Process citations and references as stub papers
      data.citations?.forEach((citation: any) => {
        this.createStubPaperFromSemanticScholar(citation, masterPaperUid, 'cites', true);
      });

      data.references?.forEach((reference: any) => {
        this.createStubPaperFromSemanticScholar(reference, masterPaperUid, 'cites', false);
      });

    } catch (error) {
      console.warn('Failed to fetch Semantic Scholar data:', error.message);
    }
  }

  private createStubPaper(openAlexId: string, sourcePaperUid: string, relationshipType: 'cites' | 'similar') {
    // Check if paper already exists
    const existingUid = this.external_id_index[`openalex:${openAlexId}`];
    if (existingUid) {
      // Create relationship if it doesn't exist
      const relationshipExists = this.paper_relationships.some(rel => 
        rel.source_short_uid === sourcePaperUid && 
        rel.target_short_uid === existingUid && 
        rel.relationship_type === relationshipType
      );
      
      if (!relationshipExists) {
        this.paper_relationships.push({
          source_short_uid: sourcePaperUid,
          target_short_uid: existingUid,
          relationship_type: relationshipType
        });
      }
      return;
    }

    // Create minimal stub paper
    const paperUid = generateShortUid();
    this.papers[paperUid] = {
      short_uid: paperUid,
      title: 'Unknown Title',
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

    // Add external ID
    this.external_id_index[`openalex:${openAlexId}`] = paperUid;

    // Create relationship
    this.paper_relationships.push({
      source_short_uid: sourcePaperUid,
      target_short_uid: paperUid,
      relationship_type: relationshipType
    });
  }

  private createStubPaperFromSemanticScholar(paperData: any, masterPaperUid: string, relationshipType: 'cites', isCitation: boolean) {
    // Check if paper already exists by DOI or SS ID
    let existingUid = null;
    if (paperData.externalIds?.DOI) {
      const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
      if (normalizedDoi) {
        existingUid = this.external_id_index[`doi:${normalizedDoi}`];
      }
    }
    if (!existingUid && paperData.paperId) {
      existingUid = this.external_id_index[`ss:${paperData.paperId}`];
    }

    if (existingUid) {
      // Create relationship
      const sourceUid = isCitation ? existingUid : masterPaperUid;
      const targetUid = isCitation ? masterPaperUid : existingUid;
      
      this.paper_relationships.push({
        source_short_uid: sourceUid,
        target_short_uid: targetUid,
        relationship_type: relationshipType
      });
      return;
    }

    // Create new stub paper
    const paperUid = generateShortUid();
    this.papers[paperUid] = {
      short_uid: paperUid,
      title: paperData.title || 'Unknown Title',
      publication_year: paperData.year,
      publication_date: null,
      location: paperData.venue || null,
      abstract: paperData.abstract || null,
      fwci: null,
      cited_by_count: paperData.citationCount || 0,
      type: 'article',
      language: null,
      keywords: [],
      best_oa_url: paperData.openAccessPdf?.url || null,
      oa_status: null,
      is_stub: true
    };

    // Add external IDs
    if (paperData.paperId) {
      this.external_id_index[`ss:${paperData.paperId}`] = paperUid;
    }
    if (paperData.externalIds?.DOI) {
      const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
      if (normalizedDoi) {
        this.external_id_index[`doi:${normalizedDoi}`] = paperUid;
      }
    }

    // Create stub authors
    paperData.authors?.forEach((authorData: any) => {
      if (authorData.authorId && authorData.name) {
        const authorUid = this.createStubAuthor(authorData);
        
        // Create authorship
        const authorshipKey = `${paperUid}_${authorUid}`;
        this.authorships[authorshipKey] = {
          paper_short_uid: paperUid,
          author_short_uid: authorUid,
          author_position: 0,
          is_corresponding: false,
          raw_author_name: authorData.name,
          institution_uids: []
        };
      }
    });

    // Create relationship
    const sourceUid = isCitation ? paperUid : masterPaperUid;
    const targetUid = isCitation ? masterPaperUid : paperUid;
    
    this.paper_relationships.push({
      source_short_uid: sourceUid,
      target_short_uid: targetUid,
      relationship_type: relationshipType
    });
  }

  private createStubAuthor(authorData: any): string {
    // Check if author already exists
    const existingUid = this.external_id_index[`ss:${authorData.authorId}`];
    if (existingUid) {
      return existingUid;
    }

    const authorUid = generateShortUid();
    this.authors[authorUid] = {
      short_uid: authorUid,
      clean_name: authorData.name || 'Unknown Author',
      orcid: null,
      is_stub: true
    };

    // Add external ID
    this.external_id_index[`ss:${authorData.authorId}`] = authorUid;

    return authorUid;
  }

  private postMessage(message: Message) {
    self.postMessage(message);
  }
}

const worker = new GraphWorker();

self.onmessage = function(e) {
  const { type, payload } = e.data;
  
  switch (type) {
    case 'graph/processMasterPaper':
      worker.processMasterPaper(payload.paper);
      break;
    default:
      console.warn('Unknown message type:', type);
  }
};
