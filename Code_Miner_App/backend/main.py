import os
import sys
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables (PAT) from .env
load_dotenv()

from api.core.github_client import search_repos, get_dependency_tree, get_dependency_tree_with_metadata, get_repo_details
from api.core.database.data_manager import save_raw_repo_data
from api.core.categorization import categorize_repo
import httpx

app = FastAPI()
router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@router.get("/search")
async def search(q: str, page: int = 1, per_page: int = 10):
    keywords = q.split()
    if len(keywords) > 6:
        raise HTTPException(status_code=400, detail="Cannot exceed 6 words.")

    try:
        results = await search_repos(
            keywords=keywords,
            per_page=per_page,
            page=page
        )

        fetched_items = results["items"]
        categorized_items = [categorize_repo(item) for item in fetched_items]
        
        return {
            "items": categorized_items,
            "total_count": results["total_count"],
            "page": page,
            "per_page": per_page
        }
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

async def check_repo_language(repo_full_name: str):
    async with httpx.AsyncClient() as client:
        details = await get_repo_details(client, repo_full_name)
        if not details:
            raise HTTPException(status_code=404, detail="Repository not found.")
        
        language = details.get("language", "").lower()
        if language not in ("c", "c++"):
            raise HTTPException(status_code=400, detail=f"Repository language '{details.get('language')}' is not C or C++.")

@router.get("/dependency-chain/{owner}/{repo}")
async def dependency_chain(owner: str, repo: str):
    try:
        repo_full_name = f"{owner}/{repo}"
        # await check_repo_language(repo_full_name) # Temporarily disabled for testing
        chain = await get_dependency_tree(repo_full_name)
        return chain
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")

@router.get("/dependency-metadata/{owner}/{repo}")
async def dependency_metadata(owner: str, repo: str):
    try:
        repo_full_name = f"{owner}/{repo}"
        # await check_repo_language(repo_full_name) # Temporarily disabled for testing
        try:
            # Large repositories can take a long time for metadata/transitive analysis.
            return await asyncio.wait_for(get_dependency_tree_with_metadata(repo_full_name), timeout=15)
        except asyncio.TimeoutError:
            # Fallback to basic dependency view so UI does not hang forever.
            try:
                basic_chain = await asyncio.wait_for(get_dependency_tree(repo_full_name), timeout=8)
                basic_chain["note"] = "Metadata timed out; showing basic dependency graph."
                return basic_chain
            except asyncio.TimeoutError:
                return {
                    "full_name": repo_full_name,
                    "relations": [],
                    "note": "Dependency request timed out. Try a smaller repository or retry later."
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")

app.include_router(router)