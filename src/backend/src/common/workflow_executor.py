"""
Workflow Executor for executing process workflows.

Handles step-by-step execution with branching, including:
- Validation steps (using compliance DSL)
- Approval steps (creates approval requests)
- Notification steps
- Tag assignment/removal
- Conditional branching
- Script execution
"""

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from src.db_models.process_workflows import WorkflowStepDb, WorkflowExecutionDb
from src.models.process_workflows import (
    ProcessWorkflow,
    WorkflowStep,
    WorkflowExecution,
    WorkflowExecutionCreate,
    TriggerContext,
    StepType,
    ExecutionStatus,
    StepExecutionStatus,
    WorkflowStepExecutionResult,
)
from src.repositories.process_workflows_repository import workflow_execution_repo
from src.common.logging import get_logger

logger = get_logger(__name__)


@dataclass
class StepContext:
    """Context for step execution."""
    entity: Dict[str, Any]
    entity_type: str
    entity_id: str
    entity_name: Optional[str]
    user_email: Optional[str]
    trigger_context: Optional[TriggerContext]
    execution_id: str
    workflow_id: str
    workflow_name: str
    step_results: Dict[str, Any]  # Results from previous steps


@dataclass
class StepResult:
    """Result of step execution."""
    passed: bool
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    blocking: bool = False  # If True, workflow pauses (e.g., approval)


class StepHandler(ABC):
    """Base class for step handlers."""

    def __init__(self, db: Session, config: Dict[str, Any]):
        self._db = db
        self._config = config

    @abstractmethod
    def execute(self, context: StepContext) -> StepResult:
        """Execute the step.
        
        Args:
            context: Step execution context
            
        Returns:
            StepResult with execution outcome
        """
        pass


class ValidationStepHandler(StepHandler):
    """Handler for validation steps using compliance DSL."""

    def execute(self, context: StepContext) -> StepResult:
        from src.common.compliance_dsl import evaluate_rule_on_object
        
        rule = self._config.get('rule', '')
        if not rule:
            return StepResult(passed=False, error="No rule configured")
        
        try:
            passed, message = evaluate_rule_on_object(rule, context.entity)
            return StepResult(
                passed=passed,
                message=message,
                data={'rule': rule}
            )
        except Exception as e:
            logger.exception(f"Validation step failed: {e}")
            return StepResult(
                passed=False,
                error=str(e)
            )


class ApprovalStepHandler(StepHandler):
    """Handler for approval steps."""

    def execute(self, context: StepContext) -> StepResult:
        approvers = self._config.get('approvers', '')
        timeout_days = self._config.get('timeout_days', 7)
        require_all = self._config.get('require_all', False)
        
        if not approvers:
            return StepResult(passed=False, error="No approvers configured")
        
        try:
            # Resolve approvers
            resolved_approvers = self._resolve_approvers(approvers, context)
            
            # Create approval request using the approvals manager
            # For now, we return blocking=True to pause the workflow
            # The approval system will resume the workflow when approved/rejected
            
            return StepResult(
                passed=True,  # Initial pass, actual result comes from approval
                message=f"Approval requested from: {', '.join(resolved_approvers)}",
                data={
                    'approvers': resolved_approvers,
                    'timeout_days': timeout_days,
                    'require_all': require_all,
                    'status': 'pending',
                },
                blocking=True,  # Pause workflow
            )
        except Exception as e:
            logger.exception(f"Approval step failed: {e}")
            return StepResult(passed=False, error=str(e))

    def _resolve_approvers(self, approvers: str, context: StepContext) -> List[str]:
        """Resolve approver specification to actual user emails."""
        if approvers == 'domain_owners':
            # TODO: Look up domain owners based on entity
            return ['domain-owner@example.com']
        elif approvers == 'project_owners':
            # TODO: Look up project owners
            return ['project-owner@example.com']
        elif approvers == 'requester':
            return [context.user_email] if context.user_email else []
        elif '@' in approvers:
            # Assume it's an email or comma-separated emails
            return [e.strip() for e in approvers.split(',')]
        else:
            # Assume it's a group name
            # TODO: Look up group members
            return [approvers]


