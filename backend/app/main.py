import os
import shutil
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text

from .config import settings
from .db import engine, Base, get_db
from .models import TableMetadata
from .ingestion import ingest_excel_file
from .security import validate_generated_sql
from .chatbot import generate_sql, generate_summary

# 1. Lifespan event manager (Runs startup and shutdown actions)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure data directory exists
    os.makedirs("backend/data", exist_ok=True)
    # Automatically create tables in SQLite (including table_metadata) on startup
    Base.metadata.create_all(bind=engine)
    
    # Sync helper tables on startup to fix any missing data
    from .db import SessionLocal
    db = SessionLocal()
    try:
        from .ingestion import sync_helper_tables
        sync_helper_tables(db)
        db.commit()
    except Exception as e:
        print("Failed to sync helper tables on startup:", e)
    finally:
        db.close()
        
    yield

# Initialize FastAPI App
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)

# 2. Configure CORS Security Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"], # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"], # Allow all headers
)

# --- API ENDPOINTS ---

# 3. GET /api/tables (List schemas)
@app.get(f"{settings.API_PREFIX}/tables")
def list_tables(db: Session = Depends(get_db)):
    """
    Returns a list of all ingested tables and their column schemas.
    """
    metadata_list = db.query(TableMetadata).all()
    return [
        {
            "table_name": meta.table_name,
            "original_filename": meta.original_filename,
            "columns": meta.columns_json,
            "uploaded_at": meta.uploaded_at
        }
        for meta in metadata_list
    ]

# 4. POST /api/upload (Excel Ingestion)
@app.post(f"{settings.API_PREFIX}/upload")
async def upload_excel(
    file: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    """
    Endpoint to upload Excel sheets, parse them, and load them into SQL tables.
    """
    # Verify file extension
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Please upload an Excel file (.xlsx or .xls)."
        )
        
    # Temporary save path
    temp_file_path = f"backend/data/temp_{file.filename}"
    
    try:
        # Write uploaded stream to local temp file
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Ingest the Excel sheets
        result = ingest_excel_file(temp_file_path, file.filename, db)
        return {"message": "File processed successfully!", "data": result}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process file: {str(e)}"
        )
    finally:
        # Cleanup: Remove temporary file
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

# 5. POST /api/chat (The Core Chat Endpoint)
@app.post(f"{settings.API_PREFIX}/chat")
async def chat_query(
    payload: dict, 
    db: Session = Depends(get_db)
):
    """
    Chat endpoint that translates NL -> SQL -> Run -> Summarize.
    """
    user_message = payload.get("message")
    history = payload.get("history", []) 
    if not user_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message field is required."
        )

    # A. Retrieve all active schemas from Metadata register
    active_tables = db.query(TableMetadata).all()
    if not active_tables:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No database tables found. Please upload an Excel sheet first!"
        )

    # Format schema maps: {table_name: {column: type}}
    schema_map = {meta.table_name: meta.columns_json for meta in active_tables}
    allowed_table_names = set(schema_map.keys())

    # B. Translate Natural Language to SQL
    try:
        generated_sql = await generate_sql(user_message, schema_map, history)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI translation failed: {str(e)}"
        )

    # C. Validate SQL using our AST Security Guard
    is_safe, security_message = validate_generated_sql(generated_sql, allowed_table_names)
    if not is_safe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": security_message,
                "generated_sql": generated_sql
            }
        )

    # D. Execute Safe SQL Query
    try:
        # Run query using the engine connection
        result = db.execute(text(generated_sql))
        
        # Format database output into JSON-compatible lists
        raw_rows= result.fetchall()
        rows=[dict(row._mapping)for row in raw_rows]
        columns=list(rows[0].keys())if rows else []
    except Exception as e:
        # If execution fails, return a 400 with the SQL (helps with debugging)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"SQL Execution Error: {str(e)}",
                "generated_sql": generated_sql
            }
        )

    # E. Generate Natural Language Summary of Results
    summary = await generate_summary(user_message, generated_sql, rows)

    return {
        "user_query": user_message,
        "sql_query": generated_sql,
        "columns": columns,
        "rows": rows,
        "summary": summary
    }

# 6. GET /api/districts (List distinct districts)
@app.get(f"{settings.API_PREFIX}/districts")
def list_districts(state: str = None, db: Session = Depends(get_db)):
    """
    Returns a sorted list of all distinct districts from the database.
    Optionally filters by state.
    """
    try:
        if state and state.lower() != "all" and state.lower() != "all states":
            query = text(
                "SELECT DISTINCT T1.district_name "
                "FROM ai_works_district T1 "
                "JOIN ai_works_state T2 ON T1.workid = T2.workid "
                "WHERE LOWER(T2.state_name) LIKE :state AND T1.district_name IS NOT NULL AND T1.district_name != '' "
                "ORDER BY T1.district_name ASC"
            )
            result = db.execute(query, {"state": f"%{state.lower()}%"}).fetchall()
        else:
            query = text(
                "SELECT DISTINCT district_name FROM ai_works_district "
                "WHERE district_name IS NOT NULL AND district_name != '' "
                "ORDER BY district_name ASC"
            )
            result = db.execute(query).fetchall()
        return [row[0].title() for row in result]
    except Exception as e:
        return []

# 7. GET /api/states (List distinct states)
@app.get(f"{settings.API_PREFIX}/states")
def list_states(db: Session = Depends(get_db)):
    """
    Returns a sorted list of all distinct states from the database.
    """
    try:
        query = text(
            "SELECT DISTINCT state_name FROM ai_works_state "
            "WHERE state_name IS NOT NULL AND state_name != '' "
            "ORDER BY state_name ASC"
        )
        result = db.execute(query).fetchall()
        return [row[0].title() for row in result]
    except Exception as e:
        return []