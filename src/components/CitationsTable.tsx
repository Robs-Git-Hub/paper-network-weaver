
import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useKnowledgeGraphStore, Paper } from '@/store/knowledge-graph-store';

interface CitationsTableProps {
  papers: Paper[];
}

export const CitationsTable: React.FC<CitationsTableProps> = ({ papers }) => {
  const { authors, authorships } = useKnowledgeGraphStore();
  
  const getAuthorsForPaper = (paperUid: string) => {
    const paperAuthorships = Object.values(authorships).filter(
      auth => auth.paper_short_uid === paperUid
    );
    
    return paperAuthorships
      .sort((a, b) => a.author_position - b.author_position)
      .map(auth => authors[auth.author_short_uid])
      .filter(Boolean);
  };

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
