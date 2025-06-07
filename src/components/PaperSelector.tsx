
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PaperResult {
  id: string;
  title: string;
  authors: Array<{ display_name: string }>;
  publication_year: number | null;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count: number;
}

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
  return (
    <div className="w-full max-w-4xl mx-auto mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
      {totalCount && totalCount > 25 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-sm">
          More than 25 results found. Please provide a more specific title to narrow your search.
        </div>
      )}
      
      <div className="space-y-3">
        {papers.map((paper) => (
          <Card 
            key={paper.id}
            className="cursor-pointer transition-colors hover:bg-gray-50 border border-gray-200"
            onClick={() => onSelectPaper(paper)}
          >
            <CardContent className="p-4">
              <div className="space-y-2">
                <h3 className="font-medium text-gray-900 leading-tight">
                  {paper.title}
                </h3>
                
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>
                    {paper.authors.slice(0, 3).map(a => a.display_name).join(', ')}
                    {paper.authors.length > 3 && ` +${paper.authors.length - 3} more`}
                  </span>
                  {paper.publication_year && (
                    <>
                      <span>•</span>
                      <span>{paper.publication_year}</span>
                    </>
                  )}
                </div>
                
                <div className="flex items-center gap-2 flex-wrap">
                  {paper.primary_location?.source?.display_name && (
                    <Badge variant="outline" className="text-xs">
                      {paper.primary_location.source.display_name}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {paper.cited_by_count} citations
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
