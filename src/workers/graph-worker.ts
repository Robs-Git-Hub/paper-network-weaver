import { openAlexService } from '../services/openAlex';
import { semanticScholarService } from '../services/semanticScholar';
import { fetchWithRetry } from '../utils/api-helpers';
import { reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';

// Stub creation threshold - only create stubs for papers referenced N+ times
const STUB_CREATION_THRESHOLD = 3;

// Interfaces
interface WorkerMessage {
  type: string;
  payload: any;
}

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

// Global state
let papers: Record<string, Paper> = {};
let authors: Record<string, Author> = {};
let institutions: Record<string, Institution> = {};
let authorships: Record<string, Authorship> = {};
let paper_relationships: PaperRelationship[] = [];
let external_id_index: Record<string, string> = {};

function postMessage(type: string, payload: any) {
  self.postMessage({ type, payload });
}

function generateShortUid(prefix: string, counter: number): string {
  return `${prefix}_${counter.toString().padStart(6, '0')}`;
}

function addToExternalIdIndex(entityType: 'paper' | 'author' | 'institution', shortUid: string, externalId: string, idType: string) {
  const key = `${idType}:${externalId}`;
  external_id_index[key] = shortUid;
  console.log(`[Worker] Added to external_id_index: ${key} -> ${shortUid}`);
}

function findEntityByExternalId(externalId: string, idType: string): string | null {
  const key = `${idType}:${externalId}`;
  return external_id_index[key] || null;
}

function deduplicateRelationships(relationships: PaperRelationship[]): PaperRelationship[] {
  const seen = new Set<string>();
  return relationships.filter(rel => {
    const key = `${rel.source_short_uid}:${rel.target_short_uid}:${rel.relationship_type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function processMasterPaper(masterPaperData: any) {
  try {
    console.log('[Worker] Starting Phase A: Processing master paper and building initial graph');
    
    // Step 1: Create the master paper entity
    const masterPaperShortUid = generateShortUid('p', 1);
    const masterPaperTitle = masterPaperData.title || masterPaperData.display_name || 'Untitled';
    
    papers[masterPaperShortUid] = {
      short_uid: masterPaperShortUid,
      title: masterPaperTitle,
      publication_year: masterPaperData.publication_year,
      publication_date: null,
      location: masterPaperData.primary_location?.source?.display_name || null,
      abstract: null,
      fwci: null,
      cited_by_count: masterPaperData.cited_by_count || 0,
      type: 'article',
      language: null,
      keywords: [],
      best_oa_url: null,
      oa_status: null,
      is_stub: false
    };

    // Add master paper to external ID index
    if (masterPaperData.id) {
      const openAlexId = masterPaperData.id.replace('https://openalex.org/', '');
      addToExternalIdIndex('paper', masterPaperShortUid, openAlexId, 'openalex');
    }
    if (masterPaperData.doi) {
      const cleanDoi = normalizeDoi(masterPaperData.doi);
      if (cleanDoi) {
        addToExternalIdIndex('paper', masterPaperShortUid, cleanDoi, 'doi');
      }
    }

    console.log(`[Worker] Created master paper: ${masterPaperShortUid} - "${masterPaperTitle}"`);

    // Step 2: Fetch first-degree citations
    postMessage('progress/update', { message: 'Fetching first-degree citations...' });
    
    const openAlexId = masterPaperData.id.replace('https://openalex.org/', '');
    console.log(`[Worker] Fetching citations for OpenAlex ID: ${openAlexId}`);
    
    const citationsResponse = await openAlexService.fetchCitations(openAlexId);
    console.log(`[Worker] Received ${citationsResponse.results.length} first-degree citations`);

    let paperCounter = 2; // Start from 2 since master paper is 1
    let authorCounter = 1;
    let institutionCounter = 1;

    // Step 3: Process first-degree citations and collect referenced works
    const referencedWorksFrequency = new Map<string, number>();
    const relatedWorksFrequency = new Map<string, number>();

    for (const citation of citationsResponse.results) {
      // Create paper entity for this first-degree citation
      const paperShortUid = generateShortUid('p', paperCounter++);
      const paperTitle = citation.title || citation.display_name || 'Untitled';
      
      papers[paperShortUid] = {
        short_uid: paperShortUid,
        title: paperTitle,
        publication_year: citation.publication_year,
        publication_date: citation.publication_date,
        location: citation.primary_location?.source?.display_name || null,
        abstract: reconstructAbstract(citation.abstract_inverted_index),
        fwci: citation.fwci,
        cited_by_count: citation.cited_by_count || 0,
        type: citation.type || 'article',
        language: citation.language,
        keywords: extractKeywords(citation.keywords),
        best_oa_url: citation.best_oa_location?.pdf_url || citation.best_oa_location?.landing_page_url || null,
        oa_status: citation.open_access?.oa_status || null,
        is_stub: false
      };

      // Add to external ID index
      if (citation.id) {
        const openAlexId = citation.id.replace('https://openalex.org/', '');
        addToExternalIdIndex('paper', paperShortUid, openAlexId, 'openalex');
      }
      if (citation.doi) {
        const cleanDoi = normalizeDoi(citation.doi);
        if (cleanDoi) {
          addToExternalIdIndex('paper', paperShortUid, cleanDoi, 'doi');
        }
      }

      // Create relationship: this citation cites the master paper
      paper_relationships.push({
        source_short_uid: paperShortUid,
        target_short_uid: masterPaperShortUid,
        relationship_type: 'cites'
      });

      // Collect referenced works for frequency analysis
      if (citation.referenced_works && Array.isArray(citation.referenced_works)) {
        for (const refWorkId of citation.referenced_works) {
          const currentCount = referencedWorksFrequency.get(refWorkId) || 0;
          referencedWorksFrequency.set(refWorkId, currentCount + 1);
        }
      }

      // Collect related works for frequency analysis
      if (citation.related_works && Array.isArray(citation.related_works)) {
        for (const relWorkId of citation.related_works) {
          const currentCount = relatedWorksFrequency.get(relWorkId) || 0;
          relatedWorksFrequency.set(relWorkId, currentCount + 1);
        }
      }

      // Process authors and institutions for this paper
      if (citation.authorships && Array.isArray(citation.authorships)) {
        for (let i = 0; i < citation.authorships.length; i++) {
          const authorship = citation.authorships[i];
          
          // Create or find author
          let authorShortUid = null;
          if (authorship.author?.id) {
            const openAlexAuthorId = authorship.author.id.replace('https://openalex.org/', '');
            authorShortUid = findEntityByExternalId(openAlexAuthorId, 'openalex_author');
          }
          
          if (!authorShortUid) {
            authorShortUid = generateShortUid('a', authorCounter++);
            authors[authorShortUid] = {
              short_uid: authorShortUid,
              clean_name: authorship.author?.display_name || authorship.raw_author_name || 'Unknown Author',
              orcid: authorship.author?.orcid || null,
              is_stub: false
            };
            
            if (authorship.author?.id) {
              const openAlexAuthorId = authorship.author.id.replace('https://openalex.org/', '');
              addToExternalIdIndex('author', authorShortUid, openAlexAuthorId, 'openalex_author');
            }
          }

          // Create authorship record
          const institutionUids: string[] = [];
          if (authorship.institutions && Array.isArray(authorship.institutions)) {
            for (const institution of authorship.institutions) {
              let institutionShortUid = null;
              if (institution.id) {
                const openAlexInstitutionId = institution.id.replace('https://openalex.org/', '');
                institutionShortUid = findEntityByExternalId(openAlexInstitutionId, 'openalex_institution');
              }
              
              if (!institutionShortUid) {
                institutionShortUid = generateShortUid('i', institutionCounter++);
                institutions[institutionShortUid] = {
                  short_uid: institutionShortUid,
                  ror_id: institution.ror || null,
                  display_name: institution.display_name || 'Unknown Institution',
                  country_code: institution.country_code || null,
                  type: institution.type || null
                };
                
                if (institution.id) {
                  const openAlexInstitutionId = institution.id.replace('https://openalex.org/', '');
                  addToExternalIdIndex('institution', institutionShortUid, openAlexInstitutionId, 'openalex_institution');
                }
              }
              
              institutionUids.push(institutionShortUid);
            }
          }

          const authorshipKey = `${paperShortUid}_${authorShortUid}`;
          authorships[authorshipKey] = {
            paper_short_uid: paperShortUid,
            author_short_uid: authorShortUid,
            author_position: i + 1,
            is_corresponding: authorship.is_corresponding || false,
            raw_author_name: authorship.raw_author_name,
            institution_uids: institutionUids
          };
        }
      }
    }

    // Step 4: Apply stub creation threshold and create stub papers
    console.log(`[Worker] Applying stub creation threshold (N=${STUB_CREATION_THRESHOLD})`);
    console.log(`[Worker] Found ${referencedWorksFrequency.size} unique referenced works`);
    console.log(`[Worker] Found ${relatedWorksFrequency.size} unique related works`);

    let stubsCreated = 0;
    
    // Create stubs for frequently referenced works
    for (const [workId, frequency] of referencedWorksFrequency.entries()) {
      if (frequency >= STUB_CREATION_THRESHOLD) {
        const openAlexId = workId.replace('https://openalex.org/', '');
        let stubShortUid = findEntityByExternalId(openAlexId, 'openalex');
        
        if (!stubShortUid) {
          stubShortUid = generateShortUid('p', paperCounter++);
          papers[stubShortUid] = {
            short_uid: stubShortUid,
            title: 'Referenced Work (Stub)',
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
          
          addToExternalIdIndex('paper', stubShortUid, openAlexId, 'openalex');
          stubsCreated++;
        }
        
        // Create relationships from citing papers to this stub
        for (const citation of citationsResponse.results) {
          if (citation.referenced_works && citation.referenced_works.includes(workId)) {
            const citingPaperOpenAlexId = citation.id.replace('https://openalex.org/', '');
            const citingPaperShortUid = findEntityByExternalId(citingPaperOpenAlexId, 'openalex');
            
            if (citingPaperShortUid) {
              paper_relationships.push({
                source_short_uid: citingPaperShortUid,
                target_short_uid: stubShortUid,
                relationship_type: 'cites'
              });
            }
          }
        }
      }
    }

    // Create stubs for frequently related works
    for (const [workId, frequency] of relatedWorksFrequency.entries()) {
      if (frequency >= STUB_CREATION_THRESHOLD) {
        const openAlexId = workId.replace('https://openalex.org/', '');
        let stubShortUid = findEntityByExternalId(openAlexId, 'openalex');
        
        if (!stubShortUid) {
          stubShortUid = generateShortUid('p', paperCounter++);
          papers[stubShortUid] = {
            short_uid: stubShortUid,
            title: 'Related Work (Stub)',
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
          
          addToExternalIdIndex('paper', stubShortUid, openAlexId, 'openalex');
          stubsCreated++;
        }
        
        // Create relationships from papers to this related work
        for (const citation of citationsResponse.results) {
          if (citation.related_works && citation.related_works.includes(workId)) {
            const relatedPaperOpenAlexId = citation.id.replace('https://openalex.org/', '');
            const relatedPaperShortUid = findEntityByExternalId(relatedPaperOpenAlexId, 'openalex');
            
            if (relatedPaperShortUid) {
              paper_relationships.push({
                source_short_uid: relatedPaperShortUid,
                target_short_uid: stubShortUid,
                relationship_type: 'similar'
              });
            }
          }
        }
      }
    }

    // Deduplicate relationships
    paper_relationships = deduplicateRelationships(paper_relationships);

    const totalPapers = Object.keys(papers).length;
    const totalAuthors = Object.keys(authors).length;
    const totalInstitutions = Object.keys(institutions).length;
    const totalRelationships = paper_relationships.length;

    console.log(`[Worker] Phase A complete. Final counts:`);
    console.log(`[Worker] - Papers: ${totalPapers} (${stubsCreated} stubs created with threshold N=${STUB_CREATION_THRESHOLD})`);
    console.log(`[Worker] - Authors: ${totalAuthors}`);
    console.log(`[Worker] - Institutions: ${totalInstitutions}`);
    console.log(`[Worker] - Relationships: ${totalRelationships}`);

    // Send the built graph to the main thread
    postMessage('graph/setState', {
      data: JSON.stringify({
        papers,
        authors,
        institutions,
        authorships,
        paper_relationships,
        external_id_index
      })
    });

    postMessage('app/setStatus', { state: 'enriching', message: 'Initial graph built successfully' });
    
    // Start Phase B: Background enrichment
    await startBackgroundEnrichment(masterPaperShortUid);

  } catch (error) {
    console.error('[Worker] Error in Phase A:', error);
    postMessage('error/fatal', { 
      message: `Failed to build initial graph: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
}

async function startBackgroundEnrichment(masterPaperShortUid: string) {
  try {
    console.log('[Worker] Starting Phase B: Background enrichment');
    postMessage('progress/update', { message: 'Enriching master paper details...' });

    // Find the master paper's OpenAlex ID for detailed fetch
    let masterOpenAlexId = null;
    for (const [key, shortUid] of Object.entries(external_id_index)) {
      if (shortUid === masterPaperShortUid && key.startsWith('openalex:')) {
        masterOpenAlexId = key.replace('openalex:', '');
        break;
      }
    }

    if (masterOpenAlexId) {
      console.log(`[Worker] Fetching detailed data for master paper: ${masterOpenAlexId}`);
      const masterDetails = await openAlexService.fetchPaperDetails(`https://openalex.org/${masterOpenAlexId}`);
      
      if (masterDetails) {
        // Update master paper with rich details
        const existingPaper = papers[masterPaperShortUid];
        papers[masterPaperShortUid] = {
          ...existingPaper,
          abstract: reconstructAbstract(masterDetails.abstract_inverted_index) || existingPaper.abstract,
          fwci: masterDetails.fwci || existingPaper.fwci,
          keywords: extractKeywords(masterDetails.keywords) || existingPaper.keywords,
          best_oa_url: masterDetails.best_oa_location?.pdf_url || masterDetails.best_oa_location?.landing_page_url || existingPaper.best_oa_url,
          oa_status: masterDetails.open_access?.oa_status || existingPaper.oa_status,
          language: masterDetails.language || existingPaper.language,
          publication_date: masterDetails.publication_date || existingPaper.publication_date
        };

        console.log('[Worker] Master paper enriched with detailed data');
        
        // Send updated data to main thread
        postMessage('graph/setState', {
          data: JSON.stringify({
            papers,
            authors,
            institutions,
            authorships,
            paper_relationships,
            external_id_index
          })
        });
      }
    }

    postMessage('app/setStatus', { state: 'ready', message: 'Graph ready for analysis' });
    console.log('[Worker] Phase B complete: Background enrichment finished');

  } catch (error) {
    console.error('[Worker] Error in Phase B:', error);
    postMessage('warning/nonCritical', { 
      message: `Background enrichment failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
    postMessage('app/setStatus', { state: 'ready', message: 'Graph ready (enrichment incomplete)' });
  }
}

// Message handler
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;
  console.log(`[Worker] Received message: ${type}`, payload);

  switch (type) {
    case 'graph/processMasterPaper':
      processMasterPaper(payload.paper);
      break;
    default:
      console.warn(`[Worker] Unknown message type: ${type}`);
  }
};

console.log('[Worker] Graph worker initialized and ready');
