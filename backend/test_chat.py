import asyncio
import sys
import os

# Adjust sys.path so we can import backend packages
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.main import chat_query
from backend.app.db import SessionLocal

async def test():
    db = SessionLocal()
    payload = {"message": "show all columns from the uploaded AI_WORKS_ALLOC_export table"}
    try:
        res = await chat_query(payload=payload, db=db)
        print("Success:", res)
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(test())
