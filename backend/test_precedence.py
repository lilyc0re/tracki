import asyncio
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.main import chat_query
from backend.app.db import SessionLocal

async def test():
    db = SessionLocal()
    payload = {
        "message": "show me only those works of CR where state is only Madhya Pradesh where year of sanction is 2024-2025 or 2023-2024 and constituency is only indore",
        "history": []
    }
    try:
        res = await chat_query(payload=payload, db=db)
        print("Generated SQL:\n", res["sql_query"])
        print("Rows returned:", len(res["rows"]))
        if res["rows"]:
            print("First 3 rows:", res["rows"][:3])
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(test())
