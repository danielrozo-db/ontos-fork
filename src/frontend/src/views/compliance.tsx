import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { 
  Plus, 
  Scale, 
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
import { ColumnDef } from "@tanstack/react-table";
import { useApi } from '@/hooks/use-api';
import useBreadcrumbStore from '@/stores/breadcrumb-store';
import { DataTable } from '@/components/ui/data-table';
import type { 
  ProcessWorkflow, 
  WorkflowListResponse,
  TriggerType,
  EntityType,
} from '@/types/process-workflow';

interface CompliancePolicy {
  id: string; // UUID
  name: string;
  description: string;
  rule: string;
  compliance: number;
  history: number[];
  created_at: string;
  updated_at: string;
  is_active: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
}

interface ComplianceStats {
  overall_compliance: number;
  active_policies: number;
  critical_issues: number;
}

interface ComplianceApiResponse {
  policies: CompliancePolicy[];
  stats: ComplianceStats;
}

// Helper to get trigger display
const getTriggerDisplay = (trigger: { type: TriggerType; entity_types: EntityType[] }) => {
  const typeLabels: Record<TriggerType, string> = {
    on_create: 'On Create',
    on_update: 'On Update',
    on_delete: 'On Delete',
    on_status_change: 'On Status Change',
    scheduled: 'Scheduled',
    manual: 'Manual',
    before_create: 'Before Create',
    before_update: 'Before Update',
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
    case 'policy_check': return <ClipboardCheck className="h-4 w-4" />;
    default: return <GitBranch className="h-4 w-4" />;
  }
};

export default function Compliance() {
  const { t } = useTranslation(['compliance', 'common']);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { get: apiGet, post: apiPost, put: apiPut, delete: apiDeleteApi, loading: apiIsLoading } = useApi();
  const setStaticSegments = useBreadcrumbStore((state) => state.setStaticSegments);
  const setDynamicTitle = useBreadcrumbStore((state) => state.setDynamicTitle);
  const [policies, setPolicies] = useState<CompliancePolicy[]>([]);
  const [stats, setStats] = useState<ComplianceStats>({
    overall_compliance: 0,
    active_policies: 0,
    critical_issues: 0
  });
  const [selectedPolicy, setSelectedPolicy] = useState<CompliancePolicy | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [componentError, setComponentError] = useState<string | null>(null);
  
  // Workflow state
  const [workflows, setWorkflows] = useState<ProcessWorkflow[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicatingWorkflow, setDuplicatingWorkflow] = useState<ProcessWorkflow | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [isDuplicating, setIsDuplicating] = useState(false);

  const loadPolicies = useCallback(async () => {
    setComponentError(null);
    try {
      const response = await apiGet<ComplianceApiResponse>('/api/compliance/policies');
      if (response.error) {
        throw new Error(response.error);
      }
      if (response.data) {
        setPolicies(response.data.policies || []);
        setStats(response.data.stats || {
          overall_compliance: 0,
          active_policies: 0,
          critical_issues: 0
        });
      } else {
        setPolicies([]);
        setStats({ overall_compliance: 0, active_policies: 0, critical_issues: 0 });
        throw new Error("No data received from compliance policies endpoint.");
      }
    } catch (error) {
      console.error('Error loading policies:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load compliance policies";
      setComponentError(errorMessage);
      toast({
        title: t('compliance:errors.loadingPolicies'),
        description: errorMessage,
        variant: "destructive"
      });
      setPolicies([]);
      setStats({ overall_compliance: 0, active_policies: 0, critical_issues: 0 });
    }
  }, [apiGet, toast]);

  const loadWorkflows = useCallback(async () => {
    setIsLoadingWorkflows(true);
    try {
      const response = await apiGet<WorkflowListResponse>('/api/workflows');
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
      setIsLoadingWorkflows(false);
    }
  }, [apiGet, toast]);

  useEffect(() => {
    loadPolicies();
    loadWorkflows();
    setStaticSegments([]);
    setDynamicTitle(t('compliance:title'));

    return () => {
        setStaticSegments([]);
        setDynamicTitle(null);
    };
  }, [loadPolicies, loadWorkflows, setStaticSegments, setDynamicTitle]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setComponentError(null);
    try {
      const form = event.target as HTMLFormElement;
      const policyData: Omit<CompliancePolicy, 'id' | 'created_at' | 'updated_at' | 'compliance' | 'history'> & Partial<Pick<CompliancePolicy, 'id' | 'compliance' | 'history' | 'created_at' | 'updated_at'>> = {
        name: (form.querySelector('#name') as HTMLInputElement).value,
        description: (form.querySelector('#description') as HTMLTextAreaElement).value,
        category: (form.querySelector('select[name="category"]') as HTMLSelectElement)?.value || 'General',
        severity: (form.querySelector('select[name="severity"]') as HTMLSelectElement)?.value as CompliancePolicy['severity'] || 'medium',
        rule: (form.querySelector('#rule') as HTMLTextAreaElement).value,
        is_active: selectedPolicy?.is_active ?? true,
      };

      let response;
      if (selectedPolicy?.id) {
        const updatePayload: CompliancePolicy = {
          ...selectedPolicy,
          ...policyData,
          updated_at: new Date().toISOString(),
        };
        response = await apiPut<CompliancePolicy>(`/api/compliance/policies/${selectedPolicy.id}`, updatePayload);
      } else {
        const createPayload: Omit<CompliancePolicy, 'id'> = {
          ...policyData,
          compliance: 0,
          history: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Omit<CompliancePolicy, 'id'>;
        response = await apiPost<CompliancePolicy>('/api/compliance/policies', createPayload);
      }
      
      if (response.error || !response.data) {
        throw new Error(response.error || 'Failed to save policy: No data returned');
      }
      
      toast({
        title: t('common:toast.success'),
        description: t('compliance:toast.policySaved', { name: response.data.name })
      });
      
      setIsDialogOpen(false);
      loadPolicies();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save policy";
      setComponentError(errorMessage);
      toast({
        variant: "destructive",
        title: t('compliance:errors.savingPolicy'),
        description: errorMessage
      });
    }
  };

  const handleDelete = async (id: string) => {
    setComponentError(null);
    try {
      const response = await apiDeleteApi(`/api/compliance/policies/${id}`);
      
      if (response.error) {
        throw new Error(response.error || 'Failed to delete policy');
      }
      
      toast({
        title: t('common:toast.success'),
        description: t('compliance:toast.policyDeleted')
      });
      
      loadPolicies();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete policy";
      setComponentError(errorMessage);
      toast({
        variant: "destructive",
        title: t('compliance:errors.deletingPolicy'),
        description: errorMessage
      });
    }
  };

  const overallCompliance = stats.overall_compliance;
  const activePolicies = stats.active_policies;
  const criticalIssues = stats.critical_issues;

  const handleCreateRule = () => {
    setSelectedPolicy(null);
    setIsDialogOpen(true);
  };

  const handleEditRule = (policy: CompliancePolicy) => {
    setSelectedPolicy(policy);
    setIsDialogOpen(true);
  };

  const getComplianceColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSeverityBadge = (severity: string) => {
    const variants = {
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800'
    };
    return variants[severity as keyof typeof variants] || 'bg-gray-100 text-gray-800';
  };

  // Workflow handlers
  const handleToggleWorkflowActive = async (workflow: ProcessWorkflow) => {
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

  const handleDeleteWorkflow = async (workflow: ProcessWorkflow) => {
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

  const handleEditWorkflow = (workflow: ProcessWorkflow) => {
    navigate(`/compliance/workflows/${workflow.id}`);
  };

  const handleLoadDefaultWorkflows = async () => {
    try {
      const response = await apiPost<{ message: string }>('/api/workflows/load-defaults', {});
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

  const columns: ColumnDef<CompliancePolicy>[] = [
    {
      accessorKey: "name",
      header: t('common:labels.name'),
      cell: ({ row }) => (
        <div className="font-medium">{row.getValue("name")}</div>
      ),
    },
    {
      accessorKey: "category",
      header: t('common:labels.category'),
      cell: ({ row }) => (
        <Badge variant="outline">{row.getValue("category")}</Badge>
      ),
    },
    {
      accessorKey: "severity",
      header: t('common:labels.severity'),
      cell: ({ row }) => (
        <Badge className={getSeverityBadge(row.getValue("severity"))}>
          {row.getValue("severity")}
        </Badge>
      ),
    },
    {
      accessorKey: "compliance",
      header: t('common:labels.compliance'),
      cell: ({ row }) => (
        <div className={`font-semibold ${getComplianceColor(row.getValue("compliance"))}`}>
          {row.getValue("compliance")}%
        </div>
      ),
    },
    {
      accessorKey: "is_active",
      header: t('common:labels.status'),
      cell: ({ row }) => (
        <Badge variant={row.getValue("is_active") ? "default" : "secondary"}>
          {row.getValue("is_active") ? t('common:labels.active') : t('common:labels.inactive')}
        </Badge>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const policy = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">{t('common:actions.open')}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('common:labels.actions')}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleEditRule(policy)}>
                {t('common:actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => handleDelete(policy.id)}
              >
                {t('common:actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const workflowColumns: ColumnDef<ProcessWorkflow>[] = [
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
            onCheckedChange={() => handleToggleWorkflowActive(row.original)}
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
            <DropdownMenuItem onClick={() => handleEditWorkflow(row.original)}>
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
              onClick={() => handleDeleteWorkflow(row.original)}
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
    <div className="py-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
          <Scale className="w-8 h-8" />
          {t('compliance:title')}
        </h1>
        <Button onClick={handleCreateRule} className="gap-2" disabled={apiIsLoading}>
          <Plus className="h-4 w-4" />
          {t('compliance:createRule')}
        </Button>
      </div>

      {apiIsLoading && !isDialogOpen && (
        <div className="flex justify-center items-center h-64">
          <p>{t('compliance:loading')}</p>
        </div>
      )}

      {componentError && (
         <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
           <strong className="font-bold">Error: </strong>
           <span className="block sm:inline">{componentError}</span>
         </div>
      )}

      {!apiIsLoading && !componentError && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('compliance:stats.overallCompliance')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${getComplianceColor(overallCompliance)}`}>
                  {overallCompliance.toFixed(0)}%
                </div>
                <p className="text-sm text-muted-foreground mt-2">{t('compliance:stats.acrossAllRules')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('compliance:stats.activeRules')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{activePolicies}</div>
                <p className="text-sm text-muted-foreground mt-2">{t('compliance:stats.currentlyEnforced')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('compliance:stats.criticalIssues')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-red-600">{criticalIssues}</div>
                <p className="text-sm text-muted-foreground mt-2">{t('compliance:stats.requireAttention')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('compliance:stats.lastUpdated')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{t('compliance:stats.today')}</div>
                <p className="text-sm text-muted-foreground mt-2">12:30 PM</p>
              </CardContent>
            </Card>
          </div>

          <DataTable
            columns={columns}
            data={policies}
            searchColumn="name"
            storageKey="compliance-policies-sort"
            onRowClick={(row) => navigate(`/compliance/policies/${row.original.id}`)}
          />

          {/* Workflows Section */}
          <Separator className="my-8" />
          
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5" />
                    Process Workflows
                  </CardTitle>
                  <CardDescription>
                    Configure automated workflows for validation, approval, and notifications. 
                    Use policy_check steps to reference compliance policies above.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleLoadDefaultWorkflows}>
                    <Clock className="h-4 w-4 mr-2" />
                    Load Defaults
                  </Button>
                  <Button onClick={() => navigate('/compliance/workflows/new')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Workflow
                  </Button>
                </div>
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
                  <p className="text-sm">Click "Load Defaults" to get started with default workflows.</p>
                </div>
              ) : (
                <DataTable 
                  columns={workflowColumns} 
                  data={workflows}
                  searchColumn="name"
                  storageKey="compliance-workflows-sort"
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
                  Cancel
                </Button>
                <Button onClick={handleDuplicateWorkflow} disabled={isDuplicating || !duplicateName.trim()}>
                  {isDuplicating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Duplicate
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {selectedPolicy ? t('compliance:editRule') : t('compliance:createNewRule')}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('common:labels.name')}</Label>
                  <Input
                    id="name"
                    defaultValue={selectedPolicy?.name}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">{t('common:labels.description')}</Label>
                  <Textarea
                    id="description"
                    defaultValue={selectedPolicy?.description}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">{t('common:labels.category')}</Label>
                  <Select defaultValue={selectedPolicy?.category}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('common:placeholders.selectCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Security">{t('compliance:categories.security')}</SelectItem>
                      <SelectItem value="Data Quality">{t('compliance:categories.dataQuality')}</SelectItem>
                      <SelectItem value="Privacy">{t('compliance:categories.privacy')}</SelectItem>
                      <SelectItem value="Governance">{t('compliance:categories.governance')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="severity">{t('common:labels.severity')}</Label>
                  <Select defaultValue={selectedPolicy?.severity}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('common:placeholders.selectSeverity')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t('compliance:severity.low')}</SelectItem>
                      <SelectItem value="medium">{t('compliance:severity.medium')}</SelectItem>
                      <SelectItem value="high">{t('compliance:severity.high')}</SelectItem>
                      <SelectItem value="critical">{t('compliance:severity.critical')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule">{t('compliance:form.ruleCode')}</Label>
                  <Textarea
                    id="rule"
                    defaultValue={selectedPolicy?.rule}
                    className="font-mono text-sm"
                    rows={8}
                    required
                    placeholder={t('compliance:form.rulePlaceholder')}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={apiIsLoading}>
                    {t('common:actions.cancel')}
                  </Button>
                  <Button type="submit" disabled={apiIsLoading}>
                    {apiIsLoading ? t('common:states.saving') : t('common:actions.save')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
} 