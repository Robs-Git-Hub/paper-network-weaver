
import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { FileText } from 'lucide-react';
import { useKnowledgeGraphStore, Paper } from '@/store/knowledge-graph-store';
import { useIsMobile } from '@/hooks/use-mobile';

interface CitationsTableProps {
  papers: Paper[];
}

interface AbstractModalProps {
  paper: Paper;
  children: React.ReactNode;
}

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

                <div className="flex items-center justify-between">
                  <div></div>
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Authors</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Citations</TableHead>
            <TableHead>Journal</TableHead>
            <TableHead>Abstract</TableHead>
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
  );
};