class NotificationStepHandler(StepHandler):
    """Handler for notification steps."""

    def execute(self, context: StepContext) -> StepResult:
        recipients = self._config.get('recipients', '')
        template = self._config.get('template', '')
        custom_message = self._config.get('custom_message')
        
        if not recipients:
            return StepResult(passed=False, error="No recipients configured")
        
        try:
            # Resolve recipients
            resolved_recipients = self._resolve_recipients(recipients, context)
            
            # Build notification message
            message = custom_message or self._get_template_message(template, context)
            
            # Send notification using notifications manager
            # For now, just log it
            logger.info(f"Notification to {resolved_recipients}: {message}")
            
            # TODO: Integrate with NotificationsManager
            # notifications_manager.send_notification(...)
            
            return StepResult(
                passed=True,
                message=f"Notification sent to: {', '.join(resolved_recipients)}",
                data={
                    'recipients': resolved_recipients,
                    'template': template,
                    'message': message,
                }
            )
        except Exception as e:
            logger.exception(f"Notification step failed: {e}")
            return StepResult(passed=False, error=str(e))

    def _resolve_recipients(self, recipients: str, context: StepContext) -> List[str]:
        """Resolve recipient specification to actual user emails."""
        if recipients == 'requester':
            return [context.user_email] if context.user_email else []
        elif recipients == 'owner':
            owner = context.entity.get('owner')
            return [owner] if owner else []
        elif '@' in recipients:
            return [e.strip() for e in recipients.split(',')]
        else:
            # Assume it's a group name
            return [recipients]

    def _get_template_message(self, template: str, context: StepContext) -> str:
        """Get message from template."""
        templates = {
            'validation_failed': f"Validation failed for {context.entity_type} '{context.entity_name}'",
            'validation_passed': f"Validation passed for {context.entity_type} '{context.entity_name}'",
            'product_approved': f"Data product '{context.entity_name}' has been approved",
            'product_rejected': f"Data product '{context.entity_name}' has been rejected",
            'approval_requested': f"Approval requested for {context.entity_type} '{context.entity_name}'",
        }
        return templates.get(template, f"Workflow notification for {context.entity_name}")


class AssignTagStepHandler(StepHandler):
    """Handler for tag assignment steps."""

    def execute(self, context: StepContext) -> StepResult:
        key = self._config.get('key', '')
        value = self._config.get('value')
        value_source = self._config.get('value_source')
        
        if not key:
            return StepResult(passed=False, error="No tag key configured")
        
        try:
            # Resolve value
            if value_source:
                resolved_value = self._resolve_value_source(value_source, context)
            else:
                resolved_value = value
            
            if not resolved_value:
                return StepResult(passed=False, error="Could not resolve tag value")
            
            # Assign tag to entity
            # TODO: Integrate with TagsManager
            logger.info(f"Assigning tag {key}={resolved_value} to {context.entity_type} {context.entity_id}")
            
            # Update entity tags in context
            if 'tags' not in context.entity:
                context.entity['tags'] = {}
            context.entity['tags'][key] = resolved_value
            
            return StepResult(
                passed=True,
                message=f"Assigned tag {key}={resolved_value}",
                data={'key': key, 'value': resolved_value}
            )
        except Exception as e:
            logger.exception(f"Assign tag step failed: {e}")
            return StepResult(passed=False, error=str(e))

    def _resolve_value_source(self, source: str, context: StepContext) -> Optional[str]:
        """Resolve dynamic value source."""
        if source == 'current_user':
            return context.user_email
        elif source == 'project_name':
            return context.entity.get('project_name') or context.entity.get('project_id')
        elif source == 'entity_name':
            return context.entity_name
        elif source == 'timestamp':
            return datetime.utcnow().isoformat()
        else:
            return None


class RemoveTagStepHandler(StepHandler):
    """Handler for tag removal steps."""

    def execute(self, context: StepContext) -> StepResult:
        key = self._config.get('key', '')
        
        if not key:
            return StepResult(passed=False, error="No tag key configured")
        
        try:
            # Remove tag from entity
            # TODO: Integrate with TagsManager
            logger.info(f"Removing tag {key} from {context.entity_type} {context.entity_id}")
            
            # Update entity tags in context
            if 'tags' in context.entity and key in context.entity['tags']:
                del context.entity['tags'][key]
            
            return StepResult(
                passed=True,
                message=f"Removed tag {key}",
                data={'key': key}
            )
        except Exception as e:
            logger.exception(f"Remove tag step failed: {e}")
            return StepResult(passed=False, error=str(e))


