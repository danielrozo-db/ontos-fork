"""
Workflow Trigger Registry.

Provides a centralized system for registering trigger points throughout the app
and executing matching workflows when events occur.
"""

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from src.models.process_workflows import (
    TriggerType,
    EntityType,
    TriggerContext,
    ProcessWorkflow,
    WorkflowExecution,
    ExecutionStatus,
)
from src.common.logging import get_logger

logger = get_logger(__name__)


@dataclass
class TriggerEvent:
    """Represents a trigger event."""
    trigger_type: TriggerType
    entity_type: EntityType
    entity_id: str
    entity_name: Optional[str] = None
    entity_data: Optional[Dict[str, Any]] = None
    user_email: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    scope_type: Optional[str] = None  # 'project', 'catalog', 'domain'
    scope_id: Optional[str] = None


class TriggerRegistry:
    """Registry for workflow triggers.
    
    Provides methods to fire trigger events and execute matching workflows.
    """

    def __init__(self, db: Session):
        self._db = db
        self._workflows_manager = None
        self._workflow_executor = None

    def _get_workflows_manager(self):
        """Lazy load workflows manager to avoid circular imports."""
        if self._workflows_manager is None:
            from src.controller.workflows_manager import WorkflowsManager
            self._workflows_manager = WorkflowsManager(self._db)
        return self._workflows_manager

    def _get_workflow_executor(self):
        """Lazy load workflow executor to avoid circular imports."""
        if self._workflow_executor is None:
            from src.common.workflow_executor import WorkflowExecutor
            self._workflow_executor = WorkflowExecutor(self._db)
        return self._workflow_executor

    def fire_trigger(
        self,
        event: TriggerEvent,
        *,
        blocking: bool = True,
    ) -> List[WorkflowExecution]:
        """Fire a trigger event and execute matching workflows.
        
        Args:
            event: The trigger event
            blocking: If True, execute workflows synchronously
            
        Returns:
            List of workflow executions
        """
        logger.info(
            f"Trigger fired: {event.trigger_type.value} for {event.entity_type.value} "
            f"'{event.entity_id}'"
        )
        
        # Get matching workflows
        workflows_manager = self._get_workflows_manager()
        matching_workflows = workflows_manager.get_workflows_for_trigger(
            trigger_type=event.trigger_type,
            entity_type=event.entity_type,
            scope_type=event.scope_type,
            scope_id=event.scope_id,
            from_status=event.from_status,
            to_status=event.to_status,
        )
        
        if not matching_workflows:
            logger.debug(f"No workflows match trigger: {event.trigger_type.value}")
            return []
        
        logger.info(f"Found {len(matching_workflows)} matching workflow(s)")
        
        # Build trigger context
        trigger_context = TriggerContext(
            entity_type=event.entity_type.value,
            entity_id=event.entity_id,
            entity_name=event.entity_name,
            trigger_type=event.trigger_type,
            user_email=event.user_email,
            entity_data=event.entity_data,
            from_status=event.from_status,
            to_status=event.to_status,
        )
        
        # Execute workflows
        executor = self._get_workflow_executor()
        executions = []
        
        for workflow in matching_workflows:
            try:
                execution = executor.execute_workflow(
                    workflow=workflow,
                    entity=event.entity_data or {},
                    entity_type=event.entity_type.value,
                    entity_id=event.entity_id,
                    entity_name=event.entity_name,
                    user_email=event.user_email,
                    trigger_context=trigger_context,
                    blocking=blocking,
                )
                executions.append(execution)
                
                logger.info(
                    f"Workflow '{workflow.name}' executed with status: {execution.status.value}"
                )
            except Exception as e:
                logger.exception(f"Failed to execute workflow '{workflow.name}': {e}")
        
        return executions

    def on_create(
        self,
        entity_type: EntityType,
        entity_id: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
        *,
        blocking: bool = True,
    ) -> List[WorkflowExecution]:
        """Fire an on_create trigger.
        
        Args:
            entity_type: Type of entity being created
            entity_id: ID of the entity
            entity_name: Name of the entity
            entity_data: Entity data dictionary
            user_email: User performing the action
            scope_type: Scope type (project, catalog, domain)
            scope_id: Scope ID
            blocking: Execute synchronously
            
        Returns:
            List of workflow executions
        """
        event = TriggerEvent(
            trigger_type=TriggerType.ON_CREATE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        return self.fire_trigger(event, blocking=blocking)

    def on_update(
        self,
        entity_type: EntityType,
        entity_id: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
        *,
        blocking: bool = True,
    ) -> List[WorkflowExecution]:
        """Fire an on_update trigger."""
        event = TriggerEvent(
            trigger_type=TriggerType.ON_UPDATE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        return self.fire_trigger(event, blocking=blocking)

    def on_delete(
        self,
        entity_type: EntityType,
        entity_id: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
        *,
        blocking: bool = True,
    ) -> List[WorkflowExecution]:
        """Fire an on_delete trigger."""
        event = TriggerEvent(
            trigger_type=TriggerType.ON_DELETE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        return self.fire_trigger(event, blocking=blocking)

    def on_status_change(
        self,
        entity_type: EntityType,
        entity_id: str,
        from_status: str,
        to_status: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
        *,
        blocking: bool = True,
    ) -> List[WorkflowExecution]:
        """Fire an on_status_change trigger."""
        event = TriggerEvent(
            trigger_type=TriggerType.ON_STATUS_CHANGE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            from_status=from_status,
            to_status=to_status,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        return self.fire_trigger(event, blocking=blocking)

    def before_create(
        self,
        entity_type: EntityType,
        entity_id: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
    ) -> Tuple[bool, List[WorkflowExecution]]:
        """Fire a before_create trigger for pre-creation validation.
        
        This is an inline/blocking trigger that runs BEFORE the entity is created.
        Use for compliance checks, naming convention validation, etc.
        
        Args:
            entity_type: Type of entity being created
            entity_id: Proposed ID of the entity (may not exist yet)
            entity_name: Name of the entity
            entity_data: Entity data dictionary to validate
            user_email: User performing the action
            scope_type: Scope type (project, catalog, domain)
            scope_id: Scope ID
            
        Returns:
            Tuple of (all_passed, executions) where:
            - all_passed: True if all workflows succeeded, False if any failed
            - executions: List of workflow executions with detailed results
        """
        event = TriggerEvent(
            trigger_type=TriggerType.BEFORE_CREATE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        executions = self.fire_trigger(event, blocking=True)
        
        # Check if all workflows passed
        all_passed = all(
            exe.status == ExecutionStatus.SUCCEEDED 
            for exe in executions
        ) if executions else True  # No workflows = pass
        
        return all_passed, executions

    def before_update(
        self,
        entity_type: EntityType,
        entity_id: str,
        entity_name: Optional[str] = None,
        entity_data: Optional[Dict[str, Any]] = None,
        user_email: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
    ) -> Tuple[bool, List[WorkflowExecution]]:
        """Fire a before_update trigger for pre-update validation.
        
        This is an inline/blocking trigger that runs BEFORE the entity is updated.
        
        Args:
            entity_type: Type of entity being updated
            entity_id: ID of the entity
            entity_name: Name of the entity
            entity_data: Updated entity data dictionary to validate
            user_email: User performing the action
            scope_type: Scope type (project, catalog, domain)
            scope_id: Scope ID
            
        Returns:
            Tuple of (all_passed, executions)
        """
        event = TriggerEvent(
            trigger_type=TriggerType.BEFORE_UPDATE,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            entity_data=entity_data,
            user_email=user_email,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        executions = self.fire_trigger(event, blocking=True)
        
        all_passed = all(
            exe.status == ExecutionStatus.SUCCEEDED 
            for exe in executions
        ) if executions else True
        
        return all_passed, executions


def get_trigger_registry(db: Session) -> TriggerRegistry:
    """Get a trigger registry instance.
    
    Args:
        db: Database session
        
    Returns:
        TriggerRegistry instance
    """
    return TriggerRegistry(db)

