"""
LLM Search Manager

Orchestrates conversational LLM search with tool-calling capabilities.
Uses Claude Sonnet 4.5 via Databricks serving endpoints to answer
business questions about data products, glossary terms, costs, and analytics.
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from src.common.config import Settings, get_settings
from src.common.logging import get_logger
from src.common.sql_validator import SQLValidator, validate_and_prepare_query
from src.models.llm_search import (
    ConversationSession, ChatMessage, ChatResponse, MessageRole,
    ToolCall, ToolName, SessionSummary, LLMSearchStatus,
    SearchDataProductsParams, SearchGlossaryTermsParams,
    GetDataProductCostsParams, GetTableSchemaParams, ExecuteAnalyticsQueryParams
)

logger = get_logger(__name__)


# ============================================================================
# System Prompt
# ============================================================================

SYSTEM_PROMPT = """You are Ontos, an intelligent data governance assistant. You help users discover, understand, and analyze data within their organization.

## Your Capabilities

You have access to the following tools:

1. **search_data_products** - Search for data products by name, domain, description, or keywords. Use this to find available datasets.

2. **search_glossary_terms** - Search the knowledge graph for business concepts, terms, and their definitions from loaded ontologies and taxonomies.

3. **get_data_product_costs** - Get cost information for data products, including infrastructure, HR, storage, and other costs.

4. **get_table_schema** - Get the schema (columns and types) of a specific table. Use this before writing analytics queries.

5. **execute_analytics_query** - Execute a read-only SQL SELECT query against Databricks tables. Use this for aggregations, joins, and data analysis.

6. **explore_catalog_schema** - List all tables and views in a Unity Catalog schema with their columns. Use this to understand what data assets exist and suggest semantic models or data products.

7. **create_draft_data_contract** - Create a new draft data contract from schema information. Always create contracts in draft status for user review.

8. **create_draft_data_product** - Create a new draft data product, optionally linked to a contract. Always create products in draft status for user review.

## Guidelines

- Always search for relevant data products or glossary terms before attempting analytics queries
- When executing analytics queries, first get the table schema to understand available columns
- Use explore_catalog_schema to discover tables in a database before suggesting semantic models
- Explain your reasoning and cite the data sources you used
- If you don't have access to certain data or a query fails, explain why and suggest alternatives
- Format responses with clear sections, tables, and bullet points for readability
- Be concise but thorough - include relevant context without unnecessary verbosity

## Response Format

When presenting data:
- Use markdown tables for tabular results. IMPORTANT: Tables must have proper line breaks between each row:
  ```
  | Column1 | Column2 |
  |---------|---------|
  | value1  | value2  |
  | value3  | value4  |
  ```
  Never put multiple table rows on a single line.
- Use bullet points for lists
- Bold important numbers and findings
- Include units (USD, %, etc.) where applicable

## Limitations

