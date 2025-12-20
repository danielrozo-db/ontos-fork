"""
Datasets API Models

Pydantic models for Dataset CRUD operations.
Datasets represent physical implementations of Data Contracts.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional, Any, Dict

from pydantic import BaseModel, Field


# ============================================================================
# Enums
# ============================================================================

class DatasetStatus(str, Enum):
    """Dataset lifecycle status values."""
    DRAFT = "draft"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    RETIRED = "retired"


class DatasetAssetType(str, Enum):
    """Types of Unity Catalog assets that can be datasets."""
    TABLE = "table"
    VIEW = "view"


class DatasetEnvironment(str, Enum):
    """SDLC environment stages for datasets."""
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"
    # Additional common environments
    TEST = "test"
    QA = "qa"
    UAT = "uat"


# ============================================================================
# Tag Models
# ============================================================================

class DatasetTag(BaseModel):
    """Tag associated with a dataset."""
    id: Optional[str] = None
    name: str = Field(..., description="Tag name")

    model_config = {"from_attributes": True}


class DatasetTagCreate(BaseModel):
    """Model for creating a tag."""
    name: str = Field(..., description="Tag name")


# ============================================================================
# Custom Property Models
# ============================================================================

class DatasetCustomProperty(BaseModel):
    """Custom property key/value pair."""
    id: Optional[str] = None
    property: str = Field(..., description="Property name")
    value: Optional[str] = Field(None, description="Property value")

    model_config = {"from_attributes": True}


class DatasetCustomPropertyCreate(BaseModel):
    """Model for creating a custom property."""
    property: str = Field(..., description="Property name")
    value: Optional[str] = Field(None, description="Property value")


# ============================================================================
# Subscription Models
# ============================================================================

class DatasetSubscription(BaseModel):
    """Subscription to a dataset."""
    id: str = Field(..., description="Subscription ID")
    dataset_id: str = Field(..., description="Dataset ID")
    subscriber_email: str = Field(..., description="Subscriber's email address")
    subscribed_at: datetime = Field(..., description="When the subscription was created")
    subscription_reason: Optional[str] = Field(None, description="Reason for subscribing")

    model_config = {"from_attributes": True}


class DatasetSubscriptionCreate(BaseModel):
    """Model for creating a subscription."""
    reason: Optional[str] = Field(None, description="Optional reason for subscribing")


class DatasetSubscriptionResponse(BaseModel):
    """Response model for subscription operations."""
    subscribed: bool = Field(..., description="Whether the user is currently subscribed")
    subscription: Optional[DatasetSubscription] = Field(None, description="Subscription details if subscribed")


class DatasetSubscriberInfo(BaseModel):
    """Information about a subscriber."""
    email: str = Field(..., description="Subscriber's email address")
    subscribed_at: datetime = Field(..., description="When they subscribed")
    reason: Optional[str] = Field(None, description="Their subscription reason")

    model_config = {"from_attributes": True}


class DatasetSubscribersListResponse(BaseModel):
    """Response model for listing subscribers."""
    dataset_id: str = Field(..., description="Dataset ID")
    subscriber_count: int = Field(..., description="Total number of subscribers")
    subscribers: List[DatasetSubscriberInfo] = Field(default_factory=list, description="List of subscribers")


# ============================================================================
# Dataset List Item (Lightweight for list views)
# ============================================================================

class DatasetListItem(BaseModel):
    """Lightweight dataset representation for list views."""
    id: str = Field(..., description="Unique identifier")
    name: str = Field(..., description="Dataset name")
    asset_type: str = Field(..., description="Asset type (table/view)")
    catalog_name: str = Field(..., description="Unity Catalog name")
    schema_name: str = Field(..., description="Schema name")
    object_name: str = Field(..., description="Object name (table/view)")
    full_path: Optional[str] = Field(None, description="Full Unity Catalog path")
    environment: str = Field(..., description="SDLC environment")
    status: str = Field(..., description="Lifecycle status")
    published: bool = Field(False, description="Marketplace publication status")
    contract_id: Optional[str] = Field(None, description="Associated contract ID")
    contract_name: Optional[str] = Field(None, description="Associated contract name")
    owner_team_id: Optional[str] = Field(None, description="Owner team ID")
    owner_team_name: Optional[str] = Field(None, description="Owner team name")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")
    subscriber_count: Optional[int] = Field(None, description="Number of subscribers")

    model_config = {"from_attributes": True}


# ============================================================================
# Dataset Full Model
# ============================================================================

class Dataset(BaseModel):
    """Full dataset model with all details."""
    id: str = Field(..., description="Unique identifier")
    name: str = Field(..., description="Dataset name")
    description: Optional[str] = Field(None, description="Dataset description")
    
    # Physical asset reference
    asset_type: str = Field(..., description="Asset type (table/view)")
    catalog_name: str = Field(..., description="Unity Catalog name")
    schema_name: str = Field(..., description="Schema name")
    object_name: str = Field(..., description="Object name (table/view)")
    
    # SDLC environment
    environment: str = Field(..., description="SDLC environment (dev/staging/prod)")
    
    # Contract reference
    contract_id: Optional[str] = Field(None, description="Associated contract ID")
    contract_name: Optional[str] = Field(None, description="Associated contract name (denormalized)")
    
    # Ownership and project
    owner_team_id: Optional[str] = Field(None, description="Owner team ID")
    owner_team_name: Optional[str] = Field(None, description="Owner team name (denormalized)")
    project_id: Optional[str] = Field(None, description="Project ID")
    project_name: Optional[str] = Field(None, description="Project name (denormalized)")
    
    # Lifecycle
    status: str = Field("draft", description="Lifecycle status")
    version: Optional[str] = Field(None, description="Version")
    published: bool = Field(False, description="Marketplace publication status")
    
    # Related data
    tags: List[DatasetTag] = Field(default_factory=list, description="Tags")
    custom_properties: List[DatasetCustomProperty] = Field(default_factory=list, description="Custom properties")
    subscriber_count: Optional[int] = Field(None, description="Number of subscribers")
    
    # Audit
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")
    created_by: Optional[str] = Field(None, description="Created by user")
    updated_by: Optional[str] = Field(None, description="Last updated by user")

    model_config = {"from_attributes": True}

    @property
    def full_path(self) -> str:
        """Returns the full Unity Catalog path."""
        return f"{self.catalog_name}.{self.schema_name}.{self.object_name}"


# ============================================================================
# Create/Update Models
# ============================================================================

class DatasetCreate(BaseModel):
    """Model for creating a new dataset."""
    name: str = Field(..., description="Dataset name")
    description: Optional[str] = Field(None, description="Dataset description")
    
    # Physical asset reference
    asset_type: str = Field(..., description="Asset type (table/view)")
    catalog_name: str = Field(..., description="Unity Catalog name")
    schema_name: str = Field(..., description="Schema name")
    object_name: str = Field(..., description="Object name (table/view)")
    
    # SDLC environment
    environment: str = Field(..., description="SDLC environment (dev/staging/prod)")
    
    # Contract reference
    contract_id: Optional[str] = Field(None, description="Associated contract ID")
    
    # Ownership and project
    owner_team_id: Optional[str] = Field(None, description="Owner team ID")
    project_id: Optional[str] = Field(None, description="Project ID")
    
    # Lifecycle
    status: str = Field("draft", description="Lifecycle status")
    version: Optional[str] = Field(None, description="Version")
    published: bool = Field(False, description="Marketplace publication status")
    
    # Optional related data
    tags: Optional[List[DatasetTagCreate]] = Field(None, description="Tags to create")
    custom_properties: Optional[List[DatasetCustomPropertyCreate]] = Field(None, description="Custom properties")

    model_config = {"from_attributes": True}


class DatasetUpdate(BaseModel):
    """Model for updating an existing dataset."""
    name: Optional[str] = Field(None, description="Dataset name")
    description: Optional[str] = Field(None, description="Dataset description")
    
    # Physical asset reference (can be updated if asset is moved)
    asset_type: Optional[str] = Field(None, description="Asset type (table/view)")
    catalog_name: Optional[str] = Field(None, description="Unity Catalog name")
    schema_name: Optional[str] = Field(None, description="Schema name")
    object_name: Optional[str] = Field(None, description="Object name (table/view)")
    
    # SDLC environment
    environment: Optional[str] = Field(None, description="SDLC environment")
    
    # Contract reference
    contract_id: Optional[str] = Field(None, description="Associated contract ID")
    
    # Ownership and project
    owner_team_id: Optional[str] = Field(None, description="Owner team ID")
    project_id: Optional[str] = Field(None, description="Project ID")
    
    # Lifecycle
    status: Optional[str] = Field(None, description="Lifecycle status")
    version: Optional[str] = Field(None, description="Version")
    published: Optional[bool] = Field(None, description="Marketplace publication status")
    
    # Optional related data (replaces existing if provided)
    tags: Optional[List[DatasetTagCreate]] = Field(None, description="Tags to set")
    custom_properties: Optional[List[DatasetCustomPropertyCreate]] = Field(None, description="Custom properties")

    model_config = {"from_attributes": True}


# ============================================================================
# Filter/Query Models
# ============================================================================

class DatasetFilter(BaseModel):
    """Filter options for querying datasets."""
    environment: Optional[str] = Field(None, description="Filter by environment")
    status: Optional[str] = Field(None, description="Filter by status")
    asset_type: Optional[str] = Field(None, description="Filter by asset type")
    contract_id: Optional[str] = Field(None, description="Filter by contract")
    owner_team_id: Optional[str] = Field(None, description="Filter by owner team")
    project_id: Optional[str] = Field(None, description="Filter by project")
    published: Optional[bool] = Field(None, description="Filter by publication status")
    catalog_name: Optional[str] = Field(None, description="Filter by catalog")
    search: Optional[str] = Field(None, description="Search in name and description")

