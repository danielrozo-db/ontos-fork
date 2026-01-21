"""
API routes for process workflows.

Provides CRUD operations for workflow definitions and execution management.
"""

import json
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from src.common.database import get_db
from src.common.dependencies import DBSessionDep
from src.common.authorization import PermissionChecker
from src.common.features import FeatureAccessLevel
from src.common.logging import get_logger
from src.controller.workflows_manager import WorkflowsManager
from src.common.workflow_executor import WorkflowExecutor
from src.repositories.process_workflows_repository import process_workflow_repo, workflow_execution_repo
from src.db_models.compliance import CompliancePolicyDb
from src.db_models.process_workflows import WorkflowStepDb
from src.models.process_workflows import (
    ProcessWorkflow,
    ProcessWorkflowCreate,
    ProcessWorkflowUpdate,
    WorkflowExecution,
    WorkflowListResponse,
    WorkflowExecutionListResponse,
    WorkflowValidationResult,
    StepTypeSchema,
    TriggerContext,
    TriggerType,
    EntityType,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/workflows", tags=["Process Workflows"])


def get_workflows_manager(db: Session = Depends(get_db)) -> WorkflowsManager:
    """Get WorkflowsManager instance."""
    return WorkflowsManager(db)


def get_workflow_executor(db: Session = Depends(get_db)) -> WorkflowExecutor:
    """Get WorkflowExecutor instance."""
    return WorkflowExecutor(db)


@router.get("", response_model=WorkflowListResponse)
async def list_workflows(
    request: Request,
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_ONLY)),
) -> WorkflowListResponse:
    """List all process workflows."""
    workflows = manager.list_workflows(is_active=is_active)
    return WorkflowListResponse(workflows=workflows, total=len(workflows))


@router.get("/step-types", response_model=List[StepTypeSchema])
async def get_step_types(
    request: Request,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_ONLY)),
) -> List[StepTypeSchema]:
    """Get schemas for all available step types."""
    return manager.get_step_type_schemas()


@router.get("/executions", response_model=WorkflowExecutionListResponse)
async def list_executions(
    request: Request,
    db: DBSessionDep,
    workflow_id: Optional[str] = Query(None, description="Filter by workflow ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_ONLY)),
) -> WorkflowExecutionListResponse:
    """List workflow executions."""
    if workflow_id:
        executions = workflow_execution_repo.list_for_workflow(
            db, workflow_id, limit=limit, offset=offset
        )
    else:
        executions = workflow_execution_repo.list_all(
            db, status=status, limit=limit, offset=offset
        )
    
    # Convert to response models
    result = []
    for exe in executions:
        workflow_name = exe.workflow.name if exe.workflow else None
        result.append(WorkflowExecution(
            id=exe.id,
            workflow_id=exe.workflow_id,
            status=exe.status,
            current_step_id=exe.current_step_id,
            success_count=exe.success_count,
            failure_count=exe.failure_count,
            error_message=exe.error_message,
            started_at=exe.started_at,
            finished_at=exe.finished_at,
            triggered_by=exe.triggered_by,
            workflow_name=workflow_name,
        ))
    
    return WorkflowExecutionListResponse(executions=result, total=len(result))


@router.get("/compliance-policies")
async def list_compliance_policies_for_workflows(
    db: DBSessionDep,
    _: bool = Depends(PermissionChecker('compliance', FeatureAccessLevel.READ_ONLY)),
) -> List[Dict[str, Any]]:
    """List active compliance policies for workflow designer selection.
    
    Returns simplified policy objects for use in the policy_check step type selector.
    """
    policies = db.query(CompliancePolicyDb).filter(
        CompliancePolicyDb.is_active == True
    ).order_by(CompliancePolicyDb.name).all()
    
    return [
        {
            "id": p.id,
            "name": p.name,
            "slug": p.slug,
            "description": p.description,
            "category": p.category,
            "severity": p.severity,
        }
        for p in policies
    ]


@router.get("/policy-usage/{policy_id}")
async def get_policy_workflow_usage(
    policy_id: str,
    db: DBSessionDep,
    _: bool = Depends(PermissionChecker('compliance', FeatureAccessLevel.READ_ONLY)),
) -> Dict[str, Any]:
    """Get list of workflows that reference a specific compliance policy.
    
    Scans all workflow steps of type 'policy_check' that have this policy_id configured.
    """
    # Query workflow steps where step_type is 'policy_check' and config contains policy_id
    steps = db.query(WorkflowStepDb).filter(
        WorkflowStepDb.step_type == 'policy_check'
    ).all()
    
    # Filter steps that reference this policy
    workflow_ids = set()
    for step in steps:
        if step.config:
            try:
                config = json.loads(step.config) if isinstance(step.config, str) else step.config
                if config.get('policy_id') == policy_id:
                    workflow_ids.add(step.workflow_id)
            except (json.JSONDecodeError, TypeError):
                continue
    
    # Get workflow details
    workflows = []
    for wf_id in workflow_ids:
        wf = process_workflow_repo.get(db, wf_id)
        if wf:
            workflows.append({
                'id': wf.id,
                'name': wf.name,
                'is_active': wf.is_active,
            })
    
    return {
        'policy_id': policy_id,
        'workflow_count': len(workflows),
        'workflows': workflows,
    }


@router.get("/{workflow_id}", response_model=ProcessWorkflow)
async def get_workflow(
    request: Request,
    workflow_id: str,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_ONLY)),
) -> ProcessWorkflow:
    """Get a specific workflow by ID."""
    workflow = manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.post("", response_model=ProcessWorkflow)
