import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

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
import { Loader2 } from 'lucide-react';

import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { MdmEntityType, MdmConfigCreate } from '@/types/mdm';

interface DataContract {
  id: string;
  name: string;
  status: string;
}

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  entity_type: z.nativeEnum(MdmEntityType),
  master_contract_id: z.string().min(1, 'Master contract is required'),
});

type FormValues = z.infer<typeof formSchema>;

interface MdmConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MdmConfigDialog({ isOpen, onClose, onSuccess }: MdmConfigDialogProps) {
  const [contracts, setContracts] = useState<DataContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { get, post } = useApi();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      entity_type: MdmEntityType.CUSTOMER,
      master_contract_id: '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      fetchContracts();
      form.reset();
    }
  }, [isOpen]);

  const fetchContracts = async () => {
    setLoading(true);
    try {
      const response = await get<DataContract[]>('/api/data-contracts');
      if (response.data) {
        // Filter to only active contracts
        const activeContracts = response.data.filter(c => c.status === 'active');
        setContracts(activeContracts);
      }
    } catch (err) {
      console.error('Error fetching contracts:', err);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const data: MdmConfigCreate = {
        name: values.name,
        description: values.description || undefined,
        entity_type: values.entity_type,
        master_contract_id: values.master_contract_id,
        // Default matching rules for prototype
        matching_rules: [
          {
            name: 'exact_id',
            type: 'deterministic' as any,
            fields: ['id'],
            weight: 1.0,
            threshold: 1.0,
          },
          {
            name: 'fuzzy_name',
            type: 'probabilistic' as any,
            fields: ['name'],
            weight: 0.8,
            threshold: 0.8,
            algorithm: 'jaro_winkler',
          },
        ],
        survivorship_rules: [
          {
            field: 'name',
            strategy: 'most_complete' as any,
          },
          {
            field: 'email',
            strategy: 'most_recent' as any,
          },
        ],
      };

      const response = await post('/api/mdm/configs', data);
      if (response.data) {
        toast({ title: 'Success', description: 'MDM configuration created successfully' });
        onSuccess();
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to create configuration',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New MDM Configuration</DialogTitle>
          <DialogDescription>
            Create a master data management configuration tied to a data contract.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Configuration Name</Label>
            <Input
              id="name"
              placeholder="e.g., Customer Master"
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe the purpose of this MDM configuration..."
              rows={3}
              {...form.register('description')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="entity_type">Entity Type</Label>
            <Select
              value={form.watch('entity_type')}
              onValueChange={(value) => form.setValue('entity_type', value as MdmEntityType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select entity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MdmEntityType.CUSTOMER}>Customer</SelectItem>
                <SelectItem value={MdmEntityType.PRODUCT}>Product</SelectItem>
                <SelectItem value={MdmEntityType.SUPPLIER}>Supplier</SelectItem>
                <SelectItem value={MdmEntityType.LOCATION}>Location</SelectItem>
                <SelectItem value={MdmEntityType.OTHER}>Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="master_contract">Master Data Contract</Label>
            <Select
              value={form.watch('master_contract_id')}
              onValueChange={(value) => form.setValue('master_contract_id', value)}
              disabled={loading}
            >
              <SelectTrigger>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <SelectValue placeholder="Select master contract" />
                )}
              </SelectTrigger>
              <SelectContent>
                {contracts.map((contract) => (
                  <SelectItem key={contract.id} value={contract.id}>
                    {contract.name}
                  </SelectItem>
                ))}
                {contracts.length === 0 && !loading && (
                  <SelectItem value="_none" disabled>
                    No active contracts available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {form.formState.errors.master_contract_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.master_contract_id.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Configuration
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

