
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useKnowledgeGraphStore, Paper } from '@/store/knowledge-graph-store';

interface MasterPaperCardProps {
  paper: Paper;
}

export const MasterPaperCard: React.FC<MasterPaperCardProps> = ({ paper }) => {
  const { authors, authorships } = useKnowledgeGraphStore();
  
  // Get authors for this paper
  const paperAuthorships = Object.values(authorships).filter(
    auth => auth.paper_short_uid === paper.short_uid
  );
  
  const paperAuthors = paperAuthorships
    .sort((a, b) => a.author_position - b.author_position)
    .map(auth => authors[auth.author_short_uid])
    .filter(Boolean);

  return (
    <Card className="border-2 border-[#437e84]">
      <CardHeader>
        <CardTitle className="text-lg">{paper.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {paperAuthors.map(author => (
            <Badge key={author.short_uid} variant="outline">
              {author.clean_name}
            </Badge>
          ))}
        </div>
        
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {paper.publication_year && (
            <span>Year: {paper.publication_year}</span>
          )}
          <span>Citations: {paper.cited_by_count}</span>
          {paper.location && (
            <span>Published in: {paper.location}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
