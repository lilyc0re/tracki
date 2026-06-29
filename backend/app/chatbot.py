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
        "12. COLUMN QUALIFICATION & ALIAS CONSISTENCY (CRITICAL): In any query involving JOINs, you must ALWAYS prefix every column in the SELECT, WHERE, GROUP BY, or ORDER BY clauses with its corresponding table name or alias (e.g. `T2.workid`, `T1.district_name`) to prevent SQLite 'ambiguous column name' errors. You MUST ensure that the table alias used in your JOIN clause (e.g. `JOIN ai_works_state AS T2`) is EXACTLY the same alias used to prefix that table's columns everywhere else in the query. Never mix up aliases (e.g., do NOT select `T2.state_name` if you joined the table as `T3`). Never use an unqualified `workid` or `uwid` in a JOIN query.\n"
        "13. FINANCIAL PROGRESS CALCULATION: The database does NOT have a direct 'financial progress' column. If the user asks for 'financial progress', you must calculate it as the percentage of expenditure to cost. Use the formula: `T1.current_cost > 0 AND (T1.expenditure_upto_date * 100.0 / T1.current_cost)`. For example, 'where financial progress is greater than 90%' becomes `T1.current_cost > 0 AND (T1.expenditure_upto_date * 100.0 / T1.current_cost) > 90` (assuming T1 is the alias for `ai_works`). You MUST also project this calculated expression in your SELECT statement as `(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress` (or in GROUP BY/aggregation queries, project it as an average: `AVG(T1.expenditure_upto_date * 100.0 / T1.current_cost) AS financial_progress`) so the user can verify the data in the output table. Do NOT map it to `percentage_phy_progress`, which represents physical progress.\n"
        "14. PHYSICAL PROGRESS COLUMN: The database table `ai_works` does NOT have a column named `physical_progress`. Instead, it uses `percentage_phy_progress` to represent physical progress. If the user asks for 'physical progress', you must use `T1.percentage_phy_progress` (assuming `T1` is `ai_works`). You must also project this column (or average it in GROUP BY queries: `AVG(T1.percentage_phy_progress) AS physical_progress`) in your SELECT statement so the user can verify the filter values.\n"
        "15. YEAR OF SANCTION FILTERS: The column `year_of_sanction` is a TEXT column in the format 'YYYY-YYYY' (e.g. '2025-2026'). If the user asks for 'last N years' (e.g. 'last 2 years', 'last 4 years'), you MUST NOT perform direct math subtraction on this text column (e.g. `year_of_sanction - 2`), because SQLite text-to-numeric comparisons are strictly typed and will fail. Instead, you must parse the starting year by casting the first 4 characters to an integer using `CAST(SUBSTR(T1.year_of_sanction, 1, 4) AS INTEGER)` and perform your math/comparisons on that casted expression. For 'last N years', compare it using `>= (SELECT MAX(CAST(SUBSTR(year_of_sanction, 1, 4) AS INTEGER)) - N FROM ai_works)` (where N is the number of years requested, e.g. `- 2` for last 2 years, `- 4` for last 4 years, assuming T1 is the alias for `ai_works`).\n"
        "16. STATE FILTERING: The table `ai_works` contains a column named `state` (e.g., `T1.state`). The table `ai_works_state` contains a column named `state_name` (e.g., `T3.state_name`). Because some works span multiple states, the `T1.state` column in `ai_works` can contain comma-separated values (e.g., 'ANDAMAN AND NICOBAR ISLANDS, KARNATAKA'). Therefore, if filtering by state on the main `ai_works` table, you MUST always use the `LIKE` operator with wildcard percentages on both sides (e.g. `T1.state LIKE '%ANDAMAN AND NICOBAR ISLANDS%'`). Alternatively, if you join `ai_works_state` as `T3`, you can perform a match on `T3.state_name LIKE 'ANDAMAN AND NICOBAR ISLANDS'`. Never prefix `state` or `state_name` with the constituency or district table alias (e.g., do NOT use `T2.state_name` if T2 is `ai_works_constituency`).\n"
        "17. TABLE JOINS (MANDATORY): All helper tables (`ai_works_state`, `ai_works_district`, `ai_works_constituency`, `ai_works_alloc`) MUST always be joined with the main table `ai_works` using the `workid` column (e.g., `ON T1.workid = T2.workid`). Do NOT join using `state_code`, `district_code`, or `constituency_code` (e.g. do NOT use `T1.state_code = T2.state_code`), because `ai_works` does not contain code columns. Every single join relation in this database links via `workid`.\n"
        "18. STATUS FLAG VALUES: The `statusflag` column in `ai_works` is a TEXT column with code values: 'N' (stands for new proposal/not sanctioned), 'A' (stands for archived/finished), and 'P' (stands for progress/ongoing). If the user asks for 'ongoing' or 'active' or 'in progress' works, you MUST filter using `T1.statusflag = 'P'` (assuming T1 is `ai_works`). If the user asks for 'completed' or 'finished' or 'archived' works, you MUST filter using `T1.statusflag = 'A'`. If the user asks for 'new' or 'proposed' or 'not sanctioned' works, you MUST filter using `T1.statusflag = 'N'`. Never use literal strings like 'Ongoing' or 'Completed' for the `statusflag` column as they do not exist in the database.\n"
        "19. OTHER CATEGORICAL COLUMNS AND MAPPINGS: The `physically_completed_100` column contains 'Y' (completed) or 'N' (ongoing). Zonal railway columns (e.g. `T1.railway`) contain 2-4 letter codes (e.g. 'CR', 'WR'). The `allocation` column is a TEXT column representing the source of funding (e.g. 'DF', 'Cap.', 'EBR') and NOT a numeric/percentage value. Plan head (e.g. `T1.plan_head`) is a numeric column storing plan head numbers like 16, 51, 53, 52, 64. Use these mappings exactly.\n"
        "20. KEYWORD TO COLUMN DICTIONARY MAPPING: Follow this strict mapping when translating user questions to SQL columns:\n"
        "    - 'ongoing' / 'active' / 'in progress' -> T1.statusflag = 'P'\n"
        "    - 'completed' / 'finished' / 'done' / 'archived' -> T1.statusflag = 'A'\n"
        "    - 'new' / 'proposed' / 'not sanctioned' -> T1.statusflag = 'N'\n"
        "    - 'physical progress' / 'completion percentage' -> T1.percentage_phy_progress\n"
        "    - 'financial progress' / 'expenditure ratio' -> (T1.expenditure_upto_date * 100.0 / T1.current_cost) (with current_cost > 0 check)\n"
        "    - 'spent' / 'expenditure' -> T1.expenditure_upto_date\n"
        "    - 'cost' / 'current cost' / 'estimated cost' -> T1.current_cost\n"
        "    - 'original cost' -> T1.original_cost\n"
        "    - 'throwforward' / 'future cost' / 'carried forward' -> T1.throwforward_next_fy\n"
        "    - 'funding source' / 'allocated fund' -> T1.allocation (e.g. 'DF')\n"
        "    - 'executing agency' / 'executed by' -> T1.executing_agency_rly\n"
        "    - 'MP Name' -> T1.name_of_mp\n"
        "    - 'Plan Head' -> T1.plan_head\n"
        "    - 'tender value' / 'awarded value' -> T1.tender_awarded_value\n"
        "    - 'land status' / 'land acquisition' -> T1.land_acquisition_status\n"
        "    - 'GAD plan' -> T1.gad_plan_status\n"
        "    - 'design status' / 'drawing status' -> T1.design_drawing_status\n"
        "21. ROBUST SYNONYM & TYPO HANDLING (PREVENT USER ERRORS): Users may ask questions using grammatical errors, informal phrasing, or various synonyms. Map them logically:\n"
        "    - Synonyms for 'ongoing' / 'active' / 'in progress' / 'unfinished' / 'not completed' / 'work going on' / 'running' -> T1.statusflag = 'P'\n"
        "    - Synonyms for 'completed' / 'finished' / 'done' / 'archived' / 'closed' / 'completed 100%' -> T1.statusflag = 'A'\n"
        "    - Synonyms for 'new proposal' / 'not sanctioned' / 'proposed' / 'future' / 'new' -> T1.statusflag = 'N'\n"
        "    - Verbs like 'show me', 'list', 'name', 'give me', 'find', 'retrieve', 'get', 'extract' -> Map to standard SELECT column selections.\n"
        "    - If the user misspells or variations in capitalization occur (e.g. 'ghaziabad', 'GHAZIABAD', 'Ghaziabad'), always use case-insensitive SQL matching (like LIKE with % wildcards or LOWER) to prevent query failures.\n"
        "22. NO DIRECT SUM/COUNT AGGREGATION FOR LISTS (CRITICAL): If the user asks for a total cost, sum of expenditure, total throwforward, or total future cost for a list of works (e.g. 'give me future cost of all works of ambala constituency'), do NOT use aggregate functions like `SUM(...)` or `COUNT(...)` directly in the SQL query. Instead, write a query that retrieves the INDIVIDUAL works (selecting `T1.workid`, `T1.short_name_of_work`, and the specific cost/throwforward/expenditure columns requested). The application frontend will automatically list the individual works and display the calculated sum at the bottom of the output table. Only use aggregate functions (like `SUM` or `COUNT`) if the user explicitly asks for 'total summary stats only' or a 'GROUP BY' breakdown.\n"
        "23. DISTINCT COLUMN NAMES FOR AUXILIARY TABLES (CRITICAL): Each auxiliary table has exactly one specific naming column: `ai_works_state` has `state_name`, `ai_works_district` has `district_name`, and `ai_works_constituency` has `constituency_name`. You must NEVER cross-reference or mix these up. For example, if you join `ai_works_district AS T2`, you MUST filter on `T2.district_name` (e.g., `T2.district_name LIKE '%Goa%'`). You must NEVER refer to `T2.state_name` on a table that is aliased to `ai_works_district` or `ai_works_constituency`! Double-check that every table alias is associated ONLY with its own columns in the SQL schema.\n"
        "24. GEOGRAPHIC TYPO CORRECTION (MANDATORY): If the user misspells a geographic name (e.g. 'bardhman' instead of 'Bardhaman', 'gorakpur' instead of 'Gorakhpur', 'andaman' instead of 'Andaman', 'goa' instead of 'Goa'), you MUST correct the spelling in the SQL query value to match the standard spelling in the database (e.g. change '%Paschim Bardhman%' to '%Paschim Bardhaman%'). Do NOT preserve user spelling typos in the SQL query."
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

    # 1. Calculate column sums for any numeric/cost fields to give the LLM exact figures
    totals = {}
    if total_rows > 0:
        first_row = data_rows[0]
        for key, val in first_row.items():
            key_lower = key.lower()
            is_numeric = any(k in key_lower for k in ['cost', 'expenditure', 'outlay', 'throwforward', 'balance']) or key_lower in ['total_future_cost', 'total_cost']
            if is_numeric:
                try:
                    sum_val = sum(float(row[key]) for row in data_rows if row.get(key) is not None)
                    totals[key] = sum_val
                except (ValueError, TypeError):
                    pass

    totals_str = "\n".join([f"Total sum of '{k}': {v:,.2f}" for k, v in totals.items()])

    # 2. OPTIMIZATION: Only take the first 5 rows as a sample for the LLM
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
        "2. Format dates in standard Indian DD-MM-YYYY format.\n"
        "3. IMPORTANT: You MUST use the pre-calculated sums provided under 'Exact Dataset Column Sums' when summarizing the totals of the entire dataset. Do NOT try to sum or estimate the totals using *only* the first 5 sample rows, as the sample only represents a small fraction of the total rows."
    )
    
    # 3. Craft a prompt that tells the LLM the total count, exact sums, and shows only the sample
    user_prompt = (
        f"User Question: {user_query}\n"
        f"SQL Executed: {sql_query}\n"
        f"Number of SQL Rows Returned: {total_rows}\n"
        f"Exact Dataset Column Sums (MUST use these values for total summaries):\n{totals_str}\n\n"
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