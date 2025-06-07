
import React from 'react';
import { CitationsTable } from '@/components/CitationsTable';
import type { Paper } from '@/store/knowledge-graph-store';

interface CoCitedPapersTableProps {
  papers: Paper[];
}

export const CoCitedPapersTable: React.FC<CoCitedPapersTableProps> = ({ papers }) => {
  if (papers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No co-cited papers found</p>
      </div>
    );
  }

  return <CitationsTable papers={papers} />;
};