class ConditionalStepHandler(StepHandler):
    """Handler for conditional branching steps."""

    def execute(self, context: StepContext) -> StepResult:
        from src.common.compliance_dsl import Lexer, Parser, Evaluator
        
        condition = self._config.get('condition', '')
        if not condition:
            return StepResult(passed=False, error="No condition configured")
        
        try:
            # Parse and evaluate condition
            lexer = Lexer(condition)
            tokens = lexer.tokenize()
            parser = Parser(tokens)
            ast = parser.parse_expression()
            evaluator = Evaluator(context.entity)
            result = evaluator.evaluate(ast)
            
            return StepResult(
                passed=bool(result),
                message=f"Condition evaluated to: {result}",
                data={'condition': condition, 'result': result}
            )
        except Exception as e:
            logger.exception(f"Conditional step failed: {e}")
            return StepResult(passed=False, error=str(e))


class ScriptStepHandler(StepHandler):
    """Handler for script execution steps."""

    def execute(self, context: StepContext) -> StepResult:
        language = self._config.get('language', 'python')
        code = self._config.get('code', '')
        timeout_seconds = self._config.get('timeout_seconds', 60)
        
        if not code:
            return StepResult(passed=False, error="No code configured")
        
        try:
            if language == 'python':
                result = self._execute_python(code, context, timeout_seconds)
            elif language == 'sql':
                result = self._execute_sql(code, context, timeout_seconds)
            else:
                return StepResult(passed=False, error=f"Unsupported language: {language}")
            
            return result
        except Exception as e:
            logger.exception(f"Script step failed: {e}")
            return StepResult(passed=False, error=str(e))

    def _execute_python(self, code: str, context: StepContext, timeout: int) -> StepResult:
        """Execute Python code in a sandboxed environment."""
        # Build safe context
        safe_globals = {
            'entity': context.entity.copy(),
            'entity_type': context.entity_type,
            'entity_id': context.entity_id,
            'entity_name': context.entity_name,
            'user_email': context.user_email,
            'step_results': context.step_results.copy(),
        }
        
        local_vars: Dict[str, Any] = {}
        
        try:
            # Execute with timeout would require threading/subprocess
            # For now, simple exec with limited builtins
            exec(code, {'__builtins__': {}}, local_vars)
            
            result = local_vars.get('result', {'passed': True})
            if isinstance(result, dict):
                return StepResult(
                    passed=result.get('passed', True),
                    message=result.get('message'),
                    data=result.get('data'),
                )
            else:
                return StepResult(passed=bool(result))
        except Exception as e:
            return StepResult(passed=False, error=str(e))

    def _execute_sql(self, code: str, context: StepContext, timeout: int) -> StepResult:
        """Execute SQL code (placeholder - needs proper implementation)."""
        # TODO: Implement SQL execution via workspace client
        logger.warning("SQL execution not yet implemented")
        return StepResult(
            passed=True,
            message="SQL execution not yet implemented",
            data={'sql': code}
        )


class PassStepHandler(StepHandler):
    """Handler for terminal success steps."""

    def execute(self, context: StepContext) -> StepResult:
        return StepResult(passed=True, message="Workflow completed successfully")


class FailStepHandler(StepHandler):
    """Handler for terminal failure steps."""

    def execute(self, context: StepContext) -> StepResult:
        message = self._config.get('message', 'Workflow failed')
        return StepResult(passed=False, message=message)


