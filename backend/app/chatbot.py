import os
import re
import httpx
from .config import settings
# 1. Configuration
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
# Set this to True to run offline without Ollama
MOCK_LLM : bool= False

def format_schemas_for_prompt(allowed_schemas: dict) -> str:
    schema_text = ""
    for table_name, columns in allowed_schemas.items():
        column_definitions = [f"{col_name} {col_type}" for col_name, col_type in columns.items()]
        cols_str = ", ".join(column_definitions)
        schema_text += f"CREATE TABLE {table_name} ({cols_str});\n"
    return schema_text

def generate_mock_sql(user_query: str, allowed_schemas: dict) -> str:
    """
    Simulates LLM translation offline by generating basic SQL based on keywords.
    """
    user_query_lower = user_query.lower()
    
    # Get the first table name in the schema
    first_table = list(allowed_schemas.keys())[0]
    columns = allowed_schemas[first_table]
    
    # Try to find a numeric column for aggregations
    numeric_col = None
    for col, col_type in columns.items():
        if col_type in ("INTEGER", "FLOAT"):
            numeric_col = col
            break

    # Mock dynamic query building based on simple keywords
    if "total" in user_query_lower or "sum" in user_query_lower:
        if numeric_col:
            return f"SELECT SUM({numeric_col}) AS total_{numeric_col} FROM {first_table};"
    
    if "count" in user_query_lower or "how many" in user_query_lower:
        return f"SELECT COUNT(*) AS total_rows FROM {first_table};"

    # Default fallback: Select first 5 rows
    return f"SELECT * FROM {first_table} LIMIT 5;"

