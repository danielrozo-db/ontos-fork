"""
Datasets Manager

Business logic controller for Datasets.
Implements SearchableAsset interface for global search functionality.
"""

from typing import List, Optional, Dict, Any
from uuid import uuid4

from sqlalchemy.orm import Session
from databricks.sdk import WorkspaceClient

from src.common.logging import get_logger
from src.common.search_interfaces import SearchableAsset, SearchIndexItem
from src.common.search_registry import searchable_asset
from src.db_models.datasets import (
    DatasetDb,
    DatasetTagDb,
    DatasetCustomPropertyDb,
)
from src.repositories.datasets_repository import (
    dataset_repo,
    dataset_subscription_repo,
    dataset_tag_repo,
    dataset_custom_property_repo,
)
from src.models.datasets import (
    Dataset,
    DatasetCreate,
    DatasetUpdate,
    DatasetListItem,
    DatasetSubscription,
    DatasetSubscriptionCreate,
    DatasetSubscriptionResponse,
    DatasetSubscriberInfo,
    DatasetSubscribersListResponse,
)

logger = get_logger(__name__)


@searchable_asset
class DatasetsManager(SearchableAsset):
    """
    Manager for Dataset business logic.
    
    Handles CRUD operations, contract assignment, subscriptions,
    and provides search indexing.
    """

    def __init__(
        self,
        db: Session,
        ws_client: Optional[WorkspaceClient] = None,
    ):
        self._db = db
        self._ws_client = ws_client
        logger.info("DatasetsManager initialized")

    # =========================================================================
    # SearchableAsset Interface Implementation
    # =========================================================================

    def get_search_index_items(self) -> List[SearchIndexItem]:
        """
        Fetches datasets and maps them to SearchIndexItem format for global search.
        """
        items: List[SearchIndexItem] = []
        try:
            datasets = dataset_repo.get_multi(db=self._db, limit=1000)
            for ds in datasets:
                tags = [tag.name for tag in ds.tags] if ds.tags else []
                tags.append(ds.environment)  # Add environment as a searchable tag
                tags.append(ds.asset_type)  # Add asset type as a searchable tag
                
                description = ds.description or f"{ds.asset_type.capitalize()} in {ds.environment}"
                
                items.append(SearchIndexItem(
                    id=f"dataset::{ds.id}",
                    type="dataset",
                    title=ds.name,
                    description=description,
                    link=f"/datasets/{ds.id}",
                    tags=tags,
                    feature_id="datasets",
                ))
        except Exception as e:
            logger.error(f"Error fetching datasets for search index: {e}", exc_info=True)
        
        return items

    # =========================================================================
    # CRUD Operations
    # =========================================================================

    def list_datasets(
        self,
        skip: int = 0,
        limit: int = 100,
        environment: Optional[str] = None,
        status: Optional[str] = None,
        asset_type: Optional[str] = None,
        contract_id: Optional[str] = None,
        owner_team_id: Optional[str] = None,
        project_id: Optional[str] = None,
        published: Optional[bool] = None,
        catalog_name: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[DatasetListItem]:
        """List datasets with optional filtering."""
        try:
            datasets = dataset_repo.get_multi(
                db=self._db,
                skip=skip,
                limit=limit,
                environment=environment,
                status=status,
                asset_type=asset_type,
                contract_id=contract_id,
                owner_team_id=owner_team_id,
                project_id=project_id,
                published=published,
                catalog_name=catalog_name,
                search=search,
            )
            
            return [self._to_list_item(ds) for ds in datasets]
        except Exception as e:
            logger.error(f"Error listing datasets: {e}", exc_info=True)
            raise

    def get_dataset(self, dataset_id: str) -> Optional[Dataset]:
        """Get a single dataset by ID with all related data."""
        try:
            ds = dataset_repo.get_with_all(db=self._db, id=dataset_id)
            if not ds:
                return None
            return self._to_api_model(ds)
        except Exception as e:
            logger.error(f"Error getting dataset {dataset_id}: {e}", exc_info=True)
            raise

    def create_dataset(
        self,
        data: DatasetCreate,
        created_by: Optional[str] = None,
    ) -> Dataset:
        """Create a new dataset."""
        try:
            # Generate ID
            dataset_id = str(uuid4())
            
            # Create the dataset record
            db_dataset = DatasetDb(
                id=dataset_id,
                name=data.name,
                description=data.description,
                asset_type=data.asset_type,
                catalog_name=data.catalog_name,
                schema_name=data.schema_name,
                object_name=data.object_name,
                environment=data.environment,
                contract_id=data.contract_id,
                owner_team_id=data.owner_team_id,
                project_id=data.project_id,
                status=data.status or "draft",
                version=data.version,
                published=data.published or False,
                created_by=created_by,
                updated_by=created_by,
            )
            
            self._db.add(db_dataset)
            self._db.flush()
            
            # Create tags if provided
            if data.tags:
                for tag_data in data.tags:
                    tag = DatasetTagDb(
                        dataset_id=dataset_id,
                        name=tag_data.name,
                    )
                    self._db.add(tag)
            
            # Create custom properties if provided
            if data.custom_properties:
                for prop_data in data.custom_properties:
                    prop = DatasetCustomPropertyDb(
                        dataset_id=dataset_id,
                        property=prop_data.property,
                        value=prop_data.value,
                    )
                    self._db.add(prop)
            
            self._db.flush()
            self._db.refresh(db_dataset)
            
            logger.info(f"Created dataset {dataset_id}: {data.name}")
            return self._to_api_model(db_dataset)
            
        except Exception as e:
            logger.error(f"Error creating dataset: {e}", exc_info=True)
            self._db.rollback()
            raise

    def update_dataset(
        self,
        dataset_id: str,
        data: DatasetUpdate,
        updated_by: Optional[str] = None,
    ) -> Optional[Dataset]:
        """Update an existing dataset."""
        try:
            db_dataset = dataset_repo.get_with_all(db=self._db, id=dataset_id)
            if not db_dataset:
                return None
            
            # Update basic fields if provided
            if data.name is not None:
                db_dataset.name = data.name
            if data.description is not None:
                db_dataset.description = data.description
            if data.asset_type is not None:
                db_dataset.asset_type = data.asset_type
            if data.catalog_name is not None:
                db_dataset.catalog_name = data.catalog_name
            if data.schema_name is not None:
                db_dataset.schema_name = data.schema_name
            if data.object_name is not None:
                db_dataset.object_name = data.object_name
            if data.environment is not None:
                db_dataset.environment = data.environment
            if data.contract_id is not None:
                db_dataset.contract_id = data.contract_id
            if data.owner_team_id is not None:
                db_dataset.owner_team_id = data.owner_team_id
            if data.project_id is not None:
                db_dataset.project_id = data.project_id
            if data.status is not None:
                db_dataset.status = data.status
            if data.version is not None:
                db_dataset.version = data.version
            if data.published is not None:
                db_dataset.published = data.published
            
            db_dataset.updated_by = updated_by
            
            # Replace tags if provided
            if data.tags is not None:
                dataset_tag_repo.delete_by_dataset(db=self._db, dataset_id=dataset_id)
                for tag_data in data.tags:
                    dataset_tag_repo.create_tag(
                        db=self._db,
                        dataset_id=dataset_id,
                        name=tag_data.name,
                    )
            
            # Replace custom properties if provided
            if data.custom_properties is not None:
                dataset_custom_property_repo.delete_by_dataset(db=self._db, dataset_id=dataset_id)
                for prop_data in data.custom_properties:
                    dataset_custom_property_repo.create_property(
                        db=self._db,
                        dataset_id=dataset_id,
                        property=prop_data.property,
                        value=prop_data.value,
                    )
            
            self._db.flush()
            self._db.refresh(db_dataset)
            
            logger.info(f"Updated dataset {dataset_id}")
            return self._to_api_model(db_dataset)
            
        except Exception as e:
            logger.error(f"Error updating dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    def delete_dataset(self, dataset_id: str) -> bool:
        """Delete a dataset and all related data."""
        try:
            db_dataset = dataset_repo.get(db=self._db, id=dataset_id)
            if not db_dataset:
                return False
            
            self._db.delete(db_dataset)
            self._db.flush()
            
            logger.info(f"Deleted dataset {dataset_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    # =========================================================================
    # Contract Operations
    # =========================================================================

    def get_datasets_by_contract(
        self,
        contract_id: str,
        skip: int = 0,
        limit: int = 100,
    ) -> List[DatasetListItem]:
        """Get all datasets implementing a specific contract."""
        try:
            datasets = dataset_repo.get_by_contract(
                db=self._db,
                contract_id=contract_id,
                skip=skip,
                limit=limit,
            )
            return [self._to_list_item(ds) for ds in datasets]
        except Exception as e:
            logger.error(f"Error getting datasets for contract {contract_id}: {e}", exc_info=True)
            raise

    def assign_contract(
        self,
        dataset_id: str,
        contract_id: str,
        updated_by: Optional[str] = None,
    ) -> Optional[Dataset]:
        """Assign a contract to a dataset."""
        try:
            db_dataset = dataset_repo.get(db=self._db, id=dataset_id)
            if not db_dataset:
                return None
            
            db_dataset.contract_id = contract_id
            db_dataset.updated_by = updated_by
            
            self._db.flush()
            self._db.refresh(db_dataset)
            
            logger.info(f"Assigned contract {contract_id} to dataset {dataset_id}")
            return self._to_api_model(db_dataset)
            
        except Exception as e:
            logger.error(f"Error assigning contract to dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    def unassign_contract(
        self,
        dataset_id: str,
        updated_by: Optional[str] = None,
    ) -> Optional[Dataset]:
        """Remove contract assignment from a dataset."""
        try:
            db_dataset = dataset_repo.get(db=self._db, id=dataset_id)
            if not db_dataset:
                return None
            
            db_dataset.contract_id = None
            db_dataset.updated_by = updated_by
            
            self._db.flush()
            self._db.refresh(db_dataset)
            
            logger.info(f"Unassigned contract from dataset {dataset_id}")
            return self._to_api_model(db_dataset)
            
        except Exception as e:
            logger.error(f"Error unassigning contract from dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    # =========================================================================
    # Subscription Operations
    # =========================================================================

    def subscribe(
        self,
        dataset_id: str,
        email: str,
        reason: Optional[str] = None,
    ) -> DatasetSubscriptionResponse:
        """Subscribe a user to a dataset."""
        try:
            # Verify dataset exists
            db_dataset = dataset_repo.get(db=self._db, id=dataset_id)
            if not db_dataset:
                raise ValueError(f"Dataset {dataset_id} not found")
            
            subscription = dataset_subscription_repo.subscribe(
                db=self._db,
                dataset_id=dataset_id,
                email=email,
                reason=reason,
            )
            
            logger.info(f"User {email} subscribed to dataset {dataset_id}")
            
            return DatasetSubscriptionResponse(
                subscribed=True,
                subscription=DatasetSubscription(
                    id=subscription.id,
                    dataset_id=subscription.dataset_id,
                    subscriber_email=subscription.subscriber_email,
                    subscribed_at=subscription.subscribed_at,
                    subscription_reason=subscription.subscription_reason,
                ),
            )
        except Exception as e:
            logger.error(f"Error subscribing to dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    def unsubscribe(
        self,
        dataset_id: str,
        email: str,
    ) -> DatasetSubscriptionResponse:
        """Unsubscribe a user from a dataset."""
        try:
            success = dataset_subscription_repo.unsubscribe(
                db=self._db,
                dataset_id=dataset_id,
                email=email,
            )
            
            if success:
                logger.info(f"User {email} unsubscribed from dataset {dataset_id}")
            
            return DatasetSubscriptionResponse(
                subscribed=False,
                subscription=None,
            )
        except Exception as e:
            logger.error(f"Error unsubscribing from dataset {dataset_id}: {e}", exc_info=True)
            self._db.rollback()
            raise

    def get_subscription_status(
        self,
        dataset_id: str,
        email: str,
    ) -> DatasetSubscriptionResponse:
        """Check if a user is subscribed to a dataset."""
        try:
            subscription = dataset_subscription_repo.get_by_dataset_and_email(
                db=self._db,
                dataset_id=dataset_id,
                email=email,
            )
            
            if subscription:
                return DatasetSubscriptionResponse(
                    subscribed=True,
                    subscription=DatasetSubscription(
                        id=subscription.id,
                        dataset_id=subscription.dataset_id,
                        subscriber_email=subscription.subscriber_email,
                        subscribed_at=subscription.subscribed_at,
                        subscription_reason=subscription.subscription_reason,
                    ),
                )
            
            return DatasetSubscriptionResponse(
                subscribed=False,
                subscription=None,
            )
        except Exception as e:
            logger.error(f"Error getting subscription status for dataset {dataset_id}: {e}", exc_info=True)
            raise

    def get_subscribers(
        self,
        dataset_id: str,
        skip: int = 0,
        limit: int = 100,
    ) -> DatasetSubscribersListResponse:
        """Get all subscribers for a dataset."""
        try:
            subscriptions = dataset_subscription_repo.get_by_dataset(
                db=self._db,
                dataset_id=dataset_id,
                skip=skip,
                limit=limit,
            )
            
            count = dataset_subscription_repo.count_by_dataset(db=self._db, dataset_id=dataset_id)
            
            subscribers = [
                DatasetSubscriberInfo(
                    email=sub.subscriber_email,
                    subscribed_at=sub.subscribed_at,
                    reason=sub.subscription_reason,
                )
                for sub in subscriptions
            ]
            
            return DatasetSubscribersListResponse(
                dataset_id=dataset_id,
                subscriber_count=count,
                subscribers=subscribers,
            )
        except Exception as e:
            logger.error(f"Error getting subscribers for dataset {dataset_id}: {e}", exc_info=True)
            raise

    # =========================================================================
    # Asset Validation
    # =========================================================================

    def validate_asset_exists(
        self,
        catalog_name: str,
        schema_name: str,
        object_name: str,
    ) -> Dict[str, Any]:
        """
        Validate that a Unity Catalog asset exists.
        Returns asset info if found, or error details if not.
        """
        if not self._ws_client:
            logger.warning("WorkspaceClient not available, skipping asset validation")
            return {"exists": True, "validated": False, "message": "Validation skipped - no workspace client"}
        
        try:
            full_name = f"{catalog_name}.{schema_name}.{object_name}"
            
            # Try to get the table info
            table_info = self._ws_client.tables.get(full_name)
            
            return {
                "exists": True,
                "validated": True,
                "asset_type": table_info.table_type.value.lower() if table_info.table_type else "table",
                "name": table_info.name,
                "catalog": table_info.catalog_name,
                "schema": table_info.schema_name,
            }
        except Exception as e:
            logger.debug(f"Asset {catalog_name}.{schema_name}.{object_name} not found or error: {e}")
            return {
                "exists": False,
                "validated": True,
                "message": str(e),
            }

    # =========================================================================
    # Helper Methods
    # =========================================================================

    def _to_list_item(self, db_dataset: DatasetDb) -> DatasetListItem:
        """Convert DB model to list item API model."""
        subscriber_count = len(db_dataset.subscriptions) if db_dataset.subscriptions else 0
        
        return DatasetListItem(
            id=db_dataset.id,
            name=db_dataset.name,
            asset_type=db_dataset.asset_type,
            catalog_name=db_dataset.catalog_name,
            schema_name=db_dataset.schema_name,
            object_name=db_dataset.object_name,
            full_path=f"{db_dataset.catalog_name}.{db_dataset.schema_name}.{db_dataset.object_name}",
            environment=db_dataset.environment,
            status=db_dataset.status,
            published=db_dataset.published,
            contract_id=db_dataset.contract_id,
            contract_name=db_dataset.contract.name if db_dataset.contract else None,
            owner_team_id=db_dataset.owner_team_id,
            owner_team_name=db_dataset.owner_team.name if db_dataset.owner_team else None,
            created_at=db_dataset.created_at,
            updated_at=db_dataset.updated_at,
            subscriber_count=subscriber_count,
        )

    def _to_api_model(self, db_dataset: DatasetDb) -> Dataset:
        """Convert DB model to full API model."""
        from src.models.datasets import DatasetTag, DatasetCustomProperty
        
        subscriber_count = len(db_dataset.subscriptions) if db_dataset.subscriptions else 0
        
        tags = [
            DatasetTag(id=tag.id, name=tag.name)
            for tag in (db_dataset.tags or [])
        ]
        
        custom_properties = [
            DatasetCustomProperty(id=prop.id, property=prop.property, value=prop.value)
            for prop in (db_dataset.custom_properties or [])
        ]
        
        return Dataset(
            id=db_dataset.id,
            name=db_dataset.name,
            description=db_dataset.description,
            asset_type=db_dataset.asset_type,
            catalog_name=db_dataset.catalog_name,
            schema_name=db_dataset.schema_name,
            object_name=db_dataset.object_name,
            environment=db_dataset.environment,
            contract_id=db_dataset.contract_id,
            contract_name=db_dataset.contract.name if db_dataset.contract else None,
            owner_team_id=db_dataset.owner_team_id,
            owner_team_name=db_dataset.owner_team.name if db_dataset.owner_team else None,
            project_id=db_dataset.project_id,
            project_name=db_dataset.project.name if db_dataset.project else None,
            status=db_dataset.status,
            version=db_dataset.version,
            published=db_dataset.published,
            tags=tags,
            custom_properties=custom_properties,
            subscriber_count=subscriber_count,
            created_at=db_dataset.created_at,
            updated_at=db_dataset.updated_at,
            created_by=db_dataset.created_by,
            updated_by=db_dataset.updated_by,
        )