- You can only execute read-only SELECT queries
- Query results are limited to 1000 rows
- You can only access tables the user has permissions for
- Cost data may not be complete for all products
"""


# ============================================================================
# Tool Definitions for OpenAI API
# ============================================================================

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_data_products",
            "description": "Search for data products by name, domain, description, or keywords. Returns matching data products with their metadata.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for data products (e.g., 'customer', 'sales transactions')"
                    },
                    "domain": {
                        "type": "string",
                        "description": "Optional filter by domain (e.g., 'Customer', 'Sales', 'Finance')"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "draft", "deprecated", "retired"],
                        "description": "Optional filter by product status"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_glossary_terms",
            "description": "Search the knowledge graph for business concepts, terms, and definitions from ontologies and taxonomies.",
            "parameters": {
                "type": "object",
                "properties": {
                    "term": {
                        "type": "string",
                        "description": "Business term or concept to search for (e.g., 'Customer', 'Sales', 'Transaction', 'Revenue')"
                    },
                    "domain": {
                        "type": "string",
                        "description": "Optional taxonomy/domain filter"
                    }
                },
                "required": ["term"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_data_product_costs",
            "description": "Get cost information for data products including infrastructure, HR, storage costs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "string",
                        "description": "Specific product ID, or omit for all products"
                    },
                    "aggregate": {
                        "type": "boolean",
                        "description": "If true, return totals; if false, return per-product breakdown",
                        "default": False
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_table_schema",
            "description": "Get the schema (columns and data types) of a table from a data product.",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_fqn": {
                        "type": "string",
                        "description": "Fully qualified table name (catalog.schema.table)"
                    }
                },
                "required": ["table_fqn"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_analytics_query",
            "description": "Execute a read-only SQL SELECT query against Databricks tables. Use for aggregations, joins, filtering.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "The SQL SELECT query to execute"
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Brief explanation of what this query does and why"
                    }
                },
                "required": ["sql", "explanation"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "explore_catalog_schema",
            "description": "List all tables and views in a Unity Catalog schema, including their columns and types. Use this to understand what data assets exist in a database/schema and suggest semantic models or data products.",
            "parameters": {
                "type": "object",
                "properties": {
                    "catalog": {
                        "type": "string",
                        "description": "Catalog name (e.g., 'demo_cat', 'main')"
                    },
                    "schema": {
                        "type": "string",
                        "description": "Schema/database name (e.g., 'demo_db', 'default')"
                    },
                    "include_columns": {
                        "type": "boolean",
                        "description": "If true, include column details for each table (default: true)"
                    }
                },
                "required": ["catalog", "schema"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_draft_data_contract",
            "description": "Create a new draft data contract based on schema information. The contract will be created in 'draft' status for user review. Use after exploring a catalog schema to formalize a data asset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name for the contract (e.g., 'Customer Master Data Contract')"
                    },
                    "description": {
                        "type": "string",
                        "description": "Business description of what this contract governs"
                    },
                    "domain": {
                        "type": "string",
                        "description": "Business domain (e.g., 'Customer', 'Sales', 'Finance')"
                    },
                    "tables": {
                        "type": "array",
                        "description": "List of tables to include in the contract schema",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Table name"},
                                "full_name": {"type": "string", "description": "Fully qualified table name (catalog.schema.table)"},
                                "description": {"type": "string", "description": "Table description"},
                                "columns": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "type": {"type": "string"},
                                            "description": {"type": "string"}
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "required": ["name", "description", "domain"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_draft_data_product",
            "description": "Create a new draft data product. The product will be created in 'draft' status for user review. Optionally link to an existing data contract.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name for the data product (e.g., 'Customer Analytics Product')"
                    },
                    "description": {
                        "type": "string",
                        "description": "Business description and purpose of the data product"
                    },
                    "domain": {
                        "type": "string",
                        "description": "Business domain (e.g., 'Customer', 'Sales', 'Finance')"
                    },
                    "contract_id": {
                        "type": "string",
                        "description": "Optional: ID of an existing data contract to link to this product"
                    },
                    "output_tables": {
                        "type": "array",
                        "description": "List of output table FQNs this product provides",
                        "items": {"type": "string"}
                    }
                },
                "required": ["name", "description", "domain"]
            }
        }
    }
]


# ============================================================================
# Session Storage (In-Memory for now, can be extended to Redis/DB)
# ============================================================================

@dataclass
class SessionStore:
    """In-memory session storage with expiration."""
    sessions: Dict[str, ConversationSession] = field(default_factory=dict)
    max_sessions_per_user: int = 10
    session_ttl_hours: int = 24
    
    def get(self, session_id: str) -> Optional[ConversationSession]:
        """Get a session by ID."""
        session = self.sessions.get(session_id)
        if session:
            # Check expiration
            age_hours = (datetime.utcnow() - session.created_at).total_seconds() / 3600
            if age_hours > self.session_ttl_hours:
                del self.sessions[session_id]
                return None
        return session
    
    def create(self, user_id: str) -> ConversationSession:
        """Create a new session for a user."""
        # Clean up old sessions for this user
        user_sessions = [
            (sid, s) for sid, s in self.sessions.items()
            if s.user_id == user_id
        ]
        user_sessions.sort(key=lambda x: x[1].updated_at, reverse=True)
        
        # Remove oldest if over limit
        while len(user_sessions) >= self.max_sessions_per_user:
            old_sid, _ = user_sessions.pop()
            del self.sessions[old_sid]
        
        session = ConversationSession(user_id=user_id)
        self.sessions[session.id] = session
        return session
    
    def delete(self, session_id: str) -> bool:
        """Delete a session."""
        if session_id in self.sessions:
            del self.sessions[session_id]
            return True
        return False
    
    def list_for_user(self, user_id: str) -> List[SessionSummary]:
        """List sessions for a user."""
        result = []
        for session in self.sessions.values():
            if session.user_id == user_id:
                result.append(SessionSummary(
                    id=session.id,
                    title=session.title,
                    message_count=len(session.messages),
                    created_at=session.created_at,
                    updated_at=session.updated_at
                ))
        result.sort(key=lambda x: x.updated_at, reverse=True)
        return result


# ============================================================================
# LLM Search Manager
# ============================================================================

class LLMSearchManager:
    """
    Orchestrates conversational LLM search with tool-calling.
    
    Architecture:
    1. User sends message
    2. LLM processes with available tools
    3. If LLM requests tool calls, execute them
    4. Feed results back to LLM
    5. Repeat until LLM provides final response
    """
    
    def __init__(
        self,
        db: Session,
        settings: Settings,
        data_products_manager: Optional[Any] = None,
        data_contracts_manager: Optional[Any] = None,
        semantic_models_manager: Optional[Any] = None,
        costs_manager: Optional[Any] = None,
        search_manager: Optional[Any] = None,
        workspace_client: Optional[Any] = None
    ):
        self._db = db
        self._settings = settings
        self._data_products_manager = data_products_manager
        self._data_contracts_manager = data_contracts_manager
        self._semantic_models_manager = semantic_models_manager
        self._costs_manager = costs_manager
        self._search_manager = search_manager
        self._ws_client = workspace_client
        self._session_store = SessionStore()
        self._sql_validator = SQLValidator(max_row_limit=1000)
        
        logger.info(f"LLMSearchManager initialized (semantic_models_manager={semantic_models_manager is not None})")
    
    # ========================================================================
    # Public API
    # ========================================================================
    
    def get_status(self) -> LLMSearchStatus:
        """Get the status of LLM search functionality."""
        return LLMSearchStatus(
            enabled=self._settings.LLM_ENABLED,
            endpoint=self._settings.LLM_ENDPOINT,
            disclaimer=self._settings.LLM_DISCLAIMER_TEXT or (
                "This feature uses AI to analyze data assets. AI-generated content may contain errors. "
                "Review all suggestions carefully before taking action."
            )
        )
    
    def list_sessions(self, user_id: str) -> List[SessionSummary]:
        """List conversation sessions for a user."""
        return self._session_store.list_for_user(user_id)
    
    def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session if owned by user."""
        session = self._session_store.get(session_id)
        if session and session.user_id == user_id:
            return self._session_store.delete(session_id)
        return False
    
    def get_session(self, session_id: str, user_id: str) -> Optional[ConversationSession]:
        """Get a session by ID if owned by user."""
        session = self._session_store.get(session_id)
        if session and session.user_id == user_id:
            return session
        return None
    
    async def chat(
        self,
        user_message: str,
        user_id: str,
        user_token: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> ChatResponse:
        """
        Process a chat message and return the assistant's response.
        
        Args:
            user_message: The user's message
            user_id: ID of the user
            user_token: User's access token for Databricks (for table access)
            session_id: Optional session ID to continue conversation
            
        Returns:
            ChatResponse with the assistant's message
        """
        # Check if LLM is enabled
        if not self._settings.LLM_ENABLED:
            logger.warning("LLM chat requested but LLM_ENABLED is False")
            return ChatResponse(
                session_id="",
                message=ChatMessage(
                    role=MessageRole.ASSISTANT,
                    content="LLM search is not enabled. Please contact your administrator."
                ),
                tool_calls_executed=0,
                sources=[]
            )
        
        # Get or create session
        if session_id:
            session = self._session_store.get(session_id)
            if not session or session.user_id != user_id:
                session = self._session_store.create(user_id)
        else:
            session = self._session_store.create(user_id)
        
        # Add user message
        session.add_user_message(user_message)
        
        # Process with LLM
        try:
            response_content, tool_calls_executed, sources = await self._process_with_llm(
                session, user_token
            )
            
            # Add assistant response
            assistant_msg = session.add_assistant_message(response_content)
            
            return ChatResponse(
                session_id=session.id,
                message=assistant_msg,
                tool_calls_executed=tool_calls_executed,
                sources=sources
            )
            
        except Exception as e:
            logger.error(f"Error processing chat: {e}", exc_info=True)
            error_msg = session.add_assistant_message(
                f"I apologize, but I encountered an error processing your request: {str(e)}"
            )
            return ChatResponse(
                session_id=session.id,
                message=error_msg,
                tool_calls_executed=0,
                sources=[]
            )
    
    # ========================================================================
    # LLM Processing
    # ========================================================================
    
    async def _process_with_llm(
        self,
        session: ConversationSession,
        user_token: Optional[str]
    ) -> Tuple[str, int, List[Dict[str, Any]]]:
        """
        Process conversation with LLM, handling tool calls.
        
        Returns:
            Tuple of (response_content, tool_calls_count, sources)
        """
        client = self._get_openai_client(user_token)
        total_tool_calls = 0
        sources: List[Dict[str, Any]] = []
        max_iterations = 5  # Prevent infinite loops
        
        for iteration in range(max_iterations):
            # Build messages for LLM
            messages = session.get_messages_for_llm(SYSTEM_PROMPT)
            
            # Call LLM
            try:
                logger.debug(f"Calling LLM (iteration {iteration + 1}/{max_iterations})")
                response = client.chat.completions.create(
                    model=self._settings.LLM_ENDPOINT,
                    messages=messages,
                    tools=TOOL_DEFINITIONS,
                    tool_choice="auto",
                    max_tokens=4096
                )
                logger.debug(f"LLM response received successfully")
            except Exception as llm_error:
                logger.error(f"LLM API call failed: {llm_error}", exc_info=True)
                raise RuntimeError(f"Failed to connect to LLM endpoint: {llm_error}")
            
            assistant_message = response.choices[0].message
            
            # Check if LLM wants to call tools
            if assistant_message.tool_calls:
                # Add assistant message with tool calls to session
                tool_calls = [
                    ToolCall(
                        id=tc.id,
                        name=ToolName(tc.function.name),
                        arguments=json.loads(tc.function.arguments) if tc.function.arguments else {}
                    )
                    for tc in assistant_message.tool_calls
                ]
                session.add_assistant_message(None, tool_calls)
                
                # Execute each tool call
                for tc in assistant_message.tool_calls:
                    total_tool_calls += 1
                    tool_name = tc.function.name
                    tool_args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                    
                    logger.info(f"Executing tool: {tool_name} with args: {tool_args}")
                    
                    try:
                        result = await self._execute_tool(tool_name, tool_args, user_token)
                        sources.append({
                            "tool": tool_name,
                            "args": tool_args,
                            "success": True
                        })
                    except Exception as e:
                        logger.error(f"Tool execution failed: {e}")
                        result = {"error": str(e)}
                        sources.append({
                            "tool": tool_name,
                            "args": tool_args,
                            "success": False,
                            "error": str(e)
                        })
                    
                    # Add tool result to session
                    session.add_tool_result(tc.id, result)
            else:
                # No tool calls - return the response
                return assistant_message.content or "", total_tool_calls, sources
        
        # Max iterations reached
        logger.warning("Max LLM iterations reached")
        return "I apologize, but I wasn't able to complete your request. Please try rephrasing your question.", total_tool_calls, sources
    
    def _get_openai_client(self, user_token: Optional[str] = None):
        """Get OpenAI client for Databricks.
        
        Authentication priority:
        1. Explicit user_token parameter
        2. DATABRICKS_TOKEN from settings/.env (for local development with explicit config)
        3. Databricks SDK default config (OBO token in Databricks Apps)
        
        Note: We check .env settings first so local development uses the configured
        workspace, not ~/.databrickscfg. In Databricks Apps, DATABRICKS_TOKEN is
        typically not set, so it falls through to SDK config (OBO).
        """
        try:
            from openai import OpenAI
            
            token = user_token
            
            # First try explicit token from settings/.env (local development)
            if not token:
                token = self._settings.DATABRICKS_TOKEN or os.environ.get('DATABRICKS_TOKEN')
                if token:
                    logger.info("Using token from settings/environment (PAT)")
            
            # Fall back to Databricks SDK config (OBO in Apps, ~/.databrickscfg locally)
            if not token:
                try:
                    from databricks.sdk.core import Config
                    config = Config()
                    headers = config.authenticate()
                    if headers and 'Authorization' in headers:
                        auth_header = headers['Authorization']
                        if auth_header.startswith('Bearer '):
                            token = auth_header[7:]
                            logger.info("Using token from Databricks SDK (user credentials)")
                except Exception as sdk_err:
                    logger.debug(f"Could not get token from SDK config: {sdk_err}")
            
            if not token:
                raise RuntimeError("No authentication token available. Ensure the app has access to a serving endpoint or set DATABRICKS_TOKEN.")
            
            # Determine base URL
            base_url = self._settings.LLM_BASE_URL
            if not base_url and self._settings.DATABRICKS_HOST:
                host = self._settings.DATABRICKS_HOST.rstrip('/')
                # Ensure the URL has a protocol
                if not host.startswith('http://') and not host.startswith('https://'):
                    host = f"https://{host}"
                base_url = f"{host}/serving-endpoints"
            
            if not base_url:
                raise RuntimeError("LLM_BASE_URL not configured. Set LLM_BASE_URL or DATABRICKS_HOST.")
            
            logger.info(f"Creating OpenAI client for base_url={base_url}, endpoint={self._settings.LLM_ENDPOINT}")
            return OpenAI(api_key=token, base_url=base_url)
            
        except Exception as e:
            logger.error(f"Failed to create OpenAI client: {e}", exc_info=True)
            raise RuntimeError(f"LLM connection failed: {e}")
    
    # ========================================================================
    # Tool Execution
    # ========================================================================
    
    async def _execute_tool(
        self,
        tool_name: str,
        args: Dict[str, Any],
        user_token: Optional[str]
    ) -> Dict[str, Any]:
        """Execute a tool and return results."""
        
        if tool_name == "search_data_products":
            return await self._tool_search_data_products(**args)
        
        elif tool_name == "search_glossary_terms":
            return await self._tool_search_glossary_terms(**args)
        
        elif tool_name == "get_data_product_costs":
            return await self._tool_get_data_product_costs(**args)
        
        elif tool_name == "get_table_schema":
            return await self._tool_get_table_schema(user_token=user_token, **args)
        
        elif tool_name == "execute_analytics_query":
            return await self._tool_execute_analytics_query(user_token=user_token, **args)
        
        elif tool_name == "explore_catalog_schema":
            return await self._tool_explore_catalog_schema(user_token=user_token, **args)
        
        elif tool_name == "create_draft_data_contract":
            return await self._tool_create_draft_data_contract(**args)
        
        elif tool_name == "create_draft_data_product":
            return await self._tool_create_draft_data_product(**args)
        
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
    
    async def _tool_search_data_products(
        self,
        query: str,
        domain: Optional[str] = None,
        status: Optional[str] = None
    ) -> Dict[str, Any]:
        """Search for data products."""
        try:
            # Query database directly using our session
            from src.db_models.data_products import DataProductDb
            
            products_db = self._db.query(DataProductDb).limit(500).all()
            
            if not products_db:
                return {"products": [], "total_found": 0, "message": "No data products found"}
            
            # Filter by query (name, description, domain)
            query_lower = query.lower() if query and query != '*' else ''
            filtered = []
            
            for p in products_db:
                # If query is empty or '*', include all products
                if not query_lower:
                    include = True
                else:
                    # Match on name
                    name_match = query_lower in (p.name or "").lower()
                    
                    # Match on description (stored as JSON)
                    desc_match = False
                    if p.description:
                        import json
                        try:
                            desc_dict = json.loads(p.description) if isinstance(p.description, str) else p.description
                            if isinstance(desc_dict, dict):
                                desc_text = desc_dict.get('purpose', '')
                                desc_match = query_lower in desc_text.lower()
                        except:
                            pass
                    
                    # Match on domain
                    domain_match = query_lower in (p.domain or "").lower()
                    
                    include = name_match or desc_match or domain_match
                
                if include:
                    # Apply filters
                    if domain and p.domain and p.domain.lower() != domain.lower():
                        continue
                    if status and p.status != status:
                        continue
                    
                    # Extract output tables from output_ports JSON
                    output_tables = []
                    if p.output_ports:
                        import json
                        try:
                            ports = json.loads(p.output_ports) if isinstance(p.output_ports, str) else p.output_ports
                            if isinstance(ports, list):
                                for port in ports:
                                    if isinstance(port, dict):
                                        output_tables.append(port.get('name', 'Unknown'))
                        except:
                            pass
                    
                    # Extract description purpose from JSON
                    desc_purpose = None
                    if p.description:
                        try:
                            desc_dict = json.loads(p.description) if isinstance(p.description, str) else p.description
                            if isinstance(desc_dict, dict):
                                desc_purpose = desc_dict.get('purpose')
                        except:
                            pass
                    
                    filtered.append({
                        "id": str(p.id),
                        "name": p.name,
                        "domain": p.domain,
                        "description": desc_purpose,
                        "status": p.status,
                        "output_tables": output_tables[:5],  # Limit for response size
                        "version": p.version
                    })
            
            return {
                "products": filtered[:20],  # Limit results
                "total_found": len(filtered)
            }
            
        except Exception as e:
            logger.error(f"Error searching data products: {e}")
            return {"error": str(e), "products": []}
    
    async def _tool_search_glossary_terms(
        self,
        term: str,
        domain: Optional[str] = None
    ) -> Dict[str, Any]:
        """Search for business terms/concepts in the knowledge graph."""
        logger.info(f"Searching glossary for term='{term}', semantic_models_manager={self._semantic_models_manager is not None}")
        if not self._semantic_models_manager:
            logger.warning("Glossary search failed: semantic_models_manager is None")
            return {"error": "Knowledge graph not available", "terms": []}
        
        try:
            # Search concepts in the semantic models / knowledge graph
            # Results are ConceptSearchResult with nested 'concept' (OntologyConcept)
            results = self._semantic_models_manager.search_ontology_concepts(term, limit=20)
            
            terms = []
            for result in results:
                # result.concept is OntologyConcept with: iri, label, comment, source_context, etc.
                concept = result.concept
                terms.append({
                    "iri": concept.iri,
                    "name": concept.label or concept.iri.split('#')[-1].split('/')[-1],
                    "definition": concept.comment,
                    "taxonomy": concept.source_context,
                    "relevance_score": result.relevance_score,
                    "match_type": result.match_type
                })
            
            return {
                "terms": terms[:15],
                "total_found": len(results),
                "source": "knowledge_graph"
            }
            
        except Exception as e:
            logger.error(f"Error searching knowledge graph: {e}")
            return {"error": str(e), "terms": []}
    
    async def _tool_get_data_product_costs(
        self,
        product_id: Optional[str] = None,
        aggregate: bool = False
    ) -> Dict[str, Any]:
        """Get cost information for data products."""
        try:
            from src.db_models.costs import CostItemDb
            
            query = self._db.query(CostItemDb).filter(CostItemDb.entity_type == "data_product")
            
            if product_id:
                query = query.filter(CostItemDb.entity_id == product_id)
            
            items = query.all()
            
            if not items:
                return {"message": "No cost data found", "total_usd": 0}
            
            if aggregate:
                # Sum all costs
                total_cents = sum(item.amount_cents for item in items)
                by_center: Dict[str, float] = {}
                for item in items:
                    center = item.cost_center or "OTHER"
                    by_center[center] = by_center.get(center, 0) + item.amount_cents / 100
                
                return {
                    "total_usd": total_cents / 100,
                    "by_cost_center": by_center,
                    "currency": "USD",
                    "product_count": len(set(item.entity_id for item in items))
                }
            else:
                # Group by product
                by_product: Dict[str, Dict[str, Any]] = {}
                for item in items:
                    pid = item.entity_id
                    if pid not in by_product:
                        # Get product name if available
                        product_name = pid
                        if self._data_products_manager:
                            try:
                                product = self._data_products_manager.get(pid)
                                if product:
                                    product_name = product.name or pid
                            except Exception:
                                pass
                        
                        by_product[pid] = {
                            "product_id": pid,
                            "product_name": product_name,
                            "total_usd": 0,
                            "items": []
                        }
                    
                    by_product[pid]["total_usd"] += item.amount_cents / 100
                    by_product[pid]["items"].append({
                        "title": item.title,
                        "cost_center": item.cost_center,
                        "amount_usd": item.amount_cents / 100,
                        "description": item.description
                    })
                
                return {
                    "products": list(by_product.values()),
                    "total_usd": sum(p["total_usd"] for p in by_product.values()),
                    "currency": "USD"
                }
                
        except Exception as e:
            logger.error(f"Error getting costs: {e}")
            return {"error": str(e)}
    
    async def _tool_get_table_schema(
        self,
        table_fqn: str,
        user_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get schema for a table."""
        if not self._ws_client:
            return {"error": "Workspace client not available"}
        
        try:
            # Validate table name
            self._sql_validator.sanitize_identifier(table_fqn)
            
            # Get table info from Unity Catalog
            table_info = self._ws_client.tables.get(full_name_arg=table_fqn)
            
            columns = []
            if table_info.columns:
                for col in table_info.columns:
                    columns.append({
                        "name": col.name,
                        "type": col.type_text,
                        "nullable": col.nullable,
                        "comment": col.comment
                    })
            
            return {
                "table_fqn": table_fqn,
                "columns": columns,
                "table_type": str(table_info.table_type) if table_info.table_type else None,
                "comment": table_info.comment
            }
            
        except Exception as e:
            logger.error(f"Error getting table schema for {table_fqn}: {e}")
            return {"error": str(e), "table_fqn": table_fqn}
    
    async def _tool_execute_analytics_query(
        self,
        sql: str,
        explanation: str,
        user_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """Execute an analytics query."""
        if not self._ws_client:
            return {"error": "Workspace client not available"}
        
        try:
            # Validate and prepare query
            is_valid, prepared_sql, error = validate_and_prepare_query(
                sql,
                allowed_tables=None,  # TODO: Check user permissions
                max_rows=1000
            )
            
            if not is_valid:
                return {"error": f"Query validation failed: {error}"}
            
            logger.info(f"Executing analytics query: {prepared_sql[:200]}...")
            
            # Execute query
            # Note: This uses statement execution API
            warehouse_id = self._settings.DATABRICKS_WAREHOUSE_ID
            
            result = self._ws_client.statement_execution.execute_statement(
                statement=prepared_sql,
                warehouse_id=warehouse_id,
                wait_timeout="30s"
            )
            
            # Check status
            if result.status and result.status.state:
                state = str(result.status.state)
                if "FAILED" in state or "CANCELED" in state:
                    error_msg = result.status.error.message if result.status.error else "Query failed"
                    return {"error": error_msg, "state": state}
            
            # Extract results
            columns = []
            if result.manifest and result.manifest.schema and result.manifest.schema.columns:
                columns = [col.name for col in result.manifest.schema.columns]
            
            rows = []
            if result.result and result.result.data_array:
                rows = result.result.data_array
            
            truncated = len(rows) >= 1000
            
            return {
                "columns": columns,
                "rows": rows[:100],  # Limit for response size
                "row_count": len(rows),
                "explanation": explanation,
                "truncated": truncated,
                "full_result_available": len(rows) > 100
            }
            
        except Exception as e:
            logger.error(f"Error executing analytics query: {e}")
            return {"error": str(e)}

    async def _tool_explore_catalog_schema(
        self,
        catalog: str,
        schema: str,
        include_columns: bool = True,
        user_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """Explore all tables and views in a Unity Catalog schema."""
        if not self._ws_client:
            return {"error": "Workspace client not available"}
        
        try:
            logger.info(f"Exploring schema: {catalog}.{schema}")
            
            # List tables in the schema
            tables_iterator = self._ws_client.tables.list(
                catalog_name=catalog,
                schema_name=schema
            )
            tables_list = list(tables_iterator)
            
            if not tables_list:
                return {
                    "catalog": catalog,
                    "schema": schema,
                    "table_count": 0,
                    "tables": [],
                    "message": f"No tables found in {catalog}.{schema}"
                }
            
            tables = []
            for table in tables_list:
                table_info = {
                    "name": table.name,
                    "full_name": table.full_name,
                    "table_type": str(table.table_type).replace("TableType.", "") if table.table_type else None,
                    "comment": table.comment,
                }
                
                # Get detailed column info if requested
                if include_columns:
                    try:
                        # Get full table details including columns
                        table_details = self._ws_client.tables.get(full_name_arg=table.full_name)
                        if table_details.columns:
                            table_info["columns"] = [
                                {
                                    "name": col.name,
                                    "type": col.type_text,
                                    "comment": col.comment,
                                    "nullable": col.nullable
                                }
                                for col in table_details.columns
                            ]
                            table_info["column_count"] = len(table_details.columns)
                    except Exception as col_err:
                        logger.warning(f"Could not get columns for {table.full_name}: {col_err}")
                        table_info["columns"] = []
                        table_info["column_error"] = str(col_err)
                
                tables.append(table_info)
            
            return {
                "catalog": catalog,
                "schema": schema,
                "table_count": len(tables),
                "tables": tables,
                "message": f"Found {len(tables)} tables/views in {catalog}.{schema}"
            }
            
        except Exception as e:
            logger.error(f"Error exploring schema {catalog}.{schema}: {e}")
            return {"error": str(e), "catalog": catalog, "schema": schema}

    async def _tool_create_draft_data_contract(
        self,
        name: str,
        description: str,
        domain: str,
        tables: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Create a draft data contract from schema information."""
        if not self._data_contracts_manager:
            return {"error": "Data contracts manager not available"}
        
        try:
            import uuid
            logger.info(f"Creating draft data contract: {name}")
            
            # Build schema objects from tables
            schema_objects = []
            if tables:
                for table in tables:
                    properties = []
                    for col in table.get("columns", []):
                        properties.append({
                            "property": col.get("name"),
                            "logicalType": col.get("type", "string"),
                            "physicalType": col.get("type", "STRING"),
                            "businessName": col.get("name"),
                            "description": col.get("description", "")
                        })
                    
                    schema_objects.append({
                        "name": table.get("name"),
                        "physicalName": table.get("full_name") or table.get("name"),
                        "description": table.get("description", ""),
                        "properties": properties
                    })
            
            # Build contract data in ODCS format
            contract_data = {
                "apiVersion": "v3.0.2",
                "kind": "DataContract",
                "name": name,
                "version": "0.1.0",
                "status": "draft",
                "domain": domain,
                "description": {
                    "purpose": description
                },
                "schema": schema_objects
            }
            
            # Create the contract
            created = self._data_contracts_manager.create_contract_with_relations(
                db=self._db,
                contract_data=contract_data,
                current_user=None  # Will use system default
            )
            
            return {
                "success": True,
                "contract_id": created.id,
                "name": created.name,
                "version": created.version,
                "status": created.status,
                "message": f"Draft contract '{name}' created successfully. Review and publish it in the Data Contracts UI.",
                "url": f"/data-contracts/{created.id}"
            }
            
        except Exception as e:
            logger.error(f"Error creating draft contract: {e}", exc_info=True)
            return {"error": str(e)}

    async def _tool_create_draft_data_product(
        self,
        name: str,
        description: str,
        domain: str,
        contract_id: Optional[str] = None,
        output_tables: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a draft data product."""
        if not self._data_products_manager:
            return {"error": "Data products manager not available"}
        
        try:
            import uuid
            logger.info(f"Creating draft data product: {name}")
            
            # Build output ports from tables
            output_ports = []
            if output_tables:
                for i, table_fqn in enumerate(output_tables):
                    output_ports.append({
                        "name": f"output_{i + 1}",
                        "server": table_fqn,
                        "description": f"Output table: {table_fqn}"
                    })
            
            # If contract_id provided, link it
            if contract_id and output_ports:
                output_ports[0]["dataContractId"] = contract_id
            
            # Build product data in ODPS format
            product_data = {
                "apiVersion": "v1.0.0",
                "kind": "DataProduct",
                "id": str(uuid.uuid4()),
                "name": name,
                "version": "0.1.0",
                "status": "draft",
                "domain": domain,
                "description": {
                    "purpose": description
                },
                "outputPorts": output_ports
            }
            
            # Create the product
            created = self._data_products_manager.create_product(
                product_data=product_data,
                db=self._db
            )
            
            return {
                "success": True,
                "product_id": created.id,
                "name": created.name,
                "version": created.version,
                "status": created.status,
                "message": f"Draft product '{name}' created successfully. Review and publish it in the Data Products UI.",
                "url": f"/data-products/{created.id}"
            }
            
        except Exception as e:
            logger.error(f"Error creating draft product: {e}", exc_info=True)
            return {"error": str(e)}

