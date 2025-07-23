
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { exportDataPackage } from '@/utils/data-export';
import { useToast } from '@/hooks/use-toast';

export const ExportButton: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const {
    papers,
    authors,
    institutions,
    authorships,
    paper_relationships,
    external_id_index,
    relation_to_master,
  } = useKnowledgeGraphStore();

  const handleExport = async () => {
    // --- START: DIAGNOSTIC STEP ---
    console.log("Inspecting external_id_index:", external_id_index);
    // --- END: DIAGNOSTIC STEP ---

    if (Object.keys(papers).length === 0) {
      toast({
        title: "No data to export",
        description: "Please load some papers first before exporting.",
        variant: "destructive"
      });
      return;
    }

    setIsExporting(true);
    try {
      await exportDataPackage({
        papers,
        authors,
        institutions,
        authorships,
        paper_relationships,
        external_id_index,
        relation_to_master
      });
      
      toast({
        title: "Export successful",
        description: "Your data package has been downloaded as a ZIP file."
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: "Export failed",
        description: "There was an error creating the data package.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={isExporting}
      variant="outline"
      size="sm"
    >
      {isExporting ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {isExporting ? 'Exporting...' : 'Export Data'}
    </Button>
  );
};
