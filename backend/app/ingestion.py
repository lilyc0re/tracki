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
    return {"filename": original_filename, "processed_sheets": sheets_processed}

