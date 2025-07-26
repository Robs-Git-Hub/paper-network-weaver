
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { PaperResult } from '@/types/api'; // --- FIX: Import the shared type

interface PaperSelectorProps {
  papers: PaperResult[];
  onSelectPaper: (paper: PaperResult) => void;
  totalCount?: number;
}

export const PaperSelector: React.FC<PaperSelectorProps> = ({ 
  papers, 
  onSelectPaper, 
  totalCount 
}) => {
  const isSelectablePaper = (paper: PaperResult): boolean => {
    return !paper.cited_by_count || paper.cited_by_count <= 200;
  };

  const renderPaperCard = (paper: PaperResult) => {
    const isSelectable = isSelectablePaper(paper);
    
    const cardContent = (
      <Card 
        key={paper.id}
        className={`transition-colors border border-gray-200 ${
          isSelectable 
            ? 'cursor-pointer hover:bg-gray-50' 
            : 'cursor-not-allowed'
        }`}
        style={!isSelectable ? { backgroundColor: 'hsl(210, 56%, 96%)' } : undefined}
        onClick={isSelectable ? () => onSelectPaper(paper) : undefined}
      >
        <CardContent className="p-4">
          <div className="space-y-2">
            <h3 className={`font-medium leading-tight ${
              isSelectable ? 'text-gray-900' : 'text-gray-500'
            }`}>
              {paper.title || paper.display_name || 'Untitled'}
            </h3>
            
            <div className={`flex items-center gap-2 text-sm ${
              isSelectable ? 'text-gray-600' : 'text-gray-400'
            }`}>
              <span>
                {paper.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ')}
                {paper.authorships && paper.authorships.length > 3 && ` +${paper.authorships.length - 3} more`}
              </span>
              {paper.publication_year && (
                <>
                  <span>•</span>
                  <span>{paper.publication_year}</span>
                </>
              )}
              {paper.cited_by_count !== undefined && (
                <>
                  <span>•</span>
                  <span>Initial citation count: {paper.cited_by_count}</span>
                </>
              )}
            </div>
            
            {paper.primary_location?.source?.display_name && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {paper.primary_location.source.display_name}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );

    if (!isSelectable) {
      return (
        <Tooltip key={paper.id}>
          <TooltipTrigger asChild>
            {cardContent}
          </TooltipTrigger>
          <TooltipContent>
            ACE is currently only able to process papers that have been cited up to 200 times
          </TooltipContent>
        </Tooltip>
      );
    }

    return cardContent;
  };

  return (
    <TooltipProvider>
      <div className="w-full max-w-4xl mx-auto mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
        {totalCount && totalCount > 25 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-sm">
            More than 25 results found. Please provide a more specific title to narrow your search.
          </div>
        )}
        
        <div className="space-y-3">
          {papers.map((paper) => renderPaperCard(paper))}
        </div>
      </div>
    </TooltipProvider>
  );
};
