
import { reconstructAbstract, extractKeywords, normalizeDoi, generateShortUid } from '../../utils/data-transformers';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import { addToExternalIndex, findByExternalId } from './utils';
import type { Paper, Author, Institution, Authorship, UtilityFunctions } from './types';

// Entity processing functions

export async function processOpenAlexPaper(
  paperData: any, 
  isStub = false,
  papers: Record<string, Paper>,
  authors: Record<string, Author>,
  institutions: Record<string, Institution>,
  authorships: Record<string, Authorship>,
  utils: UtilityFunctions
): Promise<string> {
  let paperUid: string | null = null;

  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      paperUid = findByExternalId('doi', normalizedDoi);
    }
  }
  if (!paperUid && paperData.id) {
    paperUid = findByExternalId('openalex', paperData.id);
  }

  if (!paperUid) {
    paperUid = generateShortUid();
    const newPaper: Paper = {
      short_uid: paperUid,
      title: paperData.title || paperData.display_name || 'Untitled',
      publication_year: paperData.publication_year || null,
      publication_date: paperData.publication_date || null,
      location: paperData.primary_location?.source?.display_name || null,
      abstract: reconstructAbstract(paperData.abstract_inverted_index),
      fwci: paperData.fwci || null,
      cited_by_count: paperData.cited_by_count || 0,
      type: paperData.type || 'article',
      language: paperData.language || null,
      keywords: extractKeywords(paperData.keywords),
      best_oa_url: paperData.open_access?.oa_url || null,
      oa_status: paperData.open_access?.oa_status || null,
      is_stub: isStub,
      relationship_tags: []
    };
    papers[paperUid] = newPaper;
    utils.postMessage('graph/addPaper', { paper: newPaper });
  } else {
    if (!isStub && papers[paperUid].is_stub) {
      papers[paperUid].is_stub = false;
    }
  }

  if (paperData.id) {
    const cleanId = normalizeOpenAlexId(paperData.id);
    const key = `openalex:${cleanId}`;
    if (!findByExternalId('openalex', cleanId)) {
        addToExternalIndex('openalex', cleanId, paperUid);
        utils.postMessage('graph/setExternalId', { key, uid: paperUid });
    }
  }
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      const key = `doi:${normalizedDoi}`;
      if(!findByExternalId('doi', normalizedDoi)) {
          addToExternalIndex('doi', normalizedDoi, paperUid);
          utils.postMessage('graph/setExternalId', { key, uid: paperUid });
      }
    }
  }

  if (!isStub && paperData.authorships) {
    for (let i = 0; i < paperData.authorships.length; i++) {
      const authorship = paperData.authorships[i];
      const authorUid = await processOpenAlexAuthor(authorship.author, isStub, authors, utils);
      
      const authorshipKey = `${paperUid}_${authorUid}`;
      if (!authorships[authorshipKey]) {
        const newAuthorship: Authorship = {
          paper_short_uid: paperUid,
          author_short_uid: authorUid,
          author_position: i,
          is_corresponding: authorship.is_corresponding || false,
          raw_author_name: authorship.raw_author_name || null,
          institution_uids: []
        };
        
        if (authorship.institutions) {
          for (const inst of authorship.institutions) {
            const instUid = await processOpenAlexInstitution(inst, institutions, utils);
            newAuthorship.institution_uids.push(instUid);
          }
        }
        
        authorships[authorshipKey] = newAuthorship;
        utils.postMessage('graph/addAuthorship', { authorship: newAuthorship });
      }
    }
  }

  return paperUid;
}

export async function processSemanticScholarPaper(
  paperData: any,
  utils: UtilityFunctions
): Promise<string> {
  let paperUid: string | null = null;

  const doi = paperData.externalIds?.DOI;
  if (doi) {
    paperUid = findByExternalId('doi', doi);
  }
  if (!paperUid && paperData.paperId) {
    paperUid = findByExternalId('ss', paperData.paperId);
  }

  if (!paperUid) {
    paperUid = generateShortUid();
    const newPaper: Paper = {
      short_uid: paperUid,
      title: paperData.title || 'Untitled',
      publication_year: paperData.year || null,
      publication_date: paperData.year ? `${paperData.year}-01-01` : null,
      location: paperData.venue || null,
      abstract: paperData.abstract || null,
      fwci: null,
      cited_by_count: paperData.citationCount || 0,
      type: 'article',
      language: null,
      keywords: [],
      best_oa_url: paperData.openAccessPdf?.url || null,
      oa_status: paperData.openAccessPdf?.url ? 'green' : 'closed',
      is_stub: true,
      relationship_tags: []
    };
    utils.postMessage('graph/addPaper', { paper: newPaper });
  }

  if (doi) {
    const key = `doi:${doi}`;
    if (!findByExternalId('doi', doi)) {
      utils.addToExternalIndex('doi', doi, paperUid);
      utils.postMessage('graph/setExternalId', { key, uid: paperUid });
    }
  }
  if (paperData.paperId) {
    const key = `ss:${paperData.paperId}`;
    if (!findByExternalId('ss', paperData.paperId)) {
      utils.addToExternalIndex('ss', paperData.paperId, paperUid);
      utils.postMessage('graph/setExternalId', { key, uid: paperUid });
    }
  }
  
  return paperUid;
}

export async function processOpenAlexAuthor(
  authorData: any, 
  isStub = false,
  authors: Record<string, Author>,
  utils: UtilityFunctions
): Promise<string> {
  if (authorData?.id) {
    const cleanId = normalizeOpenAlexId(authorData.id);
    const existingUid = findByExternalId('openalex_author', cleanId);
    if (existingUid) return existingUid;
  }

  const authorUid = generateShortUid();
  
  const newAuthor: Author = {
    short_uid: authorUid,
    clean_name: authorData?.display_name || 'Unknown Author',
    orcid: authorData?.orcid || null,
    is_stub: isStub
  };

  authors[authorUid] = newAuthor;
  utils.postMessage('graph/addAuthor', { author: newAuthor });

  if (authorData?.id) {
    const cleanId = normalizeOpenAlexId(authorData.id);
    const key = `openalex_author:${cleanId}`;
    addToExternalIndex('openalex_author', cleanId, authorUid);
    utils.postMessage('graph/setExternalId', { key, uid: authorUid });
  }

  return authorUid;
}

export async function processOpenAlexInstitution(
  instData: any,
  institutions: Record<string, Institution>,
  utils: UtilityFunctions
): Promise<string> {
  if (instData.id) {
    const cleanId = normalizeOpenAlexId(instData.id);
    const existingUid = findByExternalId('openalex_institution', cleanId);
    if (existingUid) return existingUid;
  }

  const instUid = generateShortUid();
  
  const newInstitution: Institution = {
    short_uid: instUid,
    ror_id: instData.ror || null,
    display_name: instData.display_name || 'Unknown Institution',
    country_code: instData.country_code || null,
    type: instData.type || null
  };

  institutions[instUid] = newInstitution;
  utils.postMessage('graph/addInstitution', { institution: newInstitution });

  if (instData.id) {
    const cleanId = normalizeOpenAlexId(instData.id);
    const key = `openalex_institution:${cleanId}`;
    addToExternalIndex('openalex_institution', cleanId, instUid);
    // --- FIX: Corrected typo from authorUid to instUid ---
    utils.postMessage('graph/setExternalId', { key, uid: instUid });
  }

  return instUid;
}