import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import type {
  Dataset,
  DatasetCreate,
  DatasetUpdate,
  DatasetAssetType,
  DatasetEnvironment,
  DatasetStatus,
} from '@/types/dataset';

interface DatasetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset?: Dataset; // If provided, we're in edit mode
  onSuccess: () => void;
}

interface FormData {
  name: string;
  description: string;
  asset_type: DatasetAssetType;
  catalog_name: string;
  schema_name: string;
  object_name: string;
  environment: DatasetEnvironment;
  contract_id: string;
  owner_team_id: string;
  project_id: string;
  status: DatasetStatus;
  version: string;
  published: boolean;
}

export default function DatasetFormDialog({
  open,
  onOpenChange,
  dataset,
  onSuccess,
}: DatasetFormDialogProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [contracts, setContracts] = useState<{ id: string; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const isEditMode = !!dataset;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: '',
      description: '',
      asset_type: 'table',
      catalog_name: '',
      schema_name: '',
      object_name: '',
      environment: 'dev',
      contract_id: '',
      owner_team_id: '',
      project_id: '',
      status: 'draft',
      version: '',
      published: false,
    },
  });

  // Load reference data
  useEffect(() => {
    if (open) {
      // Fetch contracts
      fetch('/api/data-contracts')
        .then((res) => res.json())
        .then((data) => setContracts(data.map((c: any) => ({ id: c.id, name: c.name }))))
        .catch(console.error);

      // Fetch teams
      fetch('/api/teams')
        .then((res) => res.json())
        .then((data) => setTeams(data.map((t: any) => ({ id: t.id, name: t.name }))))
        .catch(console.error);

      // Fetch projects
      fetch('/api/projects')
        .then((res) => res.json())
        .then((data) => setProjects(data.map((p: any) => ({ id: p.id, name: p.name }))))
        .catch(console.error);
    }
  }, [open]);

  // Reset form when dialog opens/closes or dataset changes
  useEffect(() => {
    if (open) {
      if (dataset) {
        reset({
          name: dataset.name,
          description: dataset.description || '',
          asset_type: dataset.asset_type as DatasetAssetType,
          catalog_name: dataset.catalog_name,
          schema_name: dataset.schema_name,
          object_name: dataset.object_name,
          environment: dataset.environment as DatasetEnvironment,
          contract_id: dataset.contract_id || '',
          owner_team_id: dataset.owner_team_id || '',
          project_id: dataset.project_id || '',
          status: dataset.status as DatasetStatus,
          version: dataset.version || '',
          published: dataset.published || false,
        });
      } else {
        reset({
          name: '',
          description: '',
          asset_type: 'table',
          catalog_name: '',
          schema_name: '',
          object_name: '',
          environment: 'dev',
          contract_id: '',
          owner_team_id: '',
          project_id: '',
          status: 'draft',
          version: '',
          published: false,
        });
      }
    }
  }, [open, dataset, reset]);

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);

    try {
      const payload: DatasetCreate | DatasetUpdate = {
        name: data.name,
        description: data.description || undefined,
        asset_type: data.asset_type,
        catalog_name: data.catalog_name,
        schema_name: data.schema_name,
        object_name: data.object_name,
        environment: data.environment,
        contract_id: data.contract_id || undefined,
        owner_team_id: data.owner_team_id || undefined,
        project_id: data.project_id || undefined,
        status: data.status,
        version: data.version || undefined,
        published: data.published,
      };

      const url = isEditMode ? `/api/datasets/${dataset.id}` : '/api/datasets';
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to save dataset');
      }

      toast({
        title: 'Success',
        description: isEditMode ? 'Dataset updated successfully' : 'Dataset created successfully',
      });

      onSuccess();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save dataset',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Dataset' : 'Create New Dataset'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the dataset configuration'
              : 'Create a new dataset to represent a physical implementation of a data contract'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="font-medium">Basic Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Sales Data - Production"
                  {...register('name', { required: 'Name is required' })}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={watch('status')}
                  onValueChange={(v) => setValue('status', v as DatasetStatus)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="deprecated">Deprecated</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe this dataset..."
                {...register('description')}
              />
            </div>
          </div>

          {/* Asset Information */}
          <div className="space-y-4">
            <h3 className="font-medium">Unity Catalog Asset</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="asset_type">Asset Type *</Label>
                <Select
                  value={watch('asset_type')}
                  onValueChange={(v) => setValue('asset_type', v as DatasetAssetType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table">Table</SelectItem>
                    <SelectItem value="view">View</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="environment">Environment *</Label>
                <Select
                  value={watch('environment')}
                  onValueChange={(v) => setValue('environment', v as DatasetEnvironment)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dev">Development</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="prod">Production</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="qa">QA</SelectItem>
                    <SelectItem value="uat">UAT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="catalog_name">Catalog *</Label>
                <Input
                  id="catalog_name"
                  placeholder="my_catalog"
                  {...register('catalog_name', { required: 'Catalog is required' })}
                />
                {errors.catalog_name && (
                  <p className="text-sm text-destructive">{errors.catalog_name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="schema_name">Schema *</Label>
                <Input
                  id="schema_name"
                  placeholder="my_schema"
                  {...register('schema_name', { required: 'Schema is required' })}
                />
                {errors.schema_name && (
                  <p className="text-sm text-destructive">{errors.schema_name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="object_name">Object Name *</Label>
                <Input
                  id="object_name"
                  placeholder="my_table"
                  {...register('object_name', { required: 'Object name is required' })}
                />
                {errors.object_name && (
                  <p className="text-sm text-destructive">{errors.object_name.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Contract & Ownership */}
          <div className="space-y-4">
            <h3 className="font-medium">Contract & Ownership</h3>

            <div className="space-y-2">
              <Label htmlFor="contract_id">Data Contract</Label>
              <Select
                value={watch('contract_id') || 'none'}
                onValueChange={(v) => setValue('contract_id', v === 'none' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a contract" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No contract</SelectItem>
                  {contracts.map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Link this dataset to a data contract to define schema and quality requirements
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="owner_team_id">Owner Team</Label>
                <Select
                  value={watch('owner_team_id') || 'none'}
                  onValueChange={(v) => setValue('owner_team_id', v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No owner team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project_id">Project</Label>
                <Select
                  value={watch('project_id') || 'none'}
                  onValueChange={(v) => setValue('project_id', v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Version & Publication */}
          <div className="space-y-4">
            <h3 className="font-medium">Version & Publication</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  placeholder="e.g., 1.0.0"
                  {...register('version')}
                />
              </div>

              <div className="flex items-center space-x-2 pt-7">
                <Switch
                  id="published"
                  checked={watch('published')}
                  onCheckedChange={(v) => setValue('published', v)}
                />
                <Label htmlFor="published">Published to marketplace</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditMode ? 'Save Changes' : 'Create Dataset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

