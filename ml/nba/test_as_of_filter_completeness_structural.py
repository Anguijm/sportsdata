"""
Phase 3 step 4 unit test: as_of filter completeness — structural.

Uses AST inspection to enumerate all SQL queries in features.py and asserts
that each query either:
  (a) reads from nba_game_box_stats with a `updated_at <= ?` filter, or
  (b) reads from nba_eligible_games (frozen-pre-as-of attestation per addendum v12), or
  (c) reads from game_results (outcome table; not a feature input, covered by game date filter)

Any new SQL query that reads feature-relevant tables without an as_of filter
will cause this test to fail, flagging potential reproducibility violations.

Plan: Plans/nba-learned-model.md addendum v12 §"Unit tests" #3b.
"""

import ast
import os
import sys
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FEATURES_PY = os.path.join(REPO_ROOT, "ml", "nba", "features.py")

# Tables that must have as_of filter or are explicitly attested
AS_OF_FILTERED_TABLES = {"nba_game_box_stats"}
ATTESTED_TABLES = {"nba_eligible_games", "game_results", "games"}


def extract_sql_strings(source: str) -> list[str]:
    """Extract all string literals from Python source that look like SQL SELECT statements."""
    tree = ast.parse(source)
    sql_strings = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            s = node.value.strip()
            if s.upper().startswith("SELECT"):
                sql_strings.append(s)
    return sql_strings


def tables_in_query(sql: str) -> set[str]:
    """Heuristically extract table names from a SQL FROM/JOIN clause."""
    # Match FROM or JOIN followed by a table name
    pattern = re.compile(r"(?:FROM|JOIN)\s+([a-zA-Z_]+)", re.IGNORECASE)
    return set(m.group(1) for m in pattern.finditer(sql))


def has_as_of_filter(sql: str) -> bool:
    """Check if the SQL query contains a valid temporal filter.

    Accepts:
    - updated_at <= ? (training path: as_of timestamp filter)
    - date < ?        (live inference path: target game date filter)
    Both are valid temporal boundaries that prevent future-data leakage.
    """
    return bool(
        re.search(r"updated_at\s*<=\s*\?", sql, re.IGNORECASE)
        or re.search(r"\bdate\s*<\s*\?", sql, re.IGNORECASE)
    )


def test_all_queries_have_as_of_or_attestation() -> None:
    with open(FEATURES_PY) as f:
        source = f.read()

    sql_strings = extract_sql_strings(source)
    print(f"Found {len(sql_strings)} SQL SELECT statements in features.py")

    errors = []
    for sql in sql_strings:
        tables = tables_in_query(sql)
        filtered = tables & AS_OF_FILTERED_TABLES
        attested = tables & ATTESTED_TABLES
        unclassified = tables - AS_OF_FILTERED_TABLES - ATTESTED_TABLES

        if unclassified:
            errors.append(
                f"Query reads unclassified table(s) {unclassified}: "
                f"{sql[:120].strip()}..."
            )
            continue

        if filtered and not has_as_of_filter(sql):
            errors.append(
                f"Query reads {filtered} but has no 'updated_at <= ?' filter: "
                f"{sql[:120].strip()}..."
            )

    if errors:
        print(f"FAIL — {len(errors)} query/table issue(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)

    print("PASS — all SQL queries in features.py are either as_of-filtered or attested")


if __name__ == "__main__":
    test_all_queries_have_as_of_or_attestation()
