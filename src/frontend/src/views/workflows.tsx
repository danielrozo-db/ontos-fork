import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { 
  Plus, 
  MoreHorizontal, 
  GitBranch,
  Shield,
  Bell,
  Tag,
  Code,
  CheckCircle,
  Clock,
  Loader2,
  Pencil,
  Copy,
  Trash2,
  ClipboardCheck,
  Play,
  Pause,
  AlertCircle,
  ArrowUpDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColumnDef, Column } from "@tanstack/react-table";
import { useApi } from '@/hooks/use-api';
import useBreadcrumbStore from '@/stores/breadcrumb-store';
import { DataTable } from '@/components/ui/data-table';
import { usePermissions } from '@/stores/permissions-store';
import { FeatureAccessLevel } from '@/types/settings';
import type { 
  ProcessWorkflow, 
  WorkflowListResponse,
  WorkflowExecution,
  ExecutionStatus,
} from '@/types/process-workflow';
import { getTriggerDisplay } from '@/lib/workflow-labels';
import { WorkflowExecutionDialog } from '@/components/workflows/workflow-execution-dialog';

interface WorkflowExecutionsResponse {
  executions: WorkflowExecution[];
  total: number;
}

// Helper to get step type icon
const getStepTypeIcon = (stepType: string) => {
  switch (stepType) {
    case 'validation': return <Shield className="h-4 w-4" />;
    case 'approval': return <CheckCircle className="h-4 w-4" />;
    case 'notification': return <Bell className="h-4 w-4" />;
    case 'assign_tag': return <Tag className="h-4 w-4" />;
    case 'conditional': return <GitBranch className="h-4 w-4" />;
    case 'script': return <Code className="h-4 w-4" />;
    case 'policy_check': return <ClipboardCheck className="h-4 w-4" />;
    default: return <GitBranch className="h-4 w-4" />;
  }
};

// Helper to get execution status badge
const getStatusBadge = (status: ExecutionStatus) => {
  const variants: Record<ExecutionStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
    pending: { variant: 'secondary', icon: <Clock className="h-3 w-3 mr-1" /> },
    running: { variant: 'default', icon: <Play className="h-3 w-3 mr-1 animate-pulse" /> },
    paused: { variant: 'outline', icon: <Pause className="h-3 w-3 mr-1" /> },
    succeeded: { variant: 'default', icon: <CheckCircle className="h-3 w-3 mr-1" /> },
    failed: { variant: 'destructive', icon: <AlertCircle className="h-3 w-3 mr-1" /> },
    cancelled: { variant: 'secondary', icon: <AlertCircle className="h-3 w-3 mr-1" /> },
  };
  const config = variants[status] || variants.pending;
  return (
    <Badge variant={config.variant} className="flex items-center">
      {config.icon}
      {status}
    </Badge>
  );
};

