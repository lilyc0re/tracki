import os 
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    #initialising project info
    PROJECT_NAME: str="TRACK"
    API_PREFIX: str="/api"
    #initialising database url and file paths 
    DATABASE_URL: str= "sqlite:///backend/app/company.db"
    #local llm settings (ollama)
    OLLAMA_HOST: str= "http://localhost:11434"
    OLLAMA_MODEL: str="qwen2.5-coder:7b"
    #CORS origins (cross-origin resource sharing)
    #crucial security setting that controls which frontends are allowed to call our API, allowing std react dev ports
    CORS_ORIGINS: list[str]=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    #telling pydantic to load variables from a .env file (if it exists)
    model_config=SettingsConfigDict(env_file=".env", case_sensitive=True)
    #instantiating a global settings object such that import across our codebase is easy and consistent

settings=Settings()