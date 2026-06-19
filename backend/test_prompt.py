import asyncio
import httpx
import sys
import os

OLLAMA_HOST = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5-coder:7b"

SCHEMA = """
CREATE TABLE ai_works (workid INTEGER, projectid TEXT, uwid FLOAT, railway TEXT, plan_head INTEGER, state TEXT, short_name_of_work TEXT);
CREATE TABLE ai_works_district (workid INTEGER, uwid INTEGER, district_code FLOAT, district_name TEXT);
"""

async def run_test(prompt_rules):
    system_prompt = (
        "You are an expert SQL assistant for a SQLite database.\n"
        "Your task is to translate natural language user queries into clean, correct, and executable SQLite queries.\n\n"
        f"DATABASE SCHEMA:\n{SCHEMA}\n"
        f"RULES:\n{prompt_rules}"
    )
    
    history = [
        {"user_query": "for j&k show me all the works", "sql_query": "SELECT * FROM ai_works WHERE state LIKE 'JAMMU AND KASHMIR'"}
    ]
    
    messages = [{"role": "system", "content": system_prompt}]
    for turn in history:
        messages.append({"role": "user", "content": turn["user_query"]})
        messages.append({"role": "assistant", "content": f"```sql\n{turn['sql_query']}\n```"})
        
    messages.append({
        "role": "user", 
        "content": "using these work ids show their respective district names"
    })
    
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.0, "num_predict": 128}
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload, timeout=20.0)
            return response.json()["message"]["content"]
        except Exception as e:
            return f"Error: {str(e)}"

async def main():
    # Attempt 1: Clear instruction with strict warning
    rules_1 = (
        "1. Output ONLY executable SQL inside a ```sql block.\n"
        "2. Do NOT write comments like '/* ... */' or placeholders in the SQL.\n"
        "3. When referring to results of a previous query (e.g. 'these work ids'), do NOT list out numbers or write placeholders. "
        "Instead, write a JOIN or subquery using the original filters from the previous query. "
        "For example, if the previous query filtered by state, join on the table and apply that state filter again in the new query."
    )
    
    print("Testing Ruleset 1...")
    res1 = await run_test(rules_1)
    print("Result 1:\n", res1)

if __name__ == "__main__":
    asyncio.run(main())