async def create_workflow(
    request: Request,
    workflow: ProcessWorkflowCreate,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_WRITE)),
) -> ProcessWorkflow:
    """Create a new workflow."""
    # Get current user
    user_email = None
    if hasattr(request.state, 'user'):
        user_email = getattr(request.state.user, 'email', None)
    
    # Validate workflow
    validation = manager.validate_workflow(workflow)
    if not validation.valid:
        raise HTTPException(status_code=400, detail={"errors": validation.errors})
    
    return manager.create_workflow(workflow, created_by=user_email)


@router.put("/{workflow_id}", response_model=ProcessWorkflow)
async def update_workflow(
    request: Request,
    workflow_id: str,
    workflow: ProcessWorkflowUpdate,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_WRITE)),
) -> ProcessWorkflow:
    """Update an existing workflow."""
    # Get current user
    user_email = None
    if hasattr(request.state, 'user'):
        user_email = getattr(request.state.user, 'email', None)
    
    # Validate if steps are being updated
    if workflow.steps is not None:
        # Create a full workflow for validation
        existing = manager.get_workflow(workflow_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
        full_workflow = ProcessWorkflowCreate(
            name=workflow.name or existing.name,
            description=workflow.description or existing.description,
            trigger=workflow.trigger or existing.trigger,
            scope=workflow.scope or existing.scope,
            is_active=workflow.is_active if workflow.is_active is not None else existing.is_active,
            steps=workflow.steps,
        )
        validation = manager.validate_workflow(full_workflow)
        if not validation.valid:
            raise HTTPException(status_code=400, detail={"errors": validation.errors})
    
    result = manager.update_workflow(workflow_id, workflow, updated_by=user_email)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/{workflow_id}")
async def delete_workflow(
    request: Request,
    workflow_id: str,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.ADMIN)),
) -> dict:
    """Delete a workflow (non-default only)."""
    # Check if it's a default workflow
    workflow = manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    if workflow.is_default:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete default workflows. Disable it instead."
        )
    
    if not manager.delete_workflow(workflow_id):
        raise HTTPException(status_code=500, detail="Failed to delete workflow")
    
    return {"message": "Workflow deleted"}


@router.post("/{workflow_id}/toggle-active", response_model=ProcessWorkflow)
async def toggle_workflow_active(
    request: Request,
    workflow_id: str,
    is_active: bool = Query(..., description="New active status"),
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_WRITE)),
) -> ProcessWorkflow:
    """Toggle workflow active status."""
    user_email = None
    if hasattr(request.state, 'user'):
        user_email = getattr(request.state.user, 'email', None)
    
    result = manager.toggle_active(workflow_id, is_active, updated_by=user_email)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.post("/{workflow_id}/duplicate", response_model=ProcessWorkflow)
