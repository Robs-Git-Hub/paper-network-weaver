
import type { Paper, PaperRelationship } from '@/store/knowledge-graph-store';

export interface CategorizedCitations {
  firstDegree: Paper[];
  secondDegree: Paper[];
  referencedByFirstDegree: Paper[];
}

export function categorizeCitations(
  papers: Record<string, Paper>,
  paperRelationships: PaperRelationship[],
  masterPaperUid: string
): CategorizedCitations {
  // Get all non-stub papers excluding the master paper
  const allCitationPapers = Object.values(papers).filter(
    paper => !paper.is_stub && paper.short_uid !== masterPaperUid
  );

  // Find 1st degree citations - papers that cite the master paper
  const firstDegreeRelationships = paperRelationships.filter(
    rel => rel.relationship_type === 'cites' && rel.target_short_uid === masterPaperUid
  );
  const firstDegreeUids = new Set(firstDegreeRelationships.map(rel => rel.source_short_uid));
  const firstDegree = allCitationPapers.filter(paper => firstDegreeUids.has(paper.short_uid));

  // Find 2nd degree citations - papers that cite 1st degree papers
  const secondDegreeRelationships = paperRelationships.filter(
    rel => rel.relationship_type === 'cites' && 
           firstDegreeUids.has(rel.target_short_uid) &&
           rel.source_short_uid !== masterPaperUid
  );
  const secondDegreeUids = new Set(secondDegreeRelationships.map(rel => rel.source_short_uid));
  const secondDegree = allCitationPapers.filter(paper => secondDegreeUids.has(paper.short_uid));

  // Find referenced by 1st degree - papers cited by 1st degree papers
  const referencedByFirstDegreeRelationships = paperRelationships.filter(
    rel => (rel.relationship_type === 'cites' && firstDegreeUids.has(rel.source_short_uid)) ||
           rel.tag === 'referenced_by_1st_degree'
  );
  const referencedByFirstDegreeUids = new Set(
    referencedByFirstDegreeRelationships.map(rel => rel.target_short_uid)
  );
  // Exclude master paper and 1st degree papers from this category
  const referencedByFirstDegree = allCitationPapers.filter(
    paper => referencedByFirstDegreeUids.has(paper.short_uid) && 
             !firstDegreeUids.has(paper.short_uid)
  );

  return {
    firstDegree,
    secondDegree,
    referencedByFirstDegree
  };
}
