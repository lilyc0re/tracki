import re
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text
from .db import engine
from .models import TableMetadata

def clean_name(name: str) -> str:
    """
    Converts any sheet or column into a SQL-safe name.ex:"sales Q3 (2026)"-> "sales_q3_2026"
    """
    #lowercase name
    name=name.strip().lower()
    #replaceing spaces, dashes and slashes with underscores
    name = re.sub(r"[\s\-\/]+", "_", name)
    #removing any characters that arent letters, numbers, or underscores
    name = re.sub(r"[^a-z0-9_]", "", name)
    #ensuring name doesnt start with a number
    if name and name[0].isdigit():
        name = f"_{name}"
    return name

def map_pandas_type_to_sql(dtype) -> str:
    """
    Maps pandas data types to clean SQL data types for LLM readability. ex: "object"-> "TEXT", "int64"-> "INTEGER"
    """
    dtype_str = str(dtype).lower()
    if "int" in dtype_str:
        return "INTEGER"
    elif "float" in dtype_str or "double" in dtype_str:
        return "FLOAT"
    elif "datetime" in dtype_str or "date" in dtype_str:
        return "TIMESTAMP"
    else:
        return "TEXT"

def ingest_excel_file(file_path: str, original_filename: str, db:Session)-> dict:
    """
    Reads all sheets from excel, convert them to sqlite tables, and updates tabeMetadata registry with clean table names, original filename and column data types.
    """
    excel_file=pd.ExcelFile(file_path)
    sheets_processed=[]

    for sheet_name in excel_file.sheet_names:
        #reading each sheet into a pandas dataframe
        df=pd.read_excel(file_path, sheet_name=sheet_name)
        #skipping empty sheets
        if df.empty:
            continue
        #Generating clean, unique sql table name
        safe_table_name=clean_name(sheet_name)
        #cleaning column names
        df.columns=[clean_name(col) for col in df.columns]
        #mapping column types
        schema_dict={}
        for col in df.columns:
            pandas_type=str(df[col].dtype)
            sql_type=map_pandas_type_to_sql(pandas_type)
            schema_dict[col]=sql_type
            #writing data to sqlite(creates table automaticalyy) also replacing old file with new file
            df.to_sql(safe_table_name, con=engine,if_exists='replace',index=False)
            #recording metadata, first we check if this entry is already there or not.
            metadata_entry = db.query(TableMetadata).filter_by(table_name=safe_table_name).first()
        
        if metadata_entry:
            metadata_entry.original_filename = original_filename
            metadata_entry.columns_json = schema_dict
            metadata_entry.uploaded_at = pd.Timestamp.now()
        else:
            new_metadata = TableMetadata(
                table_name=safe_table_name,
                original_filename=original_filename,
                columns_json=schema_dict
            )
            db.add(new_metadata)
            sheets_processed.append({
            "sheet_name": sheet_name,
            "table_name": safe_table_name,
            "columns": schema_dict
        })
        
    db.commit()
    
    # Sync helper tables automatically after any sheet ingestion
    try:
        sync_helper_tables(db)
        db.commit()
    except Exception as e:
        print("Failed to auto-sync helper tables after ingestion:", e)
        
    return {"filename": original_filename, "processed_sheets": sheets_processed}


def sync_helper_tables(db: Session):
    """
    Synchronizes helper tables (ai_works_state, ai_works_district, ai_works_constituency)
    with the main table (ai_works) by parsing comma-separated entries for missing workids.
    """
    connection = db.connection()
    
    # 1. Sync ai_works_state
    try:
        missing_states = connection.execute(text("""
            SELECT workid, uwid, state 
            FROM ai_works 
            WHERE state IS NOT NULL AND state != '' 
              AND workid NOT IN (SELECT DISTINCT workid FROM ai_works_state)
        """)).fetchall()
        
        state_inserts = []
        for workid, uwid, state_str in missing_states:
            for st in state_str.split(','):
                st = st.strip().upper()
                if st:
                    state_inserts.append({"workid": workid, "uwid": uwid, "state_code": None, "state_name": st})
        if state_inserts:
            connection.execute(text("""
                INSERT INTO ai_works_state (workid, uwid, state_code, state_name) 
                VALUES (:workid, :uwid, :state_code, :state_name)
            """), state_inserts)
    except Exception as e:
        print("Skipping state sync or table doesn't exist:", e)

    # 2. Sync ai_works_district
    try:
        missing_districts = connection.execute(text("""
            SELECT workid, uwid, district 
            FROM ai_works 
            WHERE district IS NOT NULL AND district != '' 
              AND workid NOT IN (SELECT DISTINCT workid FROM ai_works_district)
        """)).fetchall()
        
        district_inserts = []
        for workid, uwid, dist_str in missing_districts:
            for ds in dist_str.split(','):
                ds = ds.strip().upper()
                if ds:
                    district_inserts.append({"workid": workid, "uwid": uwid, "district_code": None, "district_name": ds})
        if district_inserts:
            connection.execute(text("""
                INSERT INTO ai_works_district (workid, uwid, district_code, district_name) 
                VALUES (:workid, :uwid, :district_code, :district_name)
            """), district_inserts)
    except Exception as e:
        print("Skipping district sync or table doesn't exist:", e)

    # 3. Sync ai_works_constituency
    try:
        missing_constituencies = connection.execute(text("""
            SELECT workid, uwid, constituency_of_mp 
            FROM ai_works 
            WHERE constituency_of_mp IS NOT NULL AND constituency_of_mp != '' 
              AND workid NOT IN (SELECT DISTINCT workid FROM ai_works_constituency)
        """)).fetchall()
        
        const_inserts = []
        for workid, uwid, const_str in missing_constituencies:
            for cs in const_str.split(','):
                cs = cs.strip()
                if cs:
                    const_inserts.append({"workid": workid, "uwid": uwid, "constituency_code": None, "constituency_name": cs})
        if const_inserts:
            connection.execute(text("""
                INSERT INTO ai_works_constituency (workid, uwid, constituency_code, constituency_name) 
                VALUES (:workid, :uwid, :constituency_code, :constituency_name)
            """), const_inserts)
    except Exception as e:
        print("Skipping constituency sync or table doesn't exist:", e)

