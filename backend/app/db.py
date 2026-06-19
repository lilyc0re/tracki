import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

#defining DB file path, will be currently saved in backend/data/company.db
#later, can be scaled by swapping this with a postgreSQL url (postgresql://user:pass@host/db)

DATABASE_URL= os.getenv("DATABASE_URL", "sqlite:///backend/data/company.db")

#creating engine and session
#engine is actualy pipeline that talks to db file
#whereas session is a workspace for our queries
#sqlite is file based and runs in memory, so we need to set check_same_thread to False to allow multiple threads to access the same db file using FastAPI's async capabilities

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else: 
    engine=create_engine(DATABASE_URL)

#Creating a session factory called as 'SessionLocal' that will generate new sessions whenever we need to interact with DB
SessionLocal= sessionmaker(autocommit=False, autoflush=False, bind=engine)

#Creating a Base Class, all rest classes will inherit from this.
Base= declarative_base()

#Database dependency (FastAPI) yielding a db session as per web request, making sure it is closed after work is done in it
#important to prevent DB connection leaks and resource mgmt
def get_db():
    db= SessionLocal()
    try:
        yield db
    finally:
        db.close()