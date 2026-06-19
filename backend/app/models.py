from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON
from .db import Base

class TableMetadata(Base):
    """Metatdata Registry Table.
    Every time an Excel file is uploaded and converted into a SQL table,
    we record its schema here so the AI Chatbot can discover it.
    """
    __tablename__="table_metadata"
    id = Column(Integer, primary_key=True, index=True)
# this records the clean anme of created SQL table (ex: costs_record)
    table_name =Column(String, unique=True, nullable=False, index=True)
#this will have the original name of excel file uploaded (ex costs_record.xlsx)
    original_filename=Column(String, nullable=False)
#mapping of rows to data types, ex{object_id":"INTEGER"} etc
    columns_json=Column(JSON, nullable=False)
#timstamp of table creation to maintain transparency
    uploaded_at=Column(DateTime, default=datetime.utcnow)
