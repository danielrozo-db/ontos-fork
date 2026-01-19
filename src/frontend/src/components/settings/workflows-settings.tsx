import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { ColumnDef } from '@tanstack/react-table';
import { 
  Plus, 
  MoreHorizontal, 
  Pencil, 
  Copy, 
  Trash2, 
  GitBranch,
  Shield,
  Bell,
  Tag,
  Code,
  CheckCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import type { 
  ProcessWorkflow, 
  WorkflowListResponse,
  TriggerType,
  EntityType,
} from '@/types/process-workflow';

// Helper to get trigger display
const getTriggerDisplay = (trigger: { type: TriggerType; entity_types: EntityType[] }) => {
  const typeLabels: Record<TriggerType, string> = {
    on_create: 'On Create',
    on_update: 'On Update',
    on_delete: 'On Delete',
    on_status_change: 'On Status Change',
    scheduled: 'Scheduled',
    manual: 'Manual',
  };
  
  const entityLabels: Record<EntityType, string> = {
    catalog: 'Catalog',
    schema: 'Schema',
    table: 'Table',
    view: 'View',
    data_contract: 'Contract',
    data_product: 'Product',
    dataset: 'Dataset',
    domain: 'Domain',
    project: 'Project',
  };
  
  const entities = trigger.entity_types.map(e => entityLabels[e] || e).join(', ');
  return `${typeLabels[trigger.type] || trigger.type}${entities ? ` (${entities})` : ''}`;
};

// Helper to get step type icon
const getStepTypeIcon = (stepType: string) => {
  switch (stepType) {
    case 'validation': return <Shield className="h-4 w-4" />;
    case 'approval': return <CheckCircle className="h-4 w-4" />;
    case 'notification': return <Bell className="h-4 w-4" />;
    case 'assign_tag': return <Tag className="h-4 w-4" />;
    case 'conditional': return <GitBranch className="h-4 w-4" />;
    case 'script': return <Code className="h-4 w-4" />;
    default: return <GitBranch className="h-4 w-4" />;
  }
};

export default function WorkflowsSettings() {
  const { get, post, put, delete: apiDelete } = useApi();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [workflows, setWorkflows] = useState<ProcessWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicatingWorkflow, setDuplicatingWorkflow] = useState<ProcessWorkflow | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [isDuplicating, setIsDuplicating] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await get<WorkflowListResponse>('/api/workflows');
      if (response.data) {
        setWorkflows(response.data.workflows || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load workflows',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, toast]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleToggleActive = async (workflow: ProcessWorkflow) => {
    try {
      const response = await post<ProcessWorkflow>(
        `/api/workflows/${workflow.id}/toggle-active?is_active=${!workflow.is_active}`,
        {}
      );
      if (response.data) {
        setWorkflows(prev => 
          prev.map(w => w.id === workflow.id ? response.data! : w)
        );
        toast({
          title: 'Success',
          description: `Workflow ${response.data.is_active ? 'enabled' : 'disabled'}`,
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update workflow status',
        variant: 'destructive',
      });
    }
  };

  const handleDuplicate = async () => {
    if (!duplicatingWorkflow || !duplicateName.trim()) return;
    
    setIsDuplicating(true);
    try {
      const response = await post<ProcessWorkflow>(
        `/api/workflows/${duplicatingWorkflow.id}/duplicate?new_name=${encodeURIComponent(duplicateName)}`,
        {}
      );
      if (response.data) {
        setWorkflows(prev => [...prev, response.data!]);
        toast({
          title: 'Success',
          description: 'Workflow duplicated successfully',
        });
        setDuplicateDialogOpen(false);
        setDuplicatingWorkflow(null);
        setDuplicateName('');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to duplicate workflow',
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleDelete = async (workflow: ProcessWorkflow) => {
    if (workflow.is_default) {
      toast({
        title: 'Cannot Delete',
        description: 'Default workflows cannot be deleted. Disable them instead.',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      await apiDelete(`/api/workflows/${workflow.id}`);
      setWorkflows(prev => prev.filter(w => w.id !== workflow.id));
      toast({
        title: 'Success',
        description: 'Workflow deleted',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete workflow',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (workflow: ProcessWorkflow) => {
    navigate(`/settings/workflows/${workflow.id}`);
  };

  const handleLoadDefaults = async () => {
    try {
      const response = await post<{ message: string }>('/api/workflows/load-defaults', {});
      if (response.data) {
        toast({
          title: 'Success',
          description: response.data.message,
        });
        loadWorkflows();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load default workflows',
        variant: 'destructive',
      });
    }
  };

  const columns: ColumnDef<ProcessWorkflow>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.original.name}</span>
          {row.original.is_default && (
            <Badge variant="secondary" className="text-xs">Default</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'trigger',
      header: 'Trigger',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {getTriggerDisplay(row.original.trigger)}
        </span>
      ),
    },
    {
      accessorKey: 'steps',
      header: 'Steps',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {row.original.steps.slice(0, 4).map((step, i) => (
            <span key={i} className="text-muted-foreground" title={step.step_type}>
              {getStepTypeIcon(step.step_type)}
            </span>
          ))}
          {row.original.steps.length > 4 && (
            <span className="text-xs text-muted-foreground">
              +{row.original.steps.length - 4}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.is_active}
            onCheckedChange={() => handleToggleActive(row.original)}
          />
          <span className={row.original.is_active ? 'text-green-600' : 'text-muted-foreground'}>
            {row.original.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleEdit(row.original)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              setDuplicatingWorkflow(row.original);
              setDuplicateName(`${row.original.name} (Copy)`);
              setDuplicateDialogOpen(true);
            }}>
              <Copy className="h-4 w-4 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDelete(row.original)}
              disabled={row.original.is_default}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Process Workflows
            </CardTitle>
            <CardDescription>
              Configure automated workflows for validation, approval, and notifications
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleLoadDefaults}>
              <Clock className="h-4 w-4 mr-2" />
              Load Defaults
            </Button>
            <Button onClick={() => navigate('/settings/workflows/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Workflow
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>No workflows configured yet.</p>
            <p className="text-sm">Click "Load Defaults" to get started with default workflows.</p>
          </div>
        ) : (
          <DataTable columns={columns} data={workflows} />
        )}
      </CardContent>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Workflow</DialogTitle>
            <DialogDescription>
              Create a copy of "{duplicatingWorkflow?.name}" with a new name.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="New workflow name"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDuplicate} disabled={isDuplicating || !duplicateName.trim()}>
              {isDuplicating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

