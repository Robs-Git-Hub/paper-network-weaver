
import React from 'react';
import { CitationsTable } from '@/components/CitationsTable';
import type { Paper } from '@/store/knowledge-graph-store';

interface DirectCitationsTableProps {
  papers: Paper[];
}

export const DirectCitationsTable: React.FC<DirectCitationsTableProps> = ({ papers }) => {
  if (papers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No direct citations found</p>
      </div>
    );
  }

  return <CitationsTable papers={papers} />;
};
