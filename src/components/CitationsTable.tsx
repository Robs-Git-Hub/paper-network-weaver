
import React, { useState, useMemo, useRef } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { FileText, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { useKnowledgeGraphStore, Paper, Author } from '@/store/knowledge-graph-store';
import { useIsMobile } from '@/hooks/use-mobile';

// --- PROPS AND HELPER COMPONENTS (Largely Unchanged) ---

interface CitationsTableProps {
  papers: Paper[];
  showRelationshipTags?: boolean;
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
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Abstract</DrawerTitle></DrawerHeader>
          <div className="p-4">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Abstract</DialogTitle></DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};

// --- MAIN TABLE COMPONENT (Completely Rewritten for Performance) ---

export const CitationsTable: React.FC<CitationsTableProps> = ({ papers, showRelationshipTags = false }) => {
  const { authors, authorships } = useKnowledgeGraphStore();
  const isMobile = useIsMobile();
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'citations', desc: true },
  ]);

  const getAuthorsForPaper = (paperUid: string): Author[] => {
    const paperAuthorships = Object.values(authorships).filter(
      auth => auth.paper_short_uid === paperUid
    );
    return paperAuthorships
      .sort((a, b) => a.author_position - b.author_position)
      .map(auth => authors[auth.author_short_uid])
      .filter(Boolean);
  };

  const getRelationshipTagLabel = (tag: string) => {
    switch (tag) {
      case '1st_degree': return 'Direct';
      case '2nd_degree': return '2nd Degree';
      case 'referenced_by_1st_degree': return 'Co-Cited';
      default: return tag;
    }
  };

  const getRelationshipTagColor = (tag: string) => {
    switch (tag) {
      case '1st_degree': return 'bg-blue-100 text-blue-800';
      case '2nd_degree': return 'bg-green-100 text-green-800';
      case 'referenced_by_1st_degree': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // --- Column Definitions for TanStack Table ---
  const columns = useMemo<ColumnDef<Paper>[]>(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div className="font-medium line-clamp-2">{row.original.title}</div>
      ),
      size: 384, // max-w-md
    },
    {
      id: 'authors',
      header: 'Authors',
      cell: ({ row }) => {
        const paperAuthors = getAuthorsForPaper(row.original.short_uid);
        return (
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
        );
      },
      size: 250,
    },
    {
      accessorKey: 'publication_year',
      header: 'Year',
      cell: info => info.getValue() || 'N/A',
      size: 80,
    },
    {
      accessorKey: 'cited_by_count',
      header: 'Citations',
      id: 'citations',
      cell: info => info.getValue(),
      size: 100,
    },
    {
      accessorKey: 'location',
      header: 'Published In',
      cell: ({ row }) => (
        <div className="line-clamp-1">{row.original.location || 'N/A'}</div>
      ),
      size: 224, // max-w-xs
    },
    ...(showRelationshipTags ? [{
      id: 'type',
      header: 'Type',
      cell: ({ row }: { row: { original: Paper }}) => (
        <div className="flex flex-wrap gap-1">
          {row.original.relationship_tags?.map(tag => (
            <Badge key={tag} className={`text-xs ${getRelationshipTagColor(tag)}`}>
              {getRelationshipTagLabel(tag)}
            </Badge>
          )) || null}
        </div>
      ),
      size: 120,
    }] : []),
    {
      id: 'text',
      header: 'Text',
      cell: ({ row }) => row.original.best_oa_url && (
        <Button variant="ghost" size="sm" asChild>
          <a href={row.original.best_oa_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ),
      size: 60,
    },
    {
      id: 'abstract',
      header: 'Abstract',
      cell: ({ row }) => row.original.abstract && (
        <AbstractModal paper={row.original}>
          <Button variant="ghost" size="sm">
            <FileText className="h-4 w-4" />
          </Button>
        </AbstractModal>
      ),
      size: 80,
    },
  ], [showRelationshipTags]);

  // --- TanStack Table Instance ---
  const table = useReactTable({
    data: papers,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();
  const parentRef = useRef<HTMLDivElement>(null);

  // --- TanStack Virtualizer Instance ---
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => isMobile ? 220 : 65, // Estimate row height (card vs table row)
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // --- Mobile Card Layout (Now Virtualized) ---
  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">({rows.length})</div>
        <div ref={parentRef} className="relative h-[70vh] overflow-y-auto">
          <div style={{ height: `${totalSize}px` }} className="relative w-full">
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const paper = row.original;
              const paperAuthors = getAuthorsForPaper(paper.short_uid);
              return (
                <div
                  key={row.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: '0 8px 8px 8px', // Add padding to prevent card overlap
                  }}
                >
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-medium leading-tight">{paper.title}</CardTitle>
                      {showRelationshipTags && paper.relationship_tags && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {paper.relationship_tags.map(tag => (
                            <Badge key={tag} className={`text-xs ${getRelationshipTagColor(tag)}`}>
                              {getRelationshipTagLabel(tag)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-1">
                        {paperAuthors.slice(0, 3).map(author => (
                          <Badge key={author.short_uid} variant="outline" className="text-xs">{author.clean_name}</Badge>
                        ))}
                        {paperAuthors.length > 3 && <span className="text-xs text-muted-foreground">+{paperAuthors.length - 3} more</span>}
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Year: {paper.publication_year || 'N/A'}</span>
                        <span>Citations: {paper.cited_by_count}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {paper.best_oa_url && <Button variant="ghost" size="sm" asChild><a href={paper.best_oa_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Text</a></Button>}
                        </div>
                        {paper.abstract && <AbstractModal paper={paper}><Button variant="ghost" size="sm"><FileText className="h-4 w-4 mr-2" />Abstract</Button></AbstractModal>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // --- Desktop Table Layout (Now Virtualized) ---
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">({rows.length})</div>
      <div ref={parentRef} className="rounded-md border h-[70vh] overflow-y-auto">
        <Table style={{ width: table.getTotalSize() }}>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id} style={{ width: header.getSize() }} className="cursor-pointer select-none hover:bg-muted/50" onClick={header.column.getToggleSortingHandler()}>
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: <ChevronUp className="h-4 w-4" />,
                        desc: <ChevronDown className="h-4 w-4" />,
                      }[header.column.getIsSorted() as string] ?? null}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody style={{ height: `${totalSize}px` }} className="relative">
            {virtualRows.map(virtualRow => {
              const row = rows[virtualRow.index];
              return (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
