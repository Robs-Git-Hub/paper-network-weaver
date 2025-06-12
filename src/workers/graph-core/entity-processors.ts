
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
  utils: UtilityFunctions // Added utils to post messages
): Promise<string> {
  let paperUid: string | null = null;

  // Step 1: Find an existing paper using any available ID.
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      paperUid = findByExternalId('doi', normalizedDoi);
    }
  }
  if (!paperUid && paperData.id) {
    paperUid = findByExternalId('openalex', paperData.id);
  }

  // Step 2: If no paper was found, create a new one.
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
    // --- STREAMING CHANGE: Send the new paper immediately ---
    utils.postMessage('graph/addPaper', { paper: newPaper });
  } else {
    // If we are "upgrading" a stub to a full paper
    if (!isStub && papers[paperUid].is_stub) {
      papers[paperUid].is_stub = false;
      // Note: an update message can be sent if needed
      // utils.postMessage('papers/updateOne', { id: paperUid, changes: { is_stub: false } });
    }
  }

  // Step 3: Ensure ALL available IDs are in the index and streamed.
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

  // Step 4: Process authorships for non-stubs.
  if (!isStub && paperData.authorships) {
    for (let i = 0; i < paperData.authorships.length; i++) {
      const authorship = paperData.authorships[i];
      // Pass utils down to the next processor
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
            // Pass utils down
            const instUid = await processOpenAlexInstitution(inst, institutions, utils);
            newAuthorship.institution_uids.push(instUid);
          }
        }
        
        authorships[authorshipKey] = newAuthorship;
        // --- STREAMING CHANGE: Send the new authorship immediately ---
        utils.postMessage('graph/addAuthorship', { authorship: newAuthorship });
      }
    }
  }

  return paperUid;
}

export async function processOpenAlexAuthor(
  authorData: any, 
  isStub = false,
  authors: Record<string, Author>,
  utils: UtilityFunctions // Added utils
): Promise<string> {
  if (authorData.id) {
    const cleanId = normalizeOpenAlexId(authorData.id);
    const existingUid = findByExternalId('openalex_author', cleanId);
    if (existingUid) return existingUid;
  }

  const authorUid = generateShortUid();
  
  const newAuthor: Author = {
    short_uid: authorUid,
    clean_name: authorData.display_name || 'Unknown Author',
    orcid: authorData.orcid || null,
    is_stub: isStub
  };

  authors[authorUid] = newAuthor;
  utils.postMessage('graph/addAuthor', { author: newAuthor });

  if (authorData.id) {
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
  utils: UtilityFunctions // Added utils
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
    utils.postMessage('graph/setExternalId', { key, uid: instUid });
  }

  return instUid;
}