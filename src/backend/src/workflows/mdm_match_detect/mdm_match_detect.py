"""
MDM Match Detection Workflow

Compares source dataset against master using configurable matching rules.
Generates match candidates for steward review.

This workflow:
1. Loads MDM configuration from the app database
2. Reads master and source data from Unity Catalog tables
3. Applies matching rules (deterministic and probabilistic)
4. Generates match candidates with confidence scores
5. Saves candidates to the database for review
"""

import argparse
import json
import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from functools import reduce

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.types import FloatType
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


def get_db_session(host: str, db: str, port: str, schema: str, user: str = None, password: str = None):
    """Create database session"""
    # In production, credentials would come from secrets
    url = f"postgresql://{host}:{port}/{db}"
    if user and password:
        url = f"postgresql://{user}:{password}@{host}:{port}/{db}"
    
    engine = create_engine(url)
    Session = sessionmaker(bind=engine)
    return Session(), engine


def load_config(session, config_id: str) -> Optional[Dict[str, Any]]:
    """Load MDM configuration from database"""
    result = session.execute(
        text("SELECT * FROM mdm_configs WHERE id = :id"),
        {"id": config_id}
    ).fetchone()
    
    if result:
        return dict(result._mapping)
    return None


def load_source_links(session, config_id: str, source_link_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Load source links for configuration"""
    if source_link_id:
        result = session.execute(
            text("SELECT * FROM mdm_source_links WHERE config_id = :config_id AND id = :link_id AND status = 'active'"),
            {"config_id": config_id, "link_id": source_link_id}
        ).fetchall()
    else:
        result = session.execute(
            text("SELECT * FROM mdm_source_links WHERE config_id = :config_id AND status = 'active'"),
            {"config_id": config_id}
        ).fetchall()
    
    return [dict(r._mapping) for r in result]


def get_table_from_contract(session, contract_id: str) -> Optional[str]:
    """Get physical table name from contract schema"""
    result = session.execute(
        text("""
            SELECT physical_name FROM data_contract_schema_objects 
            WHERE contract_id = :id LIMIT 1
        """),
        {"id": contract_id}
    ).fetchone()
    
    return result[0] if result else None


def update_run_status(session, run_id: str, status: str, **kwargs):
    """Update match run status"""
    update_fields = ["status = :status"]
    params = {"id": run_id, "status": status}
    
    if "error_message" in kwargs:
        update_fields.append("error_message = :error_message")
        params["error_message"] = kwargs["error_message"]
    
    if "matches_found" in kwargs:
        update_fields.append("matches_found = :matches_found")
        params["matches_found"] = kwargs["matches_found"]
    
    if "new_records" in kwargs:
        update_fields.append("new_records = :new_records")
        params["new_records"] = kwargs["new_records"]
    
    if "total_source_records" in kwargs:
        update_fields.append("total_source_records = :total_source_records")
        params["total_source_records"] = kwargs["total_source_records"]
    
    if "total_master_records" in kwargs:
        update_fields.append("total_master_records = :total_master_records")
        params["total_master_records"] = kwargs["total_master_records"]
    
    if status in ("completed", "failed"):
        update_fields.append("completed_at = :completed_at")
        params["completed_at"] = datetime.utcnow()
    
    query = f"UPDATE mdm_match_runs SET {', '.join(update_fields)} WHERE id = :id"
    session.execute(text(query), params)
    session.commit()


def apply_deterministic_rule(
    df: DataFrame,
    master_fields: List[str],
    source_fields: List[str],
    weight: float
) -> DataFrame:
    """Apply deterministic (exact match) rule"""
    conditions = []
    for mf, sf in zip(master_fields, source_fields):
        conditions.append(F.col(f"master_{mf}") == F.col(f"source_{sf}"))
    
    if conditions:
        combined = reduce(lambda a, b: a & b, conditions)
        return df.withColumn("rule_score", F.when(combined, F.lit(weight)).otherwise(F.lit(0.0)))
    
    return df.withColumn("rule_score", F.lit(0.0))


def apply_fuzzy_rule(
    df: DataFrame,
    master_field: str,
    source_field: str,
    weight: float,
    algorithm: str = "jaro_winkler"
) -> DataFrame:
    """Apply fuzzy matching rule using string similarity"""
    # Register UDF for fuzzy matching
    from fuzzywuzzy import fuzz
    
    if algorithm == "jaro_winkler":
        @F.udf(FloatType())
        def fuzzy_score(a, b):
            if not a or not b:
                return 0.0
            return fuzz.ratio(str(a).lower(), str(b).lower()) / 100.0
    elif algorithm == "levenshtein":
        @F.udf(FloatType())
        def fuzzy_score(a, b):
            if not a or not b:
                return 0.0
            return fuzz.partial_ratio(str(a).lower(), str(b).lower()) / 100.0
    else:
        @F.udf(FloatType())
        def fuzzy_score(a, b):
            if not a or not b:
                return 0.0
            return fuzz.token_sort_ratio(str(a).lower(), str(b).lower()) / 100.0
    
    return df.withColumn(
        "rule_score",
        fuzzy_score(F.col(f"master_{master_field}"), F.col(f"source_{source_field}")) * F.lit(weight)
    )


def find_matches(
    spark: SparkSession,
    master_df: DataFrame,
    source_df: DataFrame,
    matching_rules: List[Dict],
    column_mapping: Dict[str, str],
    key_column: str
) -> Tuple[DataFrame, DataFrame]:
    """
    Find matching records between master and source datasets.
    Returns: (matches_df, new_records_df)
    """
    # Prefix columns to avoid conflicts
    for col in master_df.columns:
        master_df = master_df.withColumnRenamed(col, f"master_{col}")
    
    for col in source_df.columns:
        source_df = source_df.withColumnRenamed(col, f"source_{col}")
    
    # For prototype: use broadcast join for smaller datasets
    # In production: use blocking strategies
    master_count = master_df.count()
    source_count = source_df.count()
    
    # Limit for prototype
    if master_count > 10000:
        master_df = master_df.limit(10000)
    if source_count > 10000:
        source_df = source_df.limit(10000)
    
    # Cross join for comparison (blocking should be used in production)
    combined = master_df.crossJoin(F.broadcast(source_df))
    
    # Apply matching rules
    rule_scores = []
    rule_weights = []
    
    for i, rule in enumerate(matching_rules):
        rule_name = rule.get('name', f'rule_{i}')
        rule_type = rule.get('type', 'deterministic')
        fields = rule.get('fields', [])
        weight = rule.get('weight', 1.0)
        algorithm = rule.get('algorithm', 'jaro_winkler')
        
        # Map source fields using column mapping
        master_fields = fields
        source_fields = [column_mapping.get(f, f) for f in fields]
        
        score_col = f"score_{rule_name}"
        
        if rule_type == 'deterministic':
            conditions = []
            for mf, sf in zip(master_fields, source_fields):
                master_col = f"master_{mf}"
                source_col = f"source_{sf}"
                if master_col in combined.columns and source_col in combined.columns:
                    conditions.append(F.col(master_col) == F.col(source_col))
            
            if conditions:
                combined_cond = reduce(lambda a, b: a & b, conditions)
                combined = combined.withColumn(score_col, F.when(combined_cond, F.lit(weight)).otherwise(F.lit(0.0)))
            else:
                combined = combined.withColumn(score_col, F.lit(0.0))
        
        elif rule_type == 'probabilistic':
            # Apply fuzzy matching for first field pair
            if master_fields and source_fields:
                master_col = f"master_{master_fields[0]}"
                source_col = f"source_{source_fields[0]}"
                
                if master_col in combined.columns and source_col in combined.columns:
                    from fuzzywuzzy import fuzz
                    
                    @F.udf(FloatType())
                    def calc_fuzzy(a, b):
                        if not a or not b:
                            return 0.0
                        return fuzz.ratio(str(a).lower(), str(b).lower()) / 100.0
                    
                    combined = combined.withColumn(score_col, calc_fuzzy(F.col(master_col), F.col(source_col)) * F.lit(weight))
                else:
                    combined = combined.withColumn(score_col, F.lit(0.0))
            else:
                combined = combined.withColumn(score_col, F.lit(0.0))
        
        rule_scores.append(score_col)
        rule_weights.append(weight)
    
    # Calculate overall confidence score
    if rule_scores:
        total_weight = sum(rule_weights)
        score_sum = sum([F.col(s) for s in rule_scores])
        combined = combined.withColumn("confidence_score", score_sum / F.lit(total_weight))
    else:
        combined = combined.withColumn("confidence_score", F.lit(0.0))
    
    # Filter to potential matches (above minimum threshold)
    min_threshold = min((r.get('threshold', 0.7) for r in matching_rules), default=0.7)
    matches = combined.filter(F.col("confidence_score") >= min_threshold)
    
    # Identify matched fields
    @F.udf("array<string>")
    def get_matched_fields(*scores_and_names):
        matched = []
        n = len(scores_and_names) // 2
        for i in range(n):
            if scores_and_names[i] and scores_and_names[i] > 0:
                matched.append(scores_and_names[n + i])
        return matched
    
    if rule_scores:
        score_cols = [F.col(s) for s in rule_scores]
        name_lits = [F.lit(r.get('name', f'rule_{i}')) for i, r in enumerate(matching_rules)]
        matches = matches.withColumn("matched_fields", get_matched_fields(*score_cols, *name_lits))
    else:
        matches = matches.withColumn("matched_fields", F.array())
    
    # Find new records (source records that don't match any master record)
    source_key = f"source_{key_column}"
    matched_source_ids = matches.select(source_key).distinct()
    
    new_records = source_df.join(
        matched_source_ids,
        source_df[f"source_{key_column}"] == matched_source_ids[source_key],
        "left_anti"
    )
    
    return matches, new_records


def save_match_candidates(
    session,
    run_id: str,
    config_id: str,
    source_contract_id: str,
    matches: DataFrame,
    master_key: str,
    source_key: str
):
    """Save match candidates to database"""
    candidates = matches.collect()
    
    for row in candidates:
        row_dict = row.asDict()
        
        # Extract master and source data
        master_data = {k.replace("master_", ""): v for k, v in row_dict.items() if k.startswith("master_")}
        source_data = {k.replace("source_", ""): v for k, v in row_dict.items() if k.startswith("source_")}
        
        # Get record IDs
        master_id = master_data.get(master_key)
        source_id = source_data.get(source_key)
        
        # Determine match type based on confidence
        confidence = row_dict.get("confidence_score", 0)
        if confidence >= 0.95:
            match_type = "exact"
        elif confidence >= 0.85:
            match_type = "fuzzy"
        else:
            match_type = "probabilistic"
        
        # Get matched fields
        matched_fields = row_dict.get("matched_fields", [])
        
        session.execute(
            text("""
                INSERT INTO mdm_match_candidates 
                (id, run_id, master_record_id, source_record_id, source_contract_id,
                 confidence_score, match_type, matched_fields, master_record_data, 
                 source_record_data, status)
                VALUES (:id, :run_id, :master_id, :source_id, :source_contract_id,
                        :confidence, :match_type, :matched_fields, :master_data, 
                        :source_data, 'pending')
            """),
            {
                "id": str(uuid.uuid4()),
                "run_id": run_id,
                "master_id": str(master_id) if master_id else None,
                "source_id": str(source_id),
                "source_contract_id": source_contract_id,
                "confidence": confidence,
                "match_type": match_type,
                "matched_fields": json.dumps(matched_fields),
                "master_data": json.dumps(master_data, default=str),
                "source_data": json.dumps(source_data, default=str)
            }
        )
    
    session.commit()
    return len(candidates)


def save_new_record_candidates(
    session,
    run_id: str,
    source_contract_id: str,
    new_records: DataFrame,
    source_key: str
):
    """Save new record candidates (no master match) to database"""
    records = new_records.collect()
    
    for row in records:
        row_dict = row.asDict()
        source_data = {k.replace("source_", ""): v for k, v in row_dict.items()}
        source_id = source_data.get(source_key)
        
        session.execute(
            text("""
                INSERT INTO mdm_match_candidates 
                (id, run_id, master_record_id, source_record_id, source_contract_id,
                 confidence_score, match_type, matched_fields, master_record_data, 
                 source_record_data, status)
                VALUES (:id, :run_id, NULL, :source_id, :source_contract_id,
                        1.0, 'new', '[]', NULL, :source_data, 'pending')
            """),
            {
                "id": str(uuid.uuid4()),
                "run_id": run_id,
                "source_id": str(source_id),
                "source_contract_id": source_contract_id,
                "source_data": json.dumps(source_data, default=str)
            }
        )
    
    session.commit()
    return len(records)


def main():
    parser = argparse.ArgumentParser(description="MDM Match Detection Workflow")
    parser.add_argument("--run_id", required=True, help="Match run ID")
    parser.add_argument("--config_id", required=True, help="MDM configuration ID")
    parser.add_argument("--source_link_id", default="", help="Specific source link to process")
    parser.add_argument("--postgres_host", required=True, help="PostgreSQL host")
    parser.add_argument("--postgres_db", required=True, help="PostgreSQL database")
    parser.add_argument("--postgres_port", default="5432", help="PostgreSQL port")
    parser.add_argument("--postgres_schema", default="public", help="PostgreSQL schema")
    args = parser.parse_args()

    # Initialize Spark
    spark = SparkSession.builder \
        .appName(f"MDM Match Detection - {args.run_id}") \
        .getOrCreate()

    # Connect to app database
    session, engine = get_db_session(
        args.postgres_host,
        args.postgres_db,
        args.postgres_port,
        args.postgres_schema
    )

    try:
        # Load configuration
        config = load_config(session, args.config_id)
        if not config:
            raise ValueError(f"MDM config {args.config_id} not found")

        # Update run status to running
        update_run_status(session, args.run_id, "running")

        # Get master table from contract
        master_table = get_table_from_contract(session, config['master_contract_id'])
        if not master_table:
            raise ValueError(f"Master table not found for contract {config['master_contract_id']}")

        # Load master data
        master_df = spark.table(master_table)
        master_count = master_df.count()

        # Get matching rules from config
        matching_rules = config.get('matching_rules', [])
        if not matching_rules:
            # Default rules if none specified
            matching_rules = [
                {"name": "default_exact", "type": "deterministic", "fields": ["id"], "weight": 1.0, "threshold": 0.7}
            ]

        # Load source links
        source_link_id = args.source_link_id if args.source_link_id else None
        source_links = load_source_links(session, args.config_id, source_link_id)

        if not source_links:
            raise ValueError("No active source links found for this configuration")

        total_matches = 0
        total_new = 0
        total_source_records = 0

        # Process each source link
        for link in source_links:
            source_table = get_table_from_contract(session, link['source_contract_id'])
            if not source_table:
                print(f"Warning: Source table not found for contract {link['source_contract_id']}, skipping")
                continue

            # Load source data
            source_df = spark.table(source_table)
            source_count = source_df.count()
            total_source_records += source_count

            # Get column mapping and key column
            column_mapping = link.get('column_mapping', {})
            key_column = link.get('key_column', 'id')

            # Determine master key (assume same as source key or mapped)
            master_key = column_mapping.get(key_column, key_column)

            # Find matches
            matches, new_records = find_matches(
                spark=spark,
                master_df=master_df,
                source_df=source_df,
                matching_rules=matching_rules,
                column_mapping=column_mapping,
                key_column=key_column
            )

            # Save match candidates
            match_count = save_match_candidates(
                session=session,
                run_id=args.run_id,
                config_id=args.config_id,
                source_contract_id=link['source_contract_id'],
                matches=matches,
                master_key=master_key,
                source_key=key_column
            )
            total_matches += match_count

            # Save new record candidates
            new_count = save_new_record_candidates(
                session=session,
                run_id=args.run_id,
                source_contract_id=link['source_contract_id'],
                new_records=new_records,
                source_key=key_column
            )
            total_new += new_count

            print(f"Processed source {link['source_contract_id']}: {match_count} matches, {new_count} new records")

        # Update run with final results
        update_run_status(
            session,
            args.run_id,
            "completed",
            matches_found=total_matches,
            new_records=total_new,
            total_source_records=total_source_records,
            total_master_records=master_count
        )

        print(f"MDM matching completed successfully. Found {total_matches} matches and {total_new} new records.")

    except Exception as e:
        print(f"Error during MDM matching: {e}")
        update_run_status(session, args.run_id, "failed", error_message=str(e))
        raise

    finally:
        session.close()
        spark.stop()


if __name__ == "__main__":
    main()