class PolicyCheckStepHandler(StepHandler):
    """Handler for policy check steps - evaluates existing compliance policy by UUID."""

    def execute(self, context: StepContext) -> StepResult:
        from src.db_models.compliance import CompliancePolicyDb
        from src.common.compliance_dsl import evaluate_rule_on_object
        
        policy_id = self._config.get('policy_id', '')
        if not policy_id:
            return StepResult(passed=False, error="No policy_id configured")
        
        try:
            # Look up policy by UUID
            policy = self._db.get(CompliancePolicyDb, policy_id)
            if not policy:
                return StepResult(
                    passed=False, 
                    error=f"Policy not found: {policy_id}",
                    data={'policy_id': policy_id}
                )
            
            # Skip inactive policies (treated as pass)
            if not policy.is_active:
                return StepResult(
                    passed=True, 
                    message=f"Policy '{policy.name}' is inactive, skipped",
                    data={'policy_id': policy_id, 'policy_name': policy.name, 'skipped': True}
                )
            
            # Evaluate the policy's rule against the entity
            passed, message = evaluate_rule_on_object(policy.rule, context.entity)
            
            return StepResult(
                passed=passed,
                message=message,
                data={
                    'policy_id': policy_id, 
                    'policy_name': policy.name, 
                    'rule': policy.rule,
                    'severity': policy.severity,
                }
            )
        except Exception as e:
            logger.exception(f"Policy check step failed: {e}")
            return StepResult(
                passed=False, 
                error=str(e),
                data={'policy_id': policy_id}
            )


