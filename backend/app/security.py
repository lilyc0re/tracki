import sqlglot
from sqlglot import exp

def validate_generated_sql(sql_query: str, allowed_tables: set) -> tuple[bool, str]:
    """
    Parses a generated SQL query and verifies it is safe to execute.
    
    Returns:
        (is_safe: bool, message: str)
    """
    try:
        # 1. Parsing the SQL query into an Abstract Syntax Tree (AST)
        expression = sqlglot.parse_one(sql_query, dialect="sqlite")
        
        # 2. Prevent Write Operations (Insert, Update, Delete, Drop, Alter, Create)
        unsafe_expression_types = (
            exp.Insert,
            exp.Delete,
            exp.Update,
            exp.Drop,
            exp.AlterTable,
            exp.AlterColumn,
            exp.Create,
            exp.Command,
            exp.TruncateTable
        )
        
        for unsafe_type in unsafe_expression_types:
            if expression.find(unsafe_type):
                return False, f"Security Violation: Modify database operations ({unsafe_type.__name__}) are blocked."

        # 3. Extracting and checking all tables referenced in query against allowed tables list
        tables_queried = set()
        for table_node in expression.find_all(exp.Table):
            tables_queried.add(table_node.name.lower())

        # 4. Blocking access if any table in query is a system metadata table
        system_metadata_tables = {"sqlite_master", "sqlite_sequence", "table_metadata"}
        if tables_queried.intersection(system_metadata_tables):
            return False, "Security Violation: Access to system metadata or registers is forbidden."

        # 5. Verifying all tables queried exist in allowed list
        if not tables_queried.issubset(allowed_tables):
            forbidden_tables = tables_queried - allowed_tables
            return False, f"Access Denied: You do not have permission to query these tables: {', '.join(forbidden_tables)}"

        # 6. Blocking dangerous built-in functions
        for func_node in expression.find_all(exp.Anonymous):
            func_name = func_node.name.lower()
            if func_name in {"load_extension", "load_file"}:
                return False, f"Security Violation: Forbidden function used in query: {func_name}"

        return True, "SQL query is valid and safe to execute."

    except sqlglot.errors.SqlglotError as e:  # Fixed lowercase 'g'
        return False, f"Syntax Error: Generated SQL query is not valid. Details: {str(e)}"
    except Exception as e:
        return False, f"Verification system Error: {str(e)}"

        