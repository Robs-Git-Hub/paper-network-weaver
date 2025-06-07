
import React from 'react';
import { CitationsTable } from '@/components/CitationsTable';
import type { Paper } from '@/store/knowledge-graph-store';

interface SecondDegreeCitationsTableProps {
  papers: Paper[];
}

export const SecondDegreeCitationsTable: React.FC<SecondDegreeCitationsTableProps> = ({ papers }) => {
  if (papers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No second-degree citations found</p>
      </div>
    );
  }

  return <CitationsTable papers={papers} />;
};
