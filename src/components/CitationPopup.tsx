
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText } from 'lucide-react';
import { Paper, useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { useIsMobile } from '@/hooks/use-mobile';

interface CitationPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citingPapers: Paper[];
  targetPaperTitle: string;
}

export const CitationPopup: React.FC<CitationPopupProps> = ({
  open,
  onOpenChange,
  citingPapers,
  targetPaperTitle
}) => {
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

  const content = (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      <p className="text-sm text-muted-foreground">
        Papers that cite "{targetPaperTitle}" ({citingPapers.length})
      </p>
      
      {citingPapers.map((paper) => {
        const paperAuthors = getAuthorsForPaper(paper.short_uid);
        return (
          <Card key={paper.short_uid} className="text-left">
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

              <div className="flex items-center gap-2">
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
                {paper.abstract && (
                  <Button variant="ghost" size="sm">
                    <FileText className="h-4 w-4 mr-2" />
                    Abstract
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Citations</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Citations</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};
