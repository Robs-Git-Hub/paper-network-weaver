
import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useKnowledgeGraphStore, Paper } from '@/store/knowledge-graph-store';
import { useIsMobile } from '@/hooks/use-mobile';

interface CitationsTableProps {
  papers: Paper[];
}

export const CitationsTable: React.FC<CitationsTableProps> = ({ papers }) => {
  const { authors, authorships } = useKnowledgeGraphStore();
  const isMobile = useIsMobile();
  
  const getAuthorsForPaper = (paperUid: string) => {
    const paperAuthorships = Object.values(authorships).filter(
      auth => auth.paper_short_uid === paperUid
    );
    
    return paperAuthorships
      .sort((a, b) => a.author_position - b.author_position)
      .map(auth => authors[auth.author_short_uid])
      .filter(Boolean);
  };

  // Mobile card layout
  if (isMobile) {
    return (
      <div className="space-y-4">
        {papers.map((paper) => {
          const paperAuthors = getAuthorsForPaper(paper.short_uid);
          return (
            <Card key={paper.short_uid}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium leading-tight">
                  {paper.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {paperAuthors.slice(0, 3).map(author => (
                    <Badge key={author.short_uid} variant="outline" className="text-xs">
                      {author.clean_name}
                    </Badge>
                  ))}
                  {paperAuthors.length > 3 && (
                    <span className="text-xs text-muted-foreground">
                      +{paperAuthors.length - 3} more
                    </span>
                  )}
                </div>
                
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Year: {paper.publication_year || 'N/A'}</span>
                  <span>Citations: {paper.cited_by_count}</span>
                </div>
                
                {paper.location && (
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Journal: </span>
                    {paper.location}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // Desktop table layout
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Authors</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Citations</TableHead>
            <TableHead>Journal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {papers.map((paper) => {
            const paperAuthors = getAuthorsForPaper(paper.short_uid);
            return (
              <TableRow key={paper.short_uid}>
                <TableCell className="font-medium max-w-md">
                  <div className="line-clamp-2">{paper.title}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {paperAuthors.slice(0, 3).map(author => (
                      <Badge key={author.short_uid} variant="outline" className="text-xs">
                        {author.clean_name}
                      </Badge>
                    ))}
                    {paperAuthors.length > 3 && (
                      <span className="text-xs text-muted-foreground">
                        +{paperAuthors.length - 3} more
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{paper.publication_year || 'N/A'}</TableCell>
                <TableCell>{paper.cited_by_count}</TableCell>
                <TableCell className="max-w-xs">
                  <div className="line-clamp-1">{paper.location || 'N/A'}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