async def generate_sql(user_query: str, allowed_schemas: dict, history: list = []) -> str:
    """
    Sends query to Ollama, passing historical SQL context as a true multi-turn chat message array.
    """
    if MOCK_LLM:
        return generate_mock_sql(user_query, allowed_schemas)

    ddl_schemas = format_schemas_for_prompt(allowed_schemas)
    
    # 1. Start with the system instructions (schema and rules)
    system_prompt = (
        "You are an expert SQL assistant for a SQLite database.\n"
        "Your task is to translate natural language user queries into clean, correct, and executable SQLite queries.\n\n"
        "CRITICAL MANDATE:\n"
        "Your SELECT statement MUST ALWAYS project columns in the following exact order:\n"
        "1) The qualified `workid` column (e.g., `T1.workid` or `T2.workid` matching the main table `ai_works`).\n"
        "2) Every single column and calculated expression used in your WHERE clause filters, qualified with the correct table alias (e.g., if filtering by `T2.constituency_name`, you MUST select `T2.constituency_name`. If filtering by a calculated expression like 'financial progress', you MUST calculate and project it, e.g., `(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress`, so the user can verify the filter values in the output table. Note: In GROUP BY/aggregation queries, you MUST still project these filter columns/expressions for verification—use aggregate functions for calculated filters, e.g., `AVG(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress`, and include standard filter columns in the SELECT and GROUP BY clauses, e.g. `T1.state`).\n"
        "3) The columns specifically requested in the user query.\n"
        "4) Followed by the main table's wildcard (e.g. `T1.*` or `T2.*` depending on which alias represents the main table `ai_works` in your query) to load all other row details (e.g. short name of work, district name, mp name, etc.) for reference.\n"
        "Note: You must match each column's alias prefix EXACTLY to the table that contains it in the schema DDL. Do not swap prefixes. IMPORTANT: You must use the wildcard asterisk `T1.*` instead of listing out all 60+ individual columns in the SELECT clause, as listing them out individually will truncate the query and cause syntax errors.\n"
        "Example:\n"
        "User query: 'show outlay for works in CR in MP for year 2023-2024'\n"
        "If `ai_works` is `T1` and `ai_works_state` is `T2`:\n"
        "Correct SQL SELECT: 'SELECT T1.workid, T1.railway, T2.state_name, T1.year_of_sanction, T1.outlay_modified_for_curr_fy, T1.* FROM ...'\n"
        "If you do not include both the qualified `workid` and all filter columns in the SELECT clause, the interface will fail. Never omit them.\n\n"
        f"{ddl_schemas}\n"
        "RULES:\n"
        "1. You must ONLY output the executable SQLite query. Do not explain the SQL, do not write anything else.\n"
        "2. Ensure the query is strictly read-only.\n"
        "3. Only query tables and columns defined in the schema above.\n"
        "4. Wrap your query in a single ```sql block.\n"
        "5. You must use the EXACT table names provided in the schema (e.g. use 'ai_works_state', NOT 'state'; use 'ai_works_district', NOT 'district').\n"
        "6. SQLite string comparisons are CASE-SENSITIVE by default when using the = operator. Because text values can be stored in Title Case or mixed case (e.g. 'Rajkot', 'Indore'), you MUST always perform case-insensitive comparisons: either use the LIKE operator (e.g., `T2.constituency_name LIKE 'rajkot'`) or wrap text columns in LOWER() (e.g., `LOWER(T2.constituency_name) = 'rajkot'`). Never use `=` directly on text columns without LOWER() qualification.\n"
        "7. When a user asks about districts, constituencies, or states, always select their descriptive NAME columns (e.g., `district_name`, `constituency_name`, `state_name`) rather than just their numerical codes (e.g., `district_code`), so that the results are readable by the user and the summarizer.\n"
        "8. When a user asks a follow-up question referencing 'these works', 'these IDs', or 'the above results', do NOT write SQL comment placeholders, do NOT list out raw numbers, and do NOT invent temporary tables (like 'previous_results' or 'last_query'). Instead, write a dynamic query by joining the tables or using a subquery that re-applies the filtering criteria from the previous turn.\n"
        "   Example: If Turn 1 is `SELECT * FROM ai_works WHERE state LIKE 'JAMMU AND KASHMIR'`, and Turn 2 is 'show their district names', generate: `SELECT T1.district_name FROM ai_works_district AS T1 JOIN ai_works AS T2 ON T1.workid = T2.workid WHERE T2.state LIKE 'JAMMU AND KASHMIR'`.\n"
        "9. PARENTHESIS GROUPING (CRITICAL): When combining AND and OR operators in a WHERE clause, you must ALWAYS wrap the OR conditions in parentheses to enforce the correct order of evaluation (e.g., `WHERE railway = 'CR' AND (year_of_sanction = '2023-2024' OR year_of_sanction = '2024-2025') AND state = 'MADHYA PRADESH'`). Failure to do this causes incorrect data subsets to be returned.\n"
        "10. STRICT EXCLUSION: Pay close attention to short abbreviations (e.g. 'CR' = Central Railway, 'WR' = Western Railway). If a user specifies 'only' or 'strictly' a certain value (e.g., 'only CR', 'only Indore', 'only Madhya Pradesh'), ensure that your logic strictly isolates that value and excludes the rest (e.g., ensuring `railway = 'CR'` is strictly evaluated alongside the rest of the filters).\n"
        "11. COLUMN SELECTION REQUIREMENT (MANDATORY): You must ALWAYS include both the `workid` column (e.g., `T1.workid`) AND whatever column you are filtering by in the WHERE clause (e.g., if filtering by `T2.district_name = 'INDORE'`, you MUST select `T2.district_name` AND `T1.workid` in addition to any financial/other columns) in your SELECT statement. Do not omit the filter columns from the SELECT clause under any circumstances. (Note: For aggregation queries using GROUP BY or COUNT, you should only select the grouping column and aggregates, and you do not need to select workid or T1.*, otherwise SQLite will throw a GROUP BY error.)\n"
        "12. COLUMN QUALIFICATION (CRITICAL): In any query involving JOINs, you must ALWAYS prefix every column in the SELECT, WHERE, GROUP BY, or ORDER BY clauses with its corresponding table name or alias (e.g. `T2.workid`, `T1.district_name`) to prevent SQLite 'ambiguous column name' errors. Never use an unqualified `workid` or `uwid` in a JOIN query.\n"
        "13. FINANCIAL PROGRESS CALCULATION: The database does NOT have a direct 'financial progress' column. If the user asks for 'financial progress', you must calculate it as the percentage of expenditure to cost. Use the formula: `T1.current_cost > 0 AND (T1.expenditure_upto_date * 100.0 / T1.current_cost)`. For example, 'where financial progress is greater than 90%' becomes `T1.current_cost > 0 AND (T1.expenditure_upto_date * 100.0 / T1.current_cost) > 90` (assuming T1 is the alias for `ai_works`). You MUST also project this calculated expression in your SELECT statement as `(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress` (or in GROUP BY/aggregation queries, project it as an average: `AVG(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress`) so the user can verify the data in the output table. Do NOT map it to `percentage_phy_progress`, which represents physical progress.\n"
        "14. PHYSICAL PROGRESS COLUMN: The database table `ai_works` does NOT have a column named `physical_progress`. Instead, it uses `percentage_phy_progress` to represent physical progress. If the user asks for 'physical progress', you must use `T1.percentage_phy_progress` (assuming `T1` is `ai_works`). You must also project this column (or average it in GROUP BY queries: `AVG(T1.percentage_phy_progress) AS physical_progress`) in your SELECT statement so the user can verify the filter values."
    )
    
    # Initialize the messages list with the system instructions
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    
    # 2. Append history as true alternating User/Assistant turns
    if history:
        for turn in history:
            messages.append({
                "role": "user", 
                "content": turn.get("user_query")
            })
            messages.append({
                "role": "assistant", 
                "content": f"```sql\n{turn.get('sql_query')}\n```"
            })
            
    # 3. Append the current user query
    messages.append({
        "role": "user", 
        "content": f"User Question: {user_query}\nGenerate the SQLite query:"
    })
    
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,  # Pass the structured messages array
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_predict": 1024
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload, timeout=60.0)
            response.raise_for_status()
            result = response.json()
            raw_content = result["message"]["content"]
            
            # Try matching with closing backticks
            sql_match = re.search(r"```sql\s*(.*?)\s*```", raw_content, re.DOTALL | re.IGNORECASE)
            if sql_match:
                return sql_match.group(1).strip()
            
            # Try matching without closing backticks in case of truncation
            sql_match_open = re.search(r"```sql\s*(.*)", raw_content, re.DOTALL | re.IGNORECASE)
            if sql_match_open:
                return sql_match_open.group(1).replace("```", "").strip()
                
            # Clean up backup
            cleaned = raw_content.replace("`", "").strip()
            if cleaned.lower().startswith("sql\n"):
                cleaned = cleaned[4:].strip()
            elif cleaned.lower().startswith("sql "):
                cleaned = cleaned[4:].strip()
            return cleaned
            
    except (httpx.HTTPError, httpx.ConnectError):
        print(" Ollama offline. Falling back to Mock SQL generator.")
        return generate_mock_sql(user_query, allowed_schemas)

