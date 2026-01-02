/**
 * Dataset Types
 *
 * Datasets represent physical implementations of Data Contracts.
 * A Dataset is a Unity Catalog table or view in a specific SDLC environment.
 */

// =============================================================================
// Enums / Type Unions
// =============================================================================

export type DatasetStatus = 'draft' | 'active' | 'deprecated' | 'retired';

export type DatasetAssetType = 'table' | 'view';

export type DatasetEnvironment = 'dev' | 'staging' | 'prod' | 'test' | 'qa' | 'uat';

// =============================================================================
// Tag Types
// =============================================================================

export interface DatasetTag {
  id?: string;
  name: string;
}

// =============================================================================
// Custom Property Types
// =============================================================================

export interface DatasetCustomProperty {
  id?: string;
  property: string;
  value?: string;
}

// =============================================================================
// Subscription Types
// =============================================================================

export interface DatasetSubscription {
  id: string;
  dataset_id: string;
  subscriber_email: string;
  subscribed_at: string;
  subscription_reason?: string;
}

export interface DatasetSubscriptionCreate {
  reason?: string;
}

export interface DatasetSubscriptionResponse {
  subscribed: boolean;
  subscription?: DatasetSubscription;
}

export interface DatasetSubscriberInfo {
  email: string;
  subscribed_at: string;
  reason?: string;
}

export interface DatasetSubscribersListResponse {
  dataset_id: string;
  subscriber_count: number;
  subscribers: DatasetSubscriberInfo[];
}

// =============================================================================
// Instance Types (Physical Implementations)
// =============================================================================

export type DatasetInstanceStatus = 'active' | 'deprecated' | 'retired';

export interface DatasetInstance {
  id: string;
  dataset_id: string;

  // Contract linkage
  contract_id?: string;
  contract_name?: string;
  contract_version?: string;

  // Server linkage (from contract)
  contract_server_id?: string;
  server_type?: string;
  server_environment?: string;
  server_name?: string;

  // Physical location
  physical_path: string;

  // Instance status
  status: DatasetInstanceStatus;
  notes?: string;

  // Audit
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

export interface DatasetInstanceCreate {
  contract_id?: string;
  contract_server_id?: string;
  physical_path: string;
  status?: DatasetInstanceStatus;
  notes?: string;
}

export interface DatasetInstanceUpdate {
  contract_id?: string;
  contract_server_id?: string;
  physical_path?: string;
  status?: DatasetInstanceStatus;
  notes?: string;
}

export interface DatasetInstanceListResponse {
  dataset_id: string;
  instance_count: number;
  instances: DatasetInstance[];
}

export const DATASET_INSTANCE_STATUS_LABELS: Record<DatasetInstanceStatus, string> = {
  active: 'Active',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

export const DATASET_INSTANCE_STATUS_COLORS: Record<DatasetInstanceStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  deprecated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  retired: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

// =============================================================================
// Dataset List Item (Lightweight for list views)
// =============================================================================

export interface DatasetListItem {
  id: string;
  name: string;
  asset_type: DatasetAssetType;
  catalog_name: string;
  schema_name: string;
  object_name: string;
  full_path?: string;
  environment: DatasetEnvironment;
  status: DatasetStatus;
  published: boolean;
  contract_id?: string;
  contract_name?: string;
  owner_team_id?: string;
  owner_team_name?: string;
  created_at?: string;
  updated_at?: string;
  subscriber_count?: number;
  instance_count?: number;
}

// =============================================================================
// Full Dataset Model
// =============================================================================

export interface Dataset {
  id: string;
  name: string;
  description?: string;

  // Physical asset reference
  asset_type: DatasetAssetType;
  catalog_name: string;
  schema_name: string;
  object_name: string;

  // SDLC environment
  environment: DatasetEnvironment;

  // Contract reference
  contract_id?: string;
  contract_name?: string;

  // Ownership and project
  owner_team_id?: string;
  owner_team_name?: string;
  project_id?: string;
  project_name?: string;

  // Lifecycle
  status: DatasetStatus;
  version?: string;
  published: boolean;

  // Related data
  tags?: DatasetTag[];
  custom_properties?: DatasetCustomProperty[];
  instances?: DatasetInstance[];
  subscriber_count?: number;
  instance_count?: number;

  // Audit
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

// =============================================================================
// Create/Update Models
// =============================================================================

export interface DatasetCreate {
  name: string;
  description?: string;

  // Physical asset reference
  asset_type: DatasetAssetType;
  catalog_name: string;
  schema_name: string;
  object_name: string;

  // SDLC environment
  environment: DatasetEnvironment;

  // Contract reference
  contract_id?: string;

  // Ownership and project
  owner_team_id?: string;
  project_id?: string;

  // Lifecycle
  status?: DatasetStatus;
  version?: string;
  published?: boolean;

  // Optional related data
  tags?: { name: string }[];
  custom_properties?: { property: string; value?: string }[];
}

export interface DatasetUpdate {
  name?: string;
  description?: string;

  // Physical asset reference
  asset_type?: DatasetAssetType;
  catalog_name?: string;
  schema_name?: string;
  object_name?: string;

  // SDLC environment
  environment?: DatasetEnvironment;

  // Contract reference
  contract_id?: string;

  // Ownership and project
  owner_team_id?: string;
  project_id?: string;

  // Lifecycle
  status?: DatasetStatus;
  version?: string;
  published?: boolean;

  // Optional related data
  tags?: { name: string }[];
  custom_properties?: { property: string; value?: string }[];
}

// =============================================================================
// Filter/Query Types
// =============================================================================

export interface DatasetFilter {
  environment?: DatasetEnvironment;
  status?: DatasetStatus;
  asset_type?: DatasetAssetType;
  contract_id?: string;
  owner_team_id?: string;
  project_id?: string;
  published?: boolean;
  catalog_name?: string;
  search?: string;
}

// =============================================================================
// Asset Validation Types
// =============================================================================

export interface AssetValidationResult {
  exists: boolean;
  validated: boolean;
  message?: string;
  asset_type?: string;
  name?: string;
  catalog?: string;
  schema?: string;
}

// =============================================================================
// Status / Environment Display Helpers
// =============================================================================

export const DATASET_STATUS_LABELS: Record<DatasetStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

export const DATASET_STATUS_COLORS: Record<DatasetStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  deprecated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  retired: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export const DATASET_ENVIRONMENT_LABELS: Record<DatasetEnvironment, string> = {
  dev: 'Development',
  staging: 'Staging',
  prod: 'Production',
  test: 'Test',
  qa: 'QA',
  uat: 'UAT',
};

export const DATASET_ENVIRONMENT_COLORS: Record<DatasetEnvironment, string> = {
  dev: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  staging: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  prod: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  test: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  qa: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  uat: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
};

export const DATASET_ASSET_TYPE_LABELS: Record<DatasetAssetType, string> = {
  table: 'Table',
  view: 'View',
};

