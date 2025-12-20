import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { RelativeDate } from '@/components/common/relative-date';
import { useToast } from '@/hooks/use-toast';
import useBreadcrumbStore from '@/stores/breadcrumb-store';
import { useProjectContext } from '@/stores/project-store';
import {
  Plus,
  Trash2,
  AlertCircle,
  Search,
  HardDrive,
  FileText,
  Users,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  DatasetListItem,
  DatasetStatus,
  DatasetEnvironment,
  DatasetAssetType,
} from '@/types/dataset';
import {
  DATASET_STATUS_LABELS,
  DATASET_STATUS_COLORS,
  DATASET_ENVIRONMENT_LABELS,
  DATASET_ENVIRONMENT_COLORS,
  DATASET_ASSET_TYPE_LABELS,
} from '@/types/dataset';
import DatasetFormDialog from '@/components/datasets/dataset-form-dialog';

export default function Datasets() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentProject, hasProjectContext } = useProjectContext();
  const setStaticSegments = useBreadcrumbStore((state) => state.setStaticSegments);
  const setDynamicTitle = useBreadcrumbStore((state) => state.setDynamicTitle);

  // Data state
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [openCreateDialog, setOpenCreateDialog] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assetTypeFilter, setAssetTypeFilter] = useState<string>('all');

  // Fetch datasets
  const fetchDatasets = useCallback(async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      if (hasProjectContext && currentProject) {
        params.append('project_id', currentProject.id);
      }
      if (searchQuery) {
        params.append('search', searchQuery);
      }
      if (environmentFilter && environmentFilter !== 'all') {
        params.append('environment', environmentFilter);
      }
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (assetTypeFilter && assetTypeFilter !== 'all') {
        params.append('asset_type', assetTypeFilter);
      }

      const queryString = params.toString();
      const endpoint = `/api/datasets${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch datasets');
      const data = await response.json();
      setDatasets(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch datasets');
    } finally {
      setLoading(false);
    }
  }, [hasProjectContext, currentProject, searchQuery, environmentFilter, statusFilter, assetTypeFilter]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  useEffect(() => {
    // Set breadcrumbs
    setStaticSegments([]);
    setDynamicTitle('Datasets');

    return () => {
      setStaticSegments([]);
      setDynamicTitle(null);
    };
  }, [setStaticSegments, setDynamicTitle]);

  // Delete dataset
  const deleteDataset = async (id: string) => {
    if (!confirm('Are you sure you want to delete this dataset?')) return;

    try {
      const response = await fetch(`/api/datasets/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete dataset');
      await fetchDatasets();
      toast({
        title: 'Success',
        description: 'Dataset deleted successfully',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete dataset';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    }
  };

  // Table columns
  const columns: ColumnDef<DatasetListItem>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span
            className="font-medium text-primary hover:underline cursor-pointer"
            onClick={() => navigate(`/datasets/${row.original.id}`)}
          >
            {row.original.name}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {row.original.full_path || `${row.original.catalog_name}.${row.original.schema_name}.${row.original.object_name}`}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'asset_type',
      header: 'Type',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <HardDrive className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">
            {DATASET_ASSET_TYPE_LABELS[row.original.asset_type as DatasetAssetType] || row.original.asset_type}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'environment',
      header: 'Environment',
      cell: ({ row }) => {
        const env = row.original.environment as DatasetEnvironment;
        return (
          <Badge
            variant="outline"
            className={DATASET_ENVIRONMENT_COLORS[env] || 'bg-gray-100'}
          >
            {DATASET_ENVIRONMENT_LABELS[env] || env}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status as DatasetStatus;
        return (
          <Badge
            variant="outline"
            className={DATASET_STATUS_COLORS[status] || 'bg-gray-100'}
          >
            {DATASET_STATUS_LABELS[status] || status}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'contract_name',
      header: 'Contract',
      cell: ({ row }) => {
        if (!row.original.contract_id) {
          return <span className="text-muted-foreground text-sm">Not assigned</span>;
        }
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/data-contracts/${row.original.contract_id}`);
                  }}
                >
                  <FileText className="h-3 w-3" />
                  <span className="text-sm truncate max-w-[150px]">
                    {row.original.contract_name || 'View Contract'}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>View linked contract</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      accessorKey: 'owner_team_name',
      header: 'Owner',
      cell: ({ row }) => {
        if (!row.original.owner_team_id) {
          return <span className="text-muted-foreground text-sm">-</span>;
        }
        return (
          <div className="flex items-center gap-1">
            <Users className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{row.original.owner_team_name || 'Team'}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'subscriber_count',
      header: 'Subscribers',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.subscriber_count || 0}
        </span>
      ),
    },
    {
      accessorKey: 'updated_at',
      header: 'Updated',
      cell: ({ row }) => (
        <RelativeDate date={row.original.updated_at} />
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDataset(row.original.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Delete dataset</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ),
    },
  ];

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Datasets</h1>
          <p className="text-muted-foreground">
            Physical implementations of data contracts (tables and views)
          </p>
        </div>
        <Button onClick={() => setOpenCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Dataset
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search datasets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={environmentFilter} onValueChange={setEnvironmentFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Environments</SelectItem>
            <SelectItem value="dev">Development</SelectItem>
            <SelectItem value="staging">Staging</SelectItem>
            <SelectItem value="prod">Production</SelectItem>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="qa">QA</SelectItem>
            <SelectItem value="uat">UAT</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deprecated">Deprecated</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assetTypeFilter} onValueChange={setAssetTypeFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="table">Table</SelectItem>
            <SelectItem value="view">View</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={datasets}
        loading={loading}
        onRowClick={(row) => navigate(`/datasets/${row.id}`)}
      />

      {/* Create Dialog */}
      <DatasetFormDialog
        open={openCreateDialog}
        onOpenChange={setOpenCreateDialog}
        onSuccess={() => {
          fetchDatasets();
          setOpenCreateDialog(false);
        }}
      />
    </div>
  );
}

