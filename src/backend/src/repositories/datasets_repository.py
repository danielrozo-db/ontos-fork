"""
Datasets Repository

Database access layer for Datasets using the Repository pattern.
"""

from typing import Any, Dict, Optional, List, Union

from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_

from src.common.repository import CRUDBase
from src.db_models.datasets import (
    DatasetDb,
    DatasetSubscriptionDb,
    DatasetTagDb,
    DatasetCustomPropertyDb,
)
from src.common.logging import get_logger

logger = get_logger(__name__)


class DatasetRepository(CRUDBase[DatasetDb, Dict[str, Any], Union[Dict[str, Any], DatasetDb]]):
    """Repository for Dataset CRUD operations."""
    
    def __init__(self):
        super().__init__(DatasetDb)

    def get_with_all(self, db: Session, *, id: str) -> Optional[DatasetDb]:
        """Get a dataset with all related data loaded."""
        try:
            return (
                db.query(self.model)
                .options(
                    selectinload(self.model.contract),
                    selectinload(self.model.owner_team),
                    selectinload(self.model.project),
                    selectinload(self.model.subscriptions),
                    selectinload(self.model.tags),
                    selectinload(self.model.custom_properties),
                )
                .filter(self.model.id == id)
                .first()
            )
        except Exception as e:
            logger.error(f"Error fetching Dataset with all relations for id {id}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_name(self, db: Session, *, name: str) -> Optional[DatasetDb]:
        """Get dataset by name."""
        try:
            return db.query(self.model).filter(self.model.name == name).first()
        except Exception as e:
            logger.error(f"Error fetching Dataset by name {name}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_asset_path(
        self,
        db: Session,
        *,
        catalog_name: str,
        schema_name: str,
        object_name: str,
        environment: Optional[str] = None
    ) -> Optional[DatasetDb]:
        """Get dataset by Unity Catalog path and optional environment."""
        try:
            query = db.query(self.model).filter(
                self.model.catalog_name == catalog_name,
                self.model.schema_name == schema_name,
                self.model.object_name == object_name,
            )
            if environment:
                query = query.filter(self.model.environment == environment)
            return query.first()
        except Exception as e:
            logger.error(f"Error fetching Dataset by path {catalog_name}.{schema_name}.{object_name}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_contract(
        self,
        db: Session,
        *,
        contract_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[DatasetDb]:
        """Get all datasets implementing a specific contract."""
        try:
            return (
                db.query(self.model)
                .options(
                    selectinload(self.model.owner_team),
                    selectinload(self.model.subscriptions),
                )
                .filter(self.model.contract_id == contract_id)
                .offset(skip)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching Datasets by contract {contract_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_environment(
        self,
        db: Session,
        *,
        environment: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[DatasetDb]:
        """Get all datasets in a specific environment."""
        try:
            return (
                db.query(self.model)
                .filter(self.model.environment == environment)
                .offset(skip)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching Datasets by environment {environment}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_multi(
        self,
        db: Session,
        *,
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
        is_admin: bool = False
    ) -> List[DatasetDb]:
        """Get multiple datasets with optional filtering."""
        logger.debug(f"Fetching Datasets with filters: env={environment}, status={status}, search={search}")
        try:
            query = db.query(self.model).options(
                selectinload(self.model.contract),
                selectinload(self.model.owner_team),
                selectinload(self.model.subscriptions),
                selectinload(self.model.tags),
            )

            # Apply filters
            if environment:
                query = query.filter(self.model.environment == environment)
            if status:
                query = query.filter(self.model.status == status)
            if asset_type:
                query = query.filter(self.model.asset_type == asset_type)
            if contract_id:
                query = query.filter(self.model.contract_id == contract_id)
            if owner_team_id:
                query = query.filter(self.model.owner_team_id == owner_team_id)
            if project_id:
                query = query.filter(self.model.project_id == project_id)
            if published is not None:
                query = query.filter(self.model.published == published)
            if catalog_name:
                query = query.filter(self.model.catalog_name == catalog_name)
            if search:
                search_pattern = f"%{search}%"
                query = query.filter(
                    or_(
                        self.model.name.ilike(search_pattern),
                        self.model.description.ilike(search_pattern),
                        self.model.object_name.ilike(search_pattern),
                    )
                )

            return query.order_by(self.model.name).offset(skip).limit(limit).all()
        except Exception as e:
            logger.error(f"Database error fetching Datasets: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_project(
        self,
        db: Session,
        project_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[DatasetDb]:
        """Get datasets filtered by project_id."""
        try:
            return (
                db.query(self.model)
                .filter(self.model.project_id == project_id)
                .offset(skip)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching Datasets by project {project_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def count_by_contract(self, db: Session, contract_id: str) -> int:
        """Count datasets implementing a specific contract."""
        try:
            return db.query(self.model).filter(self.model.contract_id == contract_id).count()
        except Exception as e:
            logger.error(f"Error counting Datasets by contract {contract_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def create(self, db: Session, *, obj_in: Union[Dict[str, Any], DatasetDb]) -> DatasetDb:
        """Create a new dataset."""
        try:
            if isinstance(obj_in, DatasetDb):
                db.add(obj_in)
                db.flush()
                db.refresh(obj_in)
                return obj_in
            payload: Dict[str, Any] = dict(obj_in)
            db_obj = self.model(**payload)
            db.add(db_obj)
            db.flush()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            logger.error(f"Error creating Dataset: {e}", exc_info=True)
            db.rollback()
            raise


# Singleton instance
dataset_repo = DatasetRepository()


class DatasetSubscriptionRepository(CRUDBase[DatasetSubscriptionDb, Dict[str, Any], DatasetSubscriptionDb]):
    """Repository for Dataset Subscription operations."""

    def __init__(self):
        super().__init__(DatasetSubscriptionDb)

    def get_by_dataset_and_email(
        self,
        db: Session,
        *,
        dataset_id: str,
        email: str
    ) -> Optional[DatasetSubscriptionDb]:
        """Get subscription by dataset and subscriber email."""
        try:
            return (
                db.query(self.model)
                .filter(
                    self.model.dataset_id == dataset_id,
                    self.model.subscriber_email == email
                )
                .first()
            )
        except Exception as e:
            logger.error(f"Error fetching subscription for dataset {dataset_id} and email {email}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_dataset(
        self,
        db: Session,
        *,
        dataset_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[DatasetSubscriptionDb]:
        """Get all subscriptions for a dataset."""
        try:
            return (
                db.query(self.model)
                .filter(self.model.dataset_id == dataset_id)
                .order_by(self.model.subscribed_at.desc())
                .offset(skip)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching subscriptions for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def get_by_subscriber(
        self,
        db: Session,
        *,
        email: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[DatasetSubscriptionDb]:
        """Get all subscriptions for a subscriber."""
        try:
            return (
                db.query(self.model)
                .filter(self.model.subscriber_email == email)
                .order_by(self.model.subscribed_at.desc())
                .offset(skip)
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching subscriptions for subscriber {email}: {e}", exc_info=True)
            db.rollback()
            raise

    def count_by_dataset(self, db: Session, dataset_id: str) -> int:
        """Count subscribers for a dataset."""
        try:
            return db.query(self.model).filter(self.model.dataset_id == dataset_id).count()
        except Exception as e:
            logger.error(f"Error counting subscribers for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def subscribe(
        self,
        db: Session,
        *,
        dataset_id: str,
        email: str,
        reason: Optional[str] = None
    ) -> DatasetSubscriptionDb:
        """Create a subscription to a dataset."""
        try:
            # Check if already subscribed
            existing = self.get_by_dataset_and_email(db=db, dataset_id=dataset_id, email=email)
            if existing:
                return existing
            
            subscription = DatasetSubscriptionDb(
                dataset_id=dataset_id,
                subscriber_email=email,
                subscription_reason=reason
            )
            db.add(subscription)
            db.flush()
            db.refresh(subscription)
            return subscription
        except Exception as e:
            logger.error(f"Error creating subscription for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def unsubscribe(
        self,
        db: Session,
        *,
        dataset_id: str,
        email: str
    ) -> bool:
        """Remove a subscription from a dataset."""
        try:
            subscription = self.get_by_dataset_and_email(db=db, dataset_id=dataset_id, email=email)
            if not subscription:
                return False
            db.delete(subscription)
            db.flush()
            return True
        except Exception as e:
            logger.error(f"Error removing subscription for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise


# Singleton instance
dataset_subscription_repo = DatasetSubscriptionRepository()


class DatasetTagRepository(CRUDBase[DatasetTagDb, Dict[str, Any], DatasetTagDb]):
    """Repository for Dataset Tag operations."""

    def __init__(self):
        super().__init__(DatasetTagDb)

    def get_by_dataset(self, db: Session, *, dataset_id: str) -> List[DatasetTagDb]:
        """Get all tags for a dataset."""
        try:
            return db.query(self.model).filter(self.model.dataset_id == dataset_id).all()
        except Exception as e:
            logger.error(f"Error fetching tags for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def create_tag(self, db: Session, *, dataset_id: str, name: str) -> DatasetTagDb:
        """Create a tag for a dataset."""
        try:
            # Check for duplicate
            existing = db.query(self.model).filter(
                self.model.dataset_id == dataset_id,
                self.model.name == name
            ).first()
            if existing:
                return existing
            
            tag = DatasetTagDb(dataset_id=dataset_id, name=name)
            db.add(tag)
            db.flush()
            db.refresh(tag)
            return tag
        except Exception as e:
            logger.error(f"Error creating tag for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def delete_by_dataset(self, db: Session, *, dataset_id: str) -> int:
        """Delete all tags for a dataset."""
        try:
            count = db.query(self.model).filter(self.model.dataset_id == dataset_id).delete()
            db.flush()
            return count
        except Exception as e:
            logger.error(f"Error deleting tags for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise


# Singleton instance
dataset_tag_repo = DatasetTagRepository()


class DatasetCustomPropertyRepository(CRUDBase[DatasetCustomPropertyDb, Dict[str, Any], DatasetCustomPropertyDb]):
    """Repository for Dataset Custom Property operations."""

    def __init__(self):
        super().__init__(DatasetCustomPropertyDb)

    def get_by_dataset(self, db: Session, *, dataset_id: str) -> List[DatasetCustomPropertyDb]:
        """Get all custom properties for a dataset."""
        try:
            return db.query(self.model).filter(self.model.dataset_id == dataset_id).all()
        except Exception as e:
            logger.error(f"Error fetching custom properties for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def create_property(
        self,
        db: Session,
        *,
        dataset_id: str,
        property: str,
        value: Optional[str] = None
    ) -> DatasetCustomPropertyDb:
        """Create a custom property for a dataset."""
        try:
            prop = DatasetCustomPropertyDb(
                dataset_id=dataset_id,
                property=property,
                value=value
            )
            db.add(prop)
            db.flush()
            db.refresh(prop)
            return prop
        except Exception as e:
            logger.error(f"Error creating custom property for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise

    def delete_by_dataset(self, db: Session, *, dataset_id: str) -> int:
        """Delete all custom properties for a dataset."""
        try:
            count = db.query(self.model).filter(self.model.dataset_id == dataset_id).delete()
            db.flush()
            return count
        except Exception as e:
            logger.error(f"Error deleting custom properties for dataset {dataset_id}: {e}", exc_info=True)
            db.rollback()
            raise


# Singleton instance
dataset_custom_property_repo = DatasetCustomPropertyRepository()