async def generate_summary(user_query: str, sql_query: str, data_rows: list) -> str:
    """
    Generates a natural language summary by only sending a data sample 
    and metadata count to save tokens and speed up local inference.
    """
    total_rows = len(data_rows)
    
    # If the database returned no rows
    if total_rows == 0:
        return "No matching data records were found in the database for your query."

    # 1. OPTIMIZATION: Only take the first 5 rows as a sample for the LLM
    data_sample = data_rows[:5]
    
    if MOCK_LLM:
        return (
            f"[Offline Mock Summary] The query successfully returned {total_rows} rows from the database. "
            f"Here is a mock summary of the results: The requested data was fetched from your uploaded Excel sheet."
        )

    system_prompt = (
        "You are a helpful intelligence assistant for an Indian railways.\n"
        "Your job is to read a user's question, the SQL query executed, and a sample of the results, "
        "and provide a concise, friendly, 2-3 sentence business summary of the findings.\n"
        "Be direct and professional. Let the user know the total number of records found.\n"
        "IMPORTANT RULES:\n"
        "1. All numeric financial values in the database represent Indian Rupees (INR, ₹). Do NOT use dollars ($). Format currency with ₹ (e.g. ₹50,000 or 5 Lakhs).\n"
        "2. Format dates in standard Indian DD-MM-YYYY format."
    )
    
    # 2. Craft a prompt that tells the LLM the total count and shows only the sample
    user_prompt = (
        f"User Question: {user_query}\n"
        f"SQL Executed: {sql_query}\n"
        f"Number of SQL Rows Returned: {total_rows} (Note: This is the number of rows/districts/groups in the query output, not the sum of values. Look at the values in the sample rows to describe the count/sum correctly.)\n"
        f"Sample of First 5 Rows:\n{str(data_sample)}\n\n"
        "Provide a railways summary:"
    )
    
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 150 # Limit output length to save tokens
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload, timeout=30.0)
            response.raise_for_status()
            result = response.json()
            return result["message"]["content"].strip()
    except (httpx.HTTPError, httpx.ConnectError):
        return (
            f" Ollama timeout/offline. Generated query: `{sql_query}`. "
            f"Database successfully returned {total_rows} rows."
        )