
import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { FileText, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { useKnowledgeGraphStore, Paper } from '@/store/knowledge-graph-store';
import { useIsMobile } from '@/hooks/use-mobile';

interface CitationsTableProps {
  papers: Paper[];
}

interface AbstractModalProps {
  paper: Paper;
  children: React.ReactNode;
}

type SortField = 'title' | 'year' | 'citations' | 'location';
type SortDirection = 'asc' | 'desc';

const AbstractModal: React.FC<AbstractModalProps> = ({ paper, children }) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const content = (
    <>
      <div className="text-lg font-semibold mb-2">{paper.title}</div>
      <div className="text-sm text-muted-foreground max-h-96 overflow-y-auto">
        {paper.abstract}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {children}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Abstract</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Abstract</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};

export const CitationsTable: React.FC<CitationsTableProps> = ({ papers }) => {
  const { authors, authorships } = useKnowledgeGraphStore();
  const isMobile = useIsMobile();
  const [sortField, setSortField] = useState<SortField>('citations');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  const getAuthorsForPaper = (paperUid: string) => {
    const paperAuthorships = Object.values(authorships).filter(
      auth => auth.paper_short_uid === paperUid
    );
    
    return paperAuthorships
      .sort((a, b) => a.author_position - b.author_position)
      .map(auth => authors[auth.author_short_uid])
      .filter(Boolean);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortedPapers = () => {
    return [...papers].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'year':
          aValue = a.publication_year || 0;
          bValue = b.publication_year || 0;
          break;
        case 'citations':
          aValue = a.cited_by_count;
          bValue = b.cited_by_count;
          break;
        case 'location':
          aValue = (a.location || '').toLowerCase();
          bValue = (b.location || '').toLowerCase();
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  };

  const sortedPapers = getSortedPapers();

  const SortableHeader: React.FC<{ field: SortField; children: React.ReactNode }> = ({ field, children }) => (
    <TableHead 
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
        )}
      </div>
    </TableHead>
  );

  // Mobile card layout
  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          ({sortedPapers.length})
        </div>
        {sortedPapers.map((paper) => {
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
                    <span className="font-medium">Published In: </span>
                    {paper.location}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {paper.best_oa_url && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        asChild
                      >
                        <a href={paper.best_oa_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Text
                        </a>
                      </Button>
                    )}
                  </div>
                  {paper.abstract && (
                    <AbstractModal paper={paper}>
                      <Button variant="ghost" size="sm">
                        <FileText className="h-4 w-4 mr-2" />
                        Abstract
                      </Button>
                    </AbstractModal>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // Desktop table layout
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        ({sortedPapers.length})
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader field="title">Title</SortableHeader>
              <TableHead>Authors</TableHead>
              <SortableHeader field="year">Year</SortableHeader>
              <SortableHeader field="citations">Citations</SortableHeader>
              <SortableHeader field="location">Published In</SortableHeader>
              <TableHead>Text</TableHead>
              <TableHead>Abstract</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPapers.map((paper) => {
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
                  <TableCell>
                    {paper.best_oa_url && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        asChild
                      >
                        <a href={paper.best_oa_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {paper.abstract && (
                      <AbstractModal paper={paper}>
                        <Button variant="ghost" size="sm">
                          <FileText className="h-4 w-4" />
                        </Button>
                      </AbstractModal>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