export default function Workflows() {
  const { t } = useTranslation(['common']);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { get: apiGet, post: apiPost, delete: apiDeleteApi } = useApi();
  const setStaticSegments = useBreadcrumbStore((state) => state.setStaticSegments);
  const setDynamicTitle = useBreadcrumbStore((state) => state.setDynamicTitle);
  const { hasPermission } = usePermissions();
  
  // Check if user has admin access
  const canEdit = hasPermission('process-workflows', FeatureAccessLevel.ADMIN);
  
  // Workflow state
  const [workflows, setWorkflows] = useState<ProcessWorkflow[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicatingWorkflow, setDuplicatingWorkflow] = useState<ProcessWorkflow | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [isDuplicating, setIsDuplicating] = useState(false);
  
  // Executions state
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(true);
  
  // Execution detail dialog state
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null);
  const [executionDialogOpen, setExecutionDialogOpen] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setIsLoadingWorkflows(true);
    try {
      const response = await apiGet<WorkflowListResponse>('/api/workflows');
      if (response.data) {
        setWorkflows(response.data.workflows || []);
      }
    } catch (error) {
      toast({
        title: t('common:toast.error'),
        description: 'Failed to load workflows',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingWorkflows(false);
    }
  }, [apiGet, toast, t]);

  const loadExecutions = useCallback(async () => {
    setIsLoadingExecutions(true);
    try {
      const response = await apiGet<WorkflowExecutionsResponse>('/api/workflows/executions?limit=50');
      if (response.data) {
        setExecutions(response.data.executions || []);
      }
    } catch (error) {
      // Executions endpoint might not exist yet, silently fail
      console.warn('Failed to load workflow executions:', error);
    } finally {
      setIsLoadingExecutions(false);
    }
  }, [apiGet]);

  useEffect(() => {
    loadWorkflows();
    loadExecutions();
    setStaticSegments([]);
    setDynamicTitle('Workflows');

    return () => {
      setStaticSegments([]);
      setDynamicTitle(null);
    };
  }, [loadWorkflows, loadExecutions, setStaticSegments, setDynamicTitle]);

  // Workflow handlers
  const handleToggleWorkflowActive = async (workflow: ProcessWorkflow) => {
    if (!canEdit) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to modify workflows.',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      const response = await apiPost<ProcessWorkflow>(
        `/api/workflows/${workflow.id}/toggle-active?is_active=${!workflow.is_active}`,
        {}
      );
      if (response.data) {
        setWorkflows(prev => 
          prev.map(w => w.id === workflow.id ? response.data! : w)
        );
        toast({
          title: t('common:toast.success'),
          description: `Workflow ${response.data.is_active ? 'enabled' : 'disabled'}`,
        });
      }
    } catch (error) {
      toast({
        title: t('common:toast.error'),
        description: 'Failed to update workflow status',
        variant: 'destructive',
      });
    }
  };

  const handleDuplicateWorkflow = async () => {
    if (!duplicatingWorkflow || !duplicateName.trim()) return;
    
    setIsDuplicating(true);
    try {
      const response = await apiPost<ProcessWorkflow>(
        `/api/workflows/${duplicatingWorkflow.id}/duplicate?new_name=${encodeURIComponent(duplicateName)}`,
        {}
      );
      if (response.data) {
        setWorkflows(prev => [...prev, response.data!]);
        toast({
          title: t('common:toast.success'),
          description: 'Workflow duplicated successfully',
        });
        setDuplicateDialogOpen(false);
        setDuplicatingWorkflow(null);
        setDuplicateName('');
      }
    } catch (error) {
      toast({
        title: t('common:toast.error'),
        description: 'Failed to duplicate workflow',
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleDeleteWorkflow = async (workflow: ProcessWorkflow) => {
    if (!canEdit) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to delete workflows.',
        variant: 'destructive',
      });
      return;
    }
    
    if (workflow.is_default) {
      toast({
        title: 'Cannot Delete',
        description: 'Default workflows cannot be deleted. Disable them instead.',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      await apiDeleteApi(`/api/workflows/${workflow.id}`);
      setWorkflows(prev => prev.filter(w => w.id !== workflow.id));
      toast({
        title: t('common:toast.success'),
        description: 'Workflow deleted',
      });
    } catch (error) {
      toast({
        title: t('common:toast.error'),
        description: 'Failed to delete workflow',
        variant: 'destructive',
      });
    }
  };

  const handleEditWorkflow = (workflow: ProcessWorkflow) => {
    navigate(`/workflows/${workflow.id}`);
  };

  const handleLoadDefaultWorkflows = async () => {
    if (!canEdit) {
      toast({
        title: 'Permission Denied',
        description: 'You do not have permission to load default workflows.',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      const response = await apiPost<{ message: string }>('/api/workflows/load-defaults', {});
      if (response.data) {
        toast({
          title: t('common:toast.success'),
          description: response.data.message,
        });
        loadWorkflows();
      }
    } catch (error) {
      toast({
        title: t('common:toast.error'),
        description: 'Failed to load default workflows',
        variant: 'destructive',
      });
    }
  };

  const workflowColumns: ColumnDef<ProcessWorkflow>[] = [
    {
      accessorKey: 'name',
      header: ({ column }: { column: Column<ProcessWorkflow, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {t('common:labels.name')}
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={() => navigate(`/workflows/${row.original.id}`)}
            className="font-medium hover:underline hover:text-primary text-left"
          >
            {row.original.name}
          </button>
          {row.original.is_default && (
            <Badge variant="secondary" className="text-xs">Default</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'trigger.type',
      header: ({ column }: { column: Column<ProcessWorkflow, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {t('common:labels.type')}
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {getTriggerDisplay(row.original.trigger, t)}
        </span>
      ),
    },
    {
      accessorKey: 'steps',
      header: 'Steps',
      enableSorting: false,
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
      header: ({ column }: { column: Column<ProcessWorkflow, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {t('common:labels.status')}
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.is_active}
            onCheckedChange={() => handleToggleWorkflowActive(row.original)}
            disabled={!canEdit}
          />
          <span className={row.original.is_active ? 'text-green-600' : 'text-muted-foreground'}>
            {row.original.is_active ? t('common:labels.active') : t('common:labels.inactive')}
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
            <DropdownMenuLabel>{t('common:labels.actions')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleEditWorkflow(row.original)}>
              <Pencil className="h-4 w-4 mr-2" />
              {canEdit ? t('common:actions.edit') : t('common:actions.view')}
            </DropdownMenuItem>
            {canEdit && (
              <>
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
                  onClick={() => handleDeleteWorkflow(row.original)}
                  disabled={row.original.is_default}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('common:actions.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const executionColumns: ColumnDef<WorkflowExecution>[] = [
    {
      accessorKey: 'workflow_name',
      header: ({ column }: { column: Column<WorkflowExecution, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Workflow
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.original.workflow_name}</span>
        </div>
      ),
    },
    {
      accessorKey: 'entity_name',
      header: 'Entity',
      enableSorting: false,
      cell: ({ row }) => {
        const { entity_type, entity_name, entity_id } = row.original;
        if (!entity_type && !entity_name) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{entity_name || entity_id || '-'}</span>
            {entity_type && (
              <span className="text-xs text-muted-foreground capitalize">{entity_type}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }: { column: Column<WorkflowExecution, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {t('common:labels.status')}
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      accessorKey: 'current_step_name',
      header: 'Current Step',
      enableSorting: false,
      cell: ({ row }) => {
        const { status, current_step_name, current_step_id } = row.original;
        if (status !== 'paused' && status !== 'running') return null;
        const stepDisplay = current_step_name || current_step_id || '-';
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
            {stepDisplay}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'started_at',
      header: ({ column }: { column: Column<WorkflowExecution, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Started
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.started_at 
            ? new Date(row.original.started_at).toLocaleString() 
            : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'finished_at',
      header: ({ column }: { column: Column<WorkflowExecution, unknown> }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Completed
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.finished_at 
            ? new Date(row.original.finished_at).toLocaleString() 
            : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'error_message',
      header: 'Error',
      enableSorting: false,
      cell: ({ row }) => (
        row.original.error_message ? (
          <span className="text-sm text-destructive truncate max-w-[200px]" title={row.original.error_message}>
            {row.original.error_message}
          </span>
        ) : null
      ),
    },
  ];

  // Stats
  const activeWorkflows = workflows.filter(w => w.is_active).length;
  const totalWorkflows = workflows.length;
  const runningExecutions = executions.filter(e => e.status === 'running' || e.status === 'paused').length;
  const recentFailures = executions.filter(e => e.status === 'failed').length;

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <GitBranch className="w-8 h-8" />
          Process Workflows
        </h1>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleLoadDefaultWorkflows}>
              <Clock className="h-4 w-4 mr-2" />
              Load Defaults
            </Button>
            <Button onClick={() => navigate('/workflows/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Workflow
            </Button>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{activeWorkflows}</div>
            <p className="text-sm text-muted-foreground mt-1">of {totalWorkflows} total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Default Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{workflows.filter(w => w.is_default).length}</div>
            <p className="text-sm text-muted-foreground mt-1">built-in workflows</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{runningExecutions}</div>
            <p className="text-sm text-muted-foreground mt-1">running or paused</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Recent Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${recentFailures > 0 ? 'text-red-600' : ''}`}>
              {recentFailures}
            </div>
            <p className="text-sm text-muted-foreground mt-1">in last 50 runs</p>
          </CardContent>
        </Card>
      </div>

      {/* Workflows Table */}
      <Card className="mb-8">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Workflow Definitions
            </CardTitle>
            <CardDescription>
              Configure automated workflows for validation, approval, and notifications.
              {!canEdit && (
                <span className="text-yellow-600 ml-2">(Read-only access)</span>
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingWorkflows ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No workflows configured yet.</p>
              {canEdit && (
                <p className="text-sm">Click "Load Defaults" to get started with default workflows.</p>
              )}
            </div>
          ) : (
            <DataTable 
              columns={workflowColumns} 
              data={workflows}
              searchColumn="name"
              storageKey="workflows-sort"
            />
          )}
        </CardContent>
      </Card>

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Recent Executions
            </CardTitle>
            <CardDescription>
              Monitor workflow executions and their status.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingExecutions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Play className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No workflow executions yet.</p>
              <p className="text-sm">Executions will appear here when workflows are triggered.</p>
            </div>
          ) : (
            <DataTable 
              columns={executionColumns} 
              data={executions}
              searchColumn="workflow_name"
              storageKey="workflow-executions-sort"
              onRowClick={(row) => {
                setSelectedExecution(row.original);
                setExecutionDialogOpen(true);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Duplicate Workflow Dialog */}
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
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleDuplicateWorkflow} disabled={isDuplicating || !duplicateName.trim()}>
              {isDuplicating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Workflow Execution Detail Dialog */}
      <WorkflowExecutionDialog
        execution={selectedExecution}
        open={executionDialogOpen}
        onOpenChange={setExecutionDialogOpen}
      />
    </div>
  );
}

