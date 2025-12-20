import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import useBreadcrumbStore from '@/stores/breadcrumb-store';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  AlertCircle,
  HardDrive,
  FileText,
  Users,
  Bell,
  BellOff,
  ExternalLink,
  Tag,
  Calendar,
  User,
  FolderOpen,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  Dataset,
  DatasetStatus,
  DatasetEnvironment,
  DatasetAssetType,
  DatasetSubscriptionResponse,
  DatasetSubscribersListResponse,
} from '@/types/dataset';
import {
  DATASET_STATUS_LABELS,
  DATASET_STATUS_COLORS,
  DATASET_ENVIRONMENT_LABELS,
  DATASET_ENVIRONMENT_COLORS,
  DATASET_ASSET_TYPE_LABELS,
} from '@/types/dataset';
import { RelativeDate } from '@/components/common/relative-date';
import DatasetFormDialog from '@/components/datasets/dataset-form-dialog';

export default function DatasetDetails() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const setStaticSegments = useBreadcrumbStore((state) => state.setStaticSegments);
  const setDynamicTitle = useBreadcrumbStore((state) => state.setDynamicTitle);

  // Data state
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscription state
  const [subscriptionStatus, setSubscriptionStatus] = useState<DatasetSubscriptionResponse | null>(null);
  const [subscribers, setSubscribers] = useState<DatasetSubscribersListResponse | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  // Dialog state
  const [openEditDialog, setOpenEditDialog] = useState(false);

  // Fetch dataset
  const fetchDataset = useCallback(async () => {
    if (!datasetId) return;

    try {
      setLoading(true);
      const response = await fetch(`/api/datasets/${datasetId}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Dataset not found');
        }
        throw new Error('Failed to fetch dataset');
      }
      const data = await response.json();
      setDataset(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dataset');
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  // Fetch subscription status
  const fetchSubscriptionStatus = useCallback(async () => {
    if (!datasetId) return;

    try {
      const response = await fetch(`/api/datasets/${datasetId}/subscription`);
      if (response.ok) {
        const data = await response.json();
        setSubscriptionStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch subscription status:', err);
    }
  }, [datasetId]);

  // Fetch subscribers
  const fetchSubscribers = useCallback(async () => {
    if (!datasetId) return;

    try {
      const response = await fetch(`/api/datasets/${datasetId}/subscribers`);
      if (response.ok) {
        const data = await response.json();
        setSubscribers(data);
      }
    } catch (err) {
      console.warn('Failed to fetch subscribers:', err);
    }
  }, [datasetId]);

  useEffect(() => {
    fetchDataset();
    fetchSubscriptionStatus();
    fetchSubscribers();
  }, [fetchDataset, fetchSubscriptionStatus, fetchSubscribers]);

  useEffect(() => {
    // Set breadcrumbs
    setStaticSegments([{ label: 'Datasets', href: '/datasets' }]);
    setDynamicTitle(dataset?.name || 'Loading...');

    return () => {
      setStaticSegments([]);
      setDynamicTitle(null);
    };
  }, [setStaticSegments, setDynamicTitle, dataset?.name]);

  // Toggle subscription
  const toggleSubscription = async () => {
    if (!datasetId) return;

    setSubscribing(true);
    try {
      const isSubscribed = subscriptionStatus?.subscribed;
      const method = isSubscribed ? 'DELETE' : 'POST';
      const response = await fetch(`/api/datasets/${datasetId}/subscribe`, {
        method,
      });

      if (!response.ok) throw new Error('Failed to update subscription');

      const data = await response.json();
      setSubscriptionStatus(data);
      fetchSubscribers();

      toast({
        title: isSubscribed ? 'Unsubscribed' : 'Subscribed',
        description: isSubscribed
          ? 'You will no longer receive updates for this dataset'
          : 'You will receive updates for this dataset',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to update subscription',
        variant: 'destructive',
      });
    } finally {
      setSubscribing(false);
    }
  };

  // Delete dataset
  const handleDelete = async () => {
    if (!datasetId || !dataset) return;
    if (!confirm(`Are you sure you want to delete "${dataset.name}"?`)) return;

    try {
      const response = await fetch(`/api/datasets/${datasetId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete dataset');

      toast({
        title: 'Success',
        description: 'Dataset deleted successfully',
      });
      navigate('/datasets');
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to delete dataset',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !dataset) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate('/datasets')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Datasets
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Dataset not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const status = dataset.status as DatasetStatus;
  const environment = dataset.environment as DatasetEnvironment;
  const assetType = dataset.asset_type as DatasetAssetType;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/datasets')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{dataset.name}</h1>
              <Badge
                variant="outline"
                className={DATASET_STATUS_COLORS[status] || 'bg-gray-100'}
              >
                {DATASET_STATUS_LABELS[status] || status}
              </Badge>
              <Badge
                variant="outline"
                className={DATASET_ENVIRONMENT_COLORS[environment] || 'bg-gray-100'}
              >
                {DATASET_ENVIRONMENT_LABELS[environment] || environment}
              </Badge>
              {dataset.published && (
                <Badge variant="secondary">Published</Badge>
              )}
            </div>
            {dataset.description && (
              <p className="text-muted-foreground mt-1">{dataset.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleSubscription}
                  disabled={subscribing}
                >
                  {subscriptionStatus?.subscribed ? (
                    <BellOff className="h-4 w-4" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{subscriptionStatus?.subscribed ? 'Unsubscribe' : 'Subscribe'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="outline" onClick={() => setOpenEditDialog(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Asset Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Asset Information
              </CardTitle>
              <CardDescription>
                Unity Catalog location for this dataset
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Asset Type
                  </label>
                  <p className="text-sm">
                    {DATASET_ASSET_TYPE_LABELS[assetType] || assetType}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Version
                  </label>
                  <p className="text-sm">{dataset.version || '-'}</p>
                </div>
              </div>
              <Separator />
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Full Path
                </label>
                <p className="font-mono text-sm bg-muted p-2 rounded mt-1">
                  {dataset.catalog_name}.{dataset.schema_name}.{dataset.object_name}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Catalog
                  </label>
                  <p className="text-sm font-mono">{dataset.catalog_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Schema
                  </label>
                  <p className="text-sm font-mono">{dataset.schema_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Object
                  </label>
                  <p className="text-sm font-mono">{dataset.object_name}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contract Link */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Data Contract
              </CardTitle>
              <CardDescription>
                The contract this dataset implements
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataset.contract_id ? (
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{dataset.contract_name || 'Linked Contract'}</p>
                    <p className="text-sm text-muted-foreground">
                      This dataset implements the schema and quality requirements from this contract
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <Link to={`/data-contracts/${dataset.contract_id}`}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Contract
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No contract assigned</p>
                  <p className="text-sm">
                    Assign a contract to define schema and quality requirements
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscribers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Subscribers
                {subscribers && (
                  <Badge variant="secondary">{subscribers.subscriber_count}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Users receiving updates about this dataset
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscribers && subscribers.subscribers.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Subscribed</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribers.subscribers.map((sub, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{sub.email}</TableCell>
                        <TableCell>
                          <RelativeDate date={sub.subscribed_at} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {sub.reason || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No subscribers yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Ownership */}
          <Card>
            <CardHeader>
              <CardTitle>Ownership</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <label className="text-xs text-muted-foreground">Owner Team</label>
                  <p className="text-sm">{dataset.owner_team_name || 'Not assigned'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <div>
                  <label className="text-xs text-muted-foreground">Project</label>
                  <p className="text-sm">{dataset.project_name || 'Not assigned'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          {dataset.tags && dataset.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {dataset.tags.map((tag, idx) => (
                    <Badge key={idx} variant="secondary">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Audit Info */}
          <Card>
            <CardHeader>
              <CardTitle>Audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <label className="text-xs text-muted-foreground">Created</label>
                  <p className="text-sm">
                    <RelativeDate date={dataset.created_at} />
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <label className="text-xs text-muted-foreground">Updated</label>
                  <p className="text-sm">
                    <RelativeDate date={dataset.updated_at} />
                  </p>
                </div>
              </div>
              {dataset.created_by && (
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <label className="text-xs text-muted-foreground">Created by</label>
                    <p className="text-sm">{dataset.created_by}</p>
                  </div>
                </div>
              )}
              {dataset.updated_by && (
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <label className="text-xs text-muted-foreground">Updated by</label>
                    <p className="text-sm">{dataset.updated_by}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Dialog */}
      <DatasetFormDialog
        open={openEditDialog}
        onOpenChange={setOpenEditDialog}
        dataset={dataset}
        onSuccess={() => {
          fetchDataset();
          setOpenEditDialog(false);
        }}
      />
    </div>
  );
}