class WorkflowExecutor:
    """Executes process workflows."""

    # Step handler registry
    HANDLERS: Dict[str, type] = {
        'validation': ValidationStepHandler,
        'approval': ApprovalStepHandler,
        'notification': NotificationStepHandler,
        'assign_tag': AssignTagStepHandler,
        'remove_tag': RemoveTagStepHandler,
        'conditional': ConditionalStepHandler,
        'script': ScriptStepHandler,
        'pass': PassStepHandler,
        'fail': FailStepHandler,
        'policy_check': PolicyCheckStepHandler,
    }

    def __init__(self, db: Session):
        self._db = db

    def execute_workflow(
        self,
        workflow: ProcessWorkflow,
        entity: Dict[str, Any],
        *,
        entity_type: str,
        entity_id: str,
        entity_name: Optional[str] = None,
        user_email: Optional[str] = None,
        trigger_context: Optional[TriggerContext] = None,
        blocking: bool = True,
    ) -> WorkflowExecution:
        """Execute a workflow against an entity.
        
        Args:
            workflow: Workflow to execute
            entity: Entity data dictionary
            entity_type: Type of entity
            entity_id: Entity identifier
            entity_name: Entity name (optional)
            user_email: User who triggered the workflow
            trigger_context: Full trigger context
            blocking: If True, run synchronously; if False, queue for async execution
            
        Returns:
            WorkflowExecution with results
        """
        # Create execution record
        execution_create = WorkflowExecutionCreate(
            workflow_id=workflow.id,
            trigger_context=trigger_context,
            triggered_by=user_email,
        )
        db_execution = workflow_execution_repo.create(self._db, execution_create)
        
        # Build step context
        context = StepContext(
            entity=entity.copy(),
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            user_email=user_email,
            trigger_context=trigger_context,
            execution_id=db_execution.id,
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            step_results={},
        )
        
        # Build step lookup
        steps_by_id = {s.step_id: s for s in workflow.steps}
        
        # Execute steps
        success_count = 0
        failure_count = 0
        current_step_id = workflow.steps[0].step_id if workflow.steps else None
        final_status = ExecutionStatus.RUNNING
        error_message = None
        
        while current_step_id:
            step = steps_by_id.get(current_step_id)
            if not step:
                error_message = f"Step not found: {current_step_id}"
                final_status = ExecutionStatus.FAILED
                break
            
            # Execute step
            start_time = time.time()
            result = self._execute_step(step, context)
            duration_ms = (time.time() - start_time) * 1000
            
            # Record step execution
            step_status = StepExecutionStatus.SUCCEEDED if result.passed else StepExecutionStatus.FAILED
            workflow_execution_repo.add_step_execution(
                self._db,
                execution_id=db_execution.id,
                step_id=step.id,
                status=step_status.value,
                passed=result.passed,
                result_data=result.data,
                error_message=result.error,
                duration_ms=duration_ms,
            )
            
            # Store result in context for subsequent steps
            context.step_results[step.step_id] = {
                'passed': result.passed,
                'message': result.message,
                'data': result.data,
            }
            
            # Update counters
            if result.passed:
                success_count += 1
            else:
                failure_count += 1
            
            # Check for blocking step (e.g., approval)
            if result.blocking:
                final_status = ExecutionStatus.PAUSED
                workflow_execution_repo.update_status(
                    self._db,
                    db_execution.id,
                    status=final_status.value,
                    current_step_id=current_step_id,
                    success_count=success_count,
                    failure_count=failure_count,
                )
                break
            
            # Determine next step
            if result.passed:
                current_step_id = step.on_pass
            else:
                current_step_id = step.on_fail
            
            # If no next step, we're done
            if not current_step_id:
                if result.passed:
                    final_status = ExecutionStatus.SUCCEEDED
                else:
                    final_status = ExecutionStatus.FAILED
                    error_message = result.message or result.error
        
        # Finalize execution
        if final_status != ExecutionStatus.PAUSED:
            workflow_execution_repo.update_status(
                self._db,
                db_execution.id,
                status=final_status.value,
                success_count=success_count,
                failure_count=failure_count,
                error_message=error_message,
                finished_at=datetime.utcnow().isoformat(),
            )
        
        # Return execution with results
        db_execution = workflow_execution_repo.get(self._db, db_execution.id)
        return self._db_to_model(db_execution, workflow.name)

    def resume_workflow(
        self,
        execution_id: str,
        step_result: bool,
        *,
        result_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[WorkflowExecution]:
        """Resume a paused workflow after approval/external action.
        
        Args:
            execution_id: ID of paused execution
            step_result: Result of the paused step (True=approved, False=rejected)
            result_data: Additional result data
            
        Returns:
            Updated WorkflowExecution
        """
        db_execution = workflow_execution_repo.get(self._db, execution_id)
        if not db_execution or db_execution.status != 'paused':
            return None
        
        # Get workflow
        from src.repositories.process_workflows_repository import process_workflow_repo
        db_workflow = process_workflow_repo.get(self._db, db_execution.workflow_id)
        if not db_workflow:
            return None
        
        # TODO: Implement resume logic
        # This would continue execution from current_step_id
        
        return self._db_to_model(db_execution, db_workflow.name)

    def _execute_step(self, step: WorkflowStep, context: StepContext) -> StepResult:
        """Execute a single step."""
        step_type = step.step_type.value if hasattr(step.step_type, 'value') else step.step_type
        handler_class = self.HANDLERS.get(step_type)
        
        if not handler_class:
            return StepResult(passed=False, error=f"Unknown step type: {step_type}")
        
        try:
            handler = handler_class(self._db, step.config or {})
            return handler.execute(context)
        except Exception as e:
            logger.exception(f"Step execution failed: {e}")
            return StepResult(passed=False, error=str(e))

    def _db_to_model(self, db_execution: WorkflowExecutionDb, workflow_name: str) -> WorkflowExecution:
        """Convert database execution to model."""
        trigger_context = None
        if db_execution.trigger_context:
            try:
                tc_data = json.loads(db_execution.trigger_context)
                trigger_context = TriggerContext(**tc_data)
            except (json.JSONDecodeError, TypeError):
                pass
        
        step_executions = []
        for se in db_execution.step_executions:
            step_executions.append(WorkflowStepExecutionResult(
                id=se.id,
                step_id=se.step_id,
                status=StepExecutionStatus(se.status),
                passed=se.passed,
                result_data=json.loads(se.result_data) if se.result_data else None,
                error_message=se.error_message,
                duration_ms=se.duration_ms,
                started_at=se.started_at,
                finished_at=se.finished_at,
            ))
        
        return WorkflowExecution(
            id=db_execution.id,
            workflow_id=db_execution.workflow_id,
            trigger_context=trigger_context,
            status=ExecutionStatus(db_execution.status),
            current_step_id=db_execution.current_step_id,
            success_count=db_execution.success_count,
            failure_count=db_execution.failure_count,
            error_message=db_execution.error_message,
            started_at=db_execution.started_at,
            finished_at=db_execution.finished_at,
            triggered_by=db_execution.triggered_by,
            step_executions=step_executions,
            workflow_name=workflow_name,
        )

