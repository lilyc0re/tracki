import asyncio
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.main import chat_query
from backend.app.db import SessionLocal

async def test():
    db = SessionLocal()
    
    # Turn 1
    t1_payload = {"message": "show me all the works for jammu and kashmir", "history": []}
    print("--- TURN 1 ---")
    try:
        t1_res = await chat_query(payload=t1_payload, db=db)
        print("SQL 1:", t1_res["sql_query"])
        print("Rows returned:", len(t1_res["rows"]))
        
        # Build history for Turn 2
        history = [
            {"user_query": t1_payload["message"], "sql_query": t1_res["sql_query"]}
        ]
        
        # Turn 2
        t2_payload = {
            "message": "using these work ids show their respective district names",
            "history": history
        }
        print("\n--- TURN 2 ---")
        t2_res = await chat_query(payload=t2_payload, db=db)
        print("SQL 2:", t2_res["sql_query"])
        print("Rows returned:", len(t2_res["rows"]))
        print("Summary:", t2_res["summary"])
        
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(test())
