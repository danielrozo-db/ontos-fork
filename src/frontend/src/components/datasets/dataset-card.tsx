import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HardDrive, FileText, Users, Bell } from 'lucide-react';
import { RelativeDate } from '@/components/common/relative-date';
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

interface DatasetCardProps {
  dataset: DatasetListItem;
}

export default function DatasetCard({ dataset }: DatasetCardProps) {
  const status = dataset.status as DatasetStatus;
  const environment = dataset.environment as DatasetEnvironment;
  const assetType = dataset.asset_type as DatasetAssetType;

  return (
    <Link to={`/datasets/${dataset.id}`}>
      <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">{dataset.name}</CardTitle>
            </div>
            <div className="flex gap-1">
              <Badge
                variant="outline"
                className={DATASET_ENVIRONMENT_COLORS[environment] || 'bg-gray-100'}
              >
                {DATASET_ENVIRONMENT_LABELS[environment] || environment}
              </Badge>
            </div>
          </div>
          <CardDescription className="font-mono text-xs">
            {dataset.full_path || `${dataset.catalog_name}.${dataset.schema_name}.${dataset.object_name}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Type and Status */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {DATASET_ASSET_TYPE_LABELS[assetType] || assetType}
            </Badge>
            <Badge
              variant="outline"
              className={DATASET_STATUS_COLORS[status] || 'bg-gray-100'}
            >
              {DATASET_STATUS_LABELS[status] || status}
            </Badge>
            {dataset.published && (
              <Badge variant="secondary">Published</Badge>
            )}
          </div>

          {/* Contract */}
          {dataset.contract_id && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="truncate">{dataset.contract_name || 'Linked contract'}</span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between text-sm text-muted-foreground pt-2 border-t">
            <div className="flex items-center gap-1">
              {dataset.owner_team_name && (
                <>
                  <Users className="h-3 w-3" />
                  <span className="truncate max-w-[100px]">{dataset.owner_team_name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {dataset.subscriber_count !== undefined && dataset.subscriber_count > 0 && (
                <div className="flex items-center gap-1">
                  <Bell className="h-3 w-3" />
                  <span>{dataset.subscriber_count}</span>
                </div>
              )}
              <RelativeDate date={dataset.updated_at} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