async def duplicate_workflow(
    request: Request,
    workflow_id: str,
    new_name: str = Query(..., description="Name for the duplicated workflow"),
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_WRITE)),
) -> ProcessWorkflow:
    """Duplicate an existing workflow."""
    user_email = None
    if hasattr(request.state, 'user'):
        user_email = getattr(request.state.user, 'email', None)
    
    result = manager.duplicate_workflow(workflow_id, new_name, created_by=user_email)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.post("/{workflow_id}/execute", response_model=WorkflowExecution)
async def execute_workflow(
    request: Request,
    workflow_id: str,
    entity_type: EntityType = Query(..., description="Entity type"),
    entity_id: str = Query(..., description="Entity ID"),
    entity_name: Optional[str] = Query(None, description="Entity name"),
    manager: WorkflowsManager = Depends(get_workflows_manager),
    executor: WorkflowExecutor = Depends(get_workflow_executor),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_WRITE)),
) -> WorkflowExecution:
    """Manually execute a workflow."""
    workflow = manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    user_email = None
    if hasattr(request.state, 'user'):
        user_email = getattr(request.state.user, 'email', None)
    
    # Build trigger context
    trigger_context = TriggerContext(
        entity_type=entity_type.value,
        entity_id=entity_id,
        entity_name=entity_name,
        trigger_type=TriggerType.MANUAL,
        user_email=user_email,
    )
    
    execution = executor.execute_workflow(
        workflow=workflow,
        entity={'id': entity_id, 'name': entity_name, 'type': entity_type.value},
        entity_type=entity_type.value,
        entity_id=entity_id,
        entity_name=entity_name,
        user_email=user_email,
        trigger_context=trigger_context,
    )
    
    return execution


@router.post("/validate", response_model=WorkflowValidationResult)
async def validate_workflow(
    request: Request,
    workflow: ProcessWorkflowCreate,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.READ_ONLY)),
) -> WorkflowValidationResult:
    """Validate a workflow definition."""
    return manager.validate_workflow(workflow)


@router.post("/load-defaults")
async def load_default_workflows(
    request: Request,
    manager: WorkflowsManager = Depends(get_workflows_manager),
    _: bool = Depends(PermissionChecker('settings', FeatureAccessLevel.ADMIN)),
) -> dict:
    """Load default workflows from YAML (admin only)."""
    count = manager.load_from_yaml()
    return {"message": f"Loaded {count} default workflow(s)"}


@router.get("/{workflow_id}/referenced-policies")
async def get_workflow_referenced_policies(
    workflow_id: str,
    db: DBSessionDep,
    _: bool = Depends(PermissionChecker('compliance', FeatureAccessLevel.READ_ONLY)),
) -> Dict[str, Any]:
    """Get list of compliance policies referenced by a workflow.
    
    Scans the workflow's steps for policy_check types and returns the referenced policies.
    """
    workflow = process_workflow_repo.get(db, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    # Get all policy_check steps
    policy_ids = set()
    for step in workflow.steps:
        if step.step_type == 'policy_check' and step.config:
            try:
                config = json.loads(step.config) if isinstance(step.config, str) else step.config
                policy_id = config.get('policy_id')
                if policy_id:
                    policy_ids.add(policy_id)
            except (json.JSONDecodeError, TypeError):
                continue
    
    # Get policy details
    policies = []
    for pid in policy_ids:
        policy = db.get(CompliancePolicyDb, pid)
        if policy:
            policies.append({
                'id': policy.id,
                'name': policy.name,
                'slug': policy.slug,
                'category': policy.category,
                'severity': policy.severity,
                'is_active': policy.is_active,
            })
    
    return {
        'workflow_id': workflow_id,
        'workflow_name': workflow.name,
        'policy_count': len(policies),
        'policies': policies,
    }


def register_routes(app):
    """Register workflow routes with the FastAPI app."""
    app.include_router(router)
    logger.info("Workflow routes registered with prefix /api/workflows")

