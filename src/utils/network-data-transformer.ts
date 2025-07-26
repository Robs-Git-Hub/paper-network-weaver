
import type { Paper, PaperRelationship } from '@/store/knowledge-graph-store';

export interface NetworkNode {
  id: string;
  name: string;
  value: number;
  category: number;
  symbolSize: number;
  itemStyle?: {
    color: string;
  };
  label?: {
    show: boolean;
  };
  tooltip?: {
    formatter: string;
  };
  // Store original paper data for tooltips
  paperData: {
    title: string;
    citedByCount: number;
    relationshipTags: string[];
    publicationYear: number | null;
    authors: string[];
  };
}

export interface NetworkLink {
  source: string;
  target: string;
  lineStyle?: {
    color: string;
    width: number;
  };
}

export interface NetworkCategory {
  name: string;
  itemStyle: {
    color: string;
  };
}

const RELATIONSHIP_COLORS = {
  '1st_degree': '#ffa600',        // Direct citations
  '2nd_degree': '#5ba75a',        // Second-Degree
  'referenced_by_1st_degree': '#a6af24', // Co-Cited
  'similar': '#2c957e'            // Similar
};

const getNodeColor = (relationshipTags: string[]) => {
  // Return color based on primary relationship tag
  for (const tag of ['1st_degree', '2nd_degree', 'referenced_by_1st_degree', 'similar']) {
    if (relationshipTags.includes(tag)) {
      return RELATIONSHIP_COLORS[tag as keyof typeof RELATIONSHIP_COLORS];
    }
  }
  return '#6b7280'; // default gray
};

const getNodeSize = (citedByCount: number) => {
  // Scale node size based on citation count (min 20, max 60)
  const minSize = 20;
  const maxSize = 60;
  const logScale = Math.log(Math.max(citedByCount, 1) + 1);
  return Math.min(maxSize, minSize + logScale * 8);
};

export const transformPapersToNetwork = (
  papers: Paper[], 
  masterPaper: Paper,
  relationships: PaperRelationship[],
  authorsMap: Record<string, { clean_name: string }>,
  authorshipsMap: Record<string, { paper_short_uid: string; author_short_uid: string; author_position: number }>
) => {
  // Create nodes
  const nodes: NetworkNode[] = [];
  const categories: NetworkCategory[] = [
    { name: 'Master Paper', itemStyle: { color: 'hsl(186 33% 39%)' } },
    { name: 'Direct Citations', itemStyle: { color: RELATIONSHIP_COLORS['1st_degree'] } },
    { name: 'Second-Degree', itemStyle: { color: RELATIONSHIP_COLORS['2nd_degree'] } },
    { name: 'Co-Cited', itemStyle: { color: RELATIONSHIP_COLORS['referenced_by_1st_degree'] } },
    { name: 'Similar', itemStyle: { color: RELATIONSHIP_COLORS['similar'] } }
  ];

  // Add master paper as central node
  const masterAuthors = Object.values(authorshipsMap)
    .filter(auth => auth.paper_short_uid === masterPaper.short_uid)
    .sort((a, b) => a.author_position - b.author_position)
    .slice(0, 3)
    .map(auth => authorsMap[auth.author_short_uid]?.clean_name)
    .filter(Boolean);

  nodes.push({
    id: masterPaper.short_uid,
    name: masterPaper.title.length > 40 ? masterPaper.title.substring(0, 40) + '...' : masterPaper.title,
    value: masterPaper.cited_by_count,
    category: 0, // Master paper category
    symbolSize: 80,
    itemStyle: { color: 'hsl(186 33% 39%)' },
    label: { show: true },
    paperData: {
      title: masterPaper.title,
      citedByCount: masterPaper.cited_by_count,
      relationshipTags: [],
      publicationYear: masterPaper.publication_year,
      authors: masterAuthors
    }
  });

  // Add other papers as nodes
  papers.forEach(paper => {
    if (paper.short_uid === masterPaper.short_uid) return;

    const paperAuthors = Object.values(authorshipsMap)
      .filter(auth => auth.paper_short_uid === paper.short_uid)
      .sort((a, b) => a.author_position - b.author_position)
      .slice(0, 3)
      .map(auth => authorsMap[auth.author_short_uid]?.clean_name)
      .filter(Boolean);

    const primaryTag = paper.relationship_tags?.[0] || 'similar';
    let categoryIndex = 4; // default to similar
    if (primaryTag === '1st_degree') categoryIndex = 1;
    else if (primaryTag === '2nd_degree') categoryIndex = 2;
    else if (primaryTag === 'referenced_by_1st_degree') categoryIndex = 3;

    nodes.push({
      id: paper.short_uid,
      name: paper.title.length > 30 ? paper.title.substring(0, 30) + '...' : paper.title,
      value: paper.cited_by_count,
      category: categoryIndex,
      symbolSize: getNodeSize(paper.cited_by_count),
      itemStyle: { color: getNodeColor(paper.relationship_tags || []) },
      paperData: {
        title: paper.title,
        citedByCount: paper.cited_by_count,
        relationshipTags: paper.relationship_tags || [],
        publicationYear: paper.publication_year,
        authors: paperAuthors
      }
    });
  });

  // Create links from relationships
  const links: NetworkLink[] = relationships
    .filter(rel => {
      // Only include links where both nodes exist
      const sourceExists = nodes.some(n => n.id === rel.source_short_uid);
      const targetExists = nodes.some(n => n.id === rel.target_short_uid);
      return sourceExists && targetExists;
    })
    .map(rel => ({
      source: rel.source_short_uid,
      target: rel.target_short_uid,
      lineStyle: {
        color: '#e5e7eb',
        width: 1
      }
    }));

  return { nodes, links, categories };
};
