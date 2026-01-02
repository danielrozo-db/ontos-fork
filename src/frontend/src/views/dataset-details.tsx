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
  DatasetInstance,
  DatasetInstanceListResponse,
} from '@/types/dataset';
import {
  DATASET_STATUS_LABELS,
  DATASET_STATUS_COLORS,
  DATASET_ENVIRONMENT_LABELS,
  DATASET_ENVIRONMENT_COLORS,
  DATASET_ASSET_TYPE_LABELS,
  DATASET_INSTANCE_STATUS_LABELS,
  DATASET_INSTANCE_STATUS_COLORS,
} from '@/types/dataset';
import type { DatasetInstanceStatus } from '@/types/dataset';
import { RelativeDate } from '@/components/common/relative-date';
import DatasetFormDialog from '@/components/datasets/dataset-form-dialog';
import DatasetInstanceFormDialog from '@/components/datasets/dataset-instance-form-dialog';
import EntityMetadataPanel from '@/components/metadata/entity-metadata-panel';
import TagChip from '@/components/ui/tag-chip';
import { CommentSidebar } from '@/components/comments';
import ConceptSelectDialog from '@/components/semantic/concept-select-dialog';
import LinkedConceptChips from '@/components/semantic/linked-concept-chips';
import type { EntitySemanticLink } from '@/types/semantic-link';
import { Label } from '@/components/ui/label';
import { Plus, MessageSquare, Server, Database } from 'lucide-react';

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
  const [isCommentSidebarOpen, setIsCommentSidebarOpen] = useState(false);
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [openInstanceDialog, setOpenInstanceDialog] = useState(false);
  const [editingInstance, setEditingInstance] = useState<DatasetInstance | null>(null);

  // Semantic links state
  const [semanticLinks, setSemanticLinks] = useState<EntitySemanticLink[]>([]);

  // Instances state
  const [instances, setInstances] = useState<DatasetInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

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

  // Fetch semantic links
  const fetchSemanticLinks = useCallback(async () => {
    if (!datasetId) return;

    try {
      const response = await fetch(`/api/semantic-links/entity/dataset/${datasetId}`);
      if (response.ok) {
        const data = await response.json();
        setSemanticLinks(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Failed to fetch semantic links:', err);
      setSemanticLinks([]);
    }
  }, [datasetId]);

  // Fetch instances
  const fetchInstances = useCallback(async () => {
    if (!datasetId) return;

    try {
      setInstancesLoading(true);
      const response = await fetch(`/api/datasets/${datasetId}/instances`);
      if (response.ok) {
        const data: DatasetInstanceListResponse = await response.json();
        setInstances(data.instances || []);
      }
    } catch (err) {
      console.warn('Failed to fetch instances:', err);
      setInstances([]);
    } finally {
      setInstancesLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    fetchDataset();
    fetchSubscriptionStatus();
    fetchSubscribers();
    fetchSemanticLinks();
    fetchInstances();
  }, [fetchDataset, fetchSubscriptionStatus, fetchSubscribers, fetchSemanticLinks, fetchInstances]);

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

  // Add semantic link
  const addSemanticLink = async (iri: string) => {
    if (!datasetId) return;
    try {
      const response = await fetch('/api/semantic-links/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_id: datasetId,
          entity_type: 'dataset',
          iri,
        }),
      });
      if (!response.ok) throw new Error('Failed to add concept');
      await fetchSemanticLinks();
      setConceptDialogOpen(false);
      toast({ title: 'Linked', description: 'Business concept linked to dataset.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to link business concept',
        variant: 'destructive',
      });
    }
  };

  // Remove semantic link
  const removeSemanticLink = async (linkId: string) => {
    try {
      const response = await fetch(`/api/semantic-links/${linkId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to remove concept');
      await fetchSemanticLinks();
      toast({ title: 'Unlinked', description: 'Business concept unlinked from dataset.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to unlink business concept',
        variant: 'destructive',
      });
    }
  };

  // Delete instance
  const handleDeleteInstance = async (instanceId: string) => {
    if (!datasetId) return;
    if (!confirm('Are you sure you want to remove this instance?')) return;

    try {
      const response = await fetch(`/api/datasets/${datasetId}/instances/${instanceId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to remove instance');

      toast({
        title: 'Success',
        description: 'Instance removed successfully',
      });
      fetchInstances();
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to remove instance',
        variant: 'destructive',
      });
    }
  };

  // Edit instance
  const handleEditInstance = (instance: DatasetInstance) => {
    setEditingInstance(instance);
    setOpenInstanceDialog(true);
  };

  // Add new instance
  const handleAddInstance = () => {
    setEditingInstance(null);
    setOpenInstanceDialog(true);
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
          <CommentSidebar
            entityType="dataset"
            entityId={datasetId!}
            isOpen={isCommentSidebarOpen}
            onToggle={() => setIsCommentSidebarOpen(!isCommentSidebarOpen)}
            className="h-8"
          />
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

          {/* Physical Instances */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    Physical Instances
                    {instances.length > 0 && (
                      <Badge variant="secondary">{instances.length}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Physical implementations across different systems and environments
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleAddInstance}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Instance
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {instancesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : instances.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>System</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Physical Path</TableHead>
                      <TableHead>Contract Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {instances.map((instance) => {
                      const instStatus = instance.status as DatasetInstanceStatus;
                      return (
                        <TableRow key={instance.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4 text-muted-foreground" />
                              <span className="capitalize">
                                {instance.server_type || 'Unknown'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {instance.server_environment || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-sm bg-muted px-2 py-1 rounded">
                              {instance.physical_path}
                            </code>
                          </TableCell>
                          <TableCell>
                            {instance.contract_name ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/data-contracts/${instance.contract_id}`}
                                      className="text-sm hover:underline text-blue-600 dark:text-blue-400"
                                    >
                                      {instance.contract_version || 'View'}
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{instance.contract_name}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={DATASET_INSTANCE_STATUS_COLORS[instStatus] || 'bg-gray-100'}
                            >
                              {DATASET_INSTANCE_STATUS_LABELS[instStatus] || instStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditInstance(instance)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteInstance(instance.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No physical instances</p>
                  <p className="text-sm">
                    Add instances to track where this dataset is physically implemented
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={handleAddInstance}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Instance
                  </Button>
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Tags
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dataset.tags && dataset.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {dataset.tags.map((tag, idx) => (
                    <TagChip key={idx} tag={tag.name} size="sm" />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No tags</p>
              )}
            </CardContent>
          </Card>

          {/* Semantic Links / Business Concepts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Business Concepts</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConceptDialogOpen(true)}
                  className="h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {semanticLinks.length > 0 ? (
                <LinkedConceptChips
                  links={semanticLinks}
                  onRemove={(id) => removeSemanticLink(id)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No linked concepts</p>
              )}
            </CardContent>
          </Card>

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

      {/* Metadata Panel - Rich texts, links, documents */}
      {datasetId && (
        <EntityMetadataPanel entityId={datasetId} entityType="dataset" />
      )}

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

      {/* Concept Select Dialog */}
      <ConceptSelectDialog
        isOpen={conceptDialogOpen}
        onOpenChange={setConceptDialogOpen}
        onSelect={addSemanticLink}
      />

      {/* Instance Form Dialog */}
      {datasetId && (
        <DatasetInstanceFormDialog
          open={openInstanceDialog}
          onOpenChange={(open) => {
            setOpenInstanceDialog(open);
            if (!open) setEditingInstance(null);
          }}
          datasetId={datasetId}
          instance={editingInstance}
          onSuccess={() => {
            fetchInstances();
            setOpenInstanceDialog(false);
            setEditingInstance(null);
          }}
        />
      )}
    </div>
  );
}

