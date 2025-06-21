
import { reconstructAbstract, extractKeywords, normalizeDoi, generateShortUid } from '../../utils/data-transformers';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import { addToExternalIndex, findByExternalId } from './utils';
import type { Paper, Author, Institution, Authorship, UtilityFunctions, OpenAlexPaper } from './types';

// Entity processing functions

export async function processOpenAlexPaper(
  paperData: OpenAlexPaper, 
  isStub = false,
  papers: Record<string, Paper>,
  authors: Record<string, Author>,
  institutions: Record<string, Institution>,
  authorships: Record<string, Authorship>,
  utils: UtilityFunctions
): Promise<string> {
  let paperUid: string | null = null;

  // Step 1: Find the internal UID from the external ID index, if it exists.
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      paperUid = findByExternalId('doi', normalizedDoi);
    }
  }
  if (!paperUid && paperData.id) {
    paperUid = findByExternalId('openalex', normalizeOpenAlexId(paperData.id));
  }

  // Step 2: Get the actual paper object from our state, if it exists.
  const existingPaper = paperUid ? papers[paperUid] : null;

  if (!existingPaper) {
    // CREATE NEW: This branch runs if the paper is completely new.
    paperUid = paperUid || generateShortUid();
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
    };
    papers[paperUid] = newPaper;
    utils.postMessage('graph/addPaper', { paper: newPaper });
  } else {
    // UPDATE EXISTING: This branch runs if the paper already exists in our state.
    paperUid = existingPaper.short_uid;

    // --- NEW DIAGNOSTIC STEP ---
    console.log(`[DIAGNOSTIC] Checking paper for hydration. UID: ${paperUid}, Title: "${existingPaper.title}". isStub param: ${isStub}. existingPaper.is_stub: ${existingPaper.is_stub}`);
    // --- END DIAGNOSTIC STEP ---

    if (!isStub && existingPaper.is_stub) {
      const changes: Partial<Paper> = {
        is_stub: false,
        title: paperData.title || paperData.display_name || existingPaper.title,
        publication_year: paperData.publication_year || existingPaper.publication_year,
        publication_date: paperData.publication_date || existingPaper.publication_date,
        location: paperData.primary_location?.source?.display_name || existingPaper.location,
        abstract: reconstructAbstract(paperData.abstract_inverted_index) || existingPaper.abstract,
        fwci: paperData.fwci || existingPaper.fwci,
        cited_by_count: paperData.cited_by_count || existingPaper.cited_by_count,
        type: paperData.type || existingPaper.type,
        language: paperData.language || existingPaper.language,
        keywords: extractKeywords(paperData.keywords).length > 0 ? extractKeywords(paperData.keywords) : existingPaper.keywords,
        best_oa_url: paperData.open_access?.oa_url || existingPaper.best_oa_url,
        oa_status: paperData.open_access?.oa_status || existingPaper.oa_status,
      };
      papers[paperUid] = { ...existingPaper, ...changes };
      utils.postMessage('papers/updateOne', { id: paperUid, changes });
    }
  }
  
  if (!paperUid) {
    throw new Error("Critical error: paperUid is null after processing.");
  }

  // Add entries to the external ID index
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

  // Process authorships for full (non-stub) papers
  if (!isStub && paperData.authorships) {
    for (let i = 0; i < paperData.authorships.length; i++) {
      const authorship = paperData.authorships[i];
      if (!authorship.author) continue;
      
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
    utils.postMessage('graph/setExternalId', { key, uid: instUid });
  }

  return instUid;
}