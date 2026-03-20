import os, time, re
from typing import Dict, List, Optional, Set
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import base64
import asyncio
from datetime import datetime
import json

GITHUB_API_REST = "https://api.github.com"
TOKEN = os.getenv("GITHUB_TOKEN")

BASE_HEADERS = {
    "User-Agent": "CoursePrototype-API-Feasibility/1.0",
}

def _auth_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = dict(BASE_HEADERS)
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    if extra:
        headers.update(extra)
    return headers

class RateLimited(Exception):
    """Custom exception raised when GitHub rate limits or blocks a request."""
    pass

def _rate_info(r: httpx.Response) -> Dict[str, str]:
    """Extracts rate limit headers from the response."""
    h = r.headers
    return {
        "limit": h.get("X-RateLimit-Limit", "?"),
        "remaining": h.get("X-RateLimit-Remaining", "?"),
        "reset": h.get("X-RateLimit-Reset", "?"),
        "resource": h.get("X-RateLimit-Resource", "?"),
    }

def _maybe_rate_limit(r: httpx.Response) -> None:
    """Checks for rate limit status codes and raises a custom exception if found."""
    if r.status_code in (403, 429):
        raise RateLimited(f"Rate limited/blocked: {r.status_code}")

def build_query(keywords: List[str], license_key: Optional[str]) -> str:
    parts = []
    if keywords:
        parts.append(" ".join(k.strip() for k in keywords if k.strip()))
    parts += ["language:C", "language:C++", "archived:false"]
    if license_key:
        parts.append(f"license:{license_key.lower()}")
    return " ".join(parts)


@retry(reraise=True,
       retry=retry_if_exception_type(RateLimited),
       wait=wait_exponential(multiplier=1, min=2, max=30),
       stop=stop_after_attempt(5))
async def _search_page(client: httpx.AsyncClient, q: str, per_page: int, page: int):
    r = await client.get(f"{GITHUB_API_REST}/search/repositories",
           headers=_auth_headers({"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}),
                   params={"q": q, "sort": "updated", "order": "desc",
                           "per_page": per_page, "page": page},
                   timeout=30)
    if r.status_code == 401:
        raise RuntimeError("Unauthorized. Check GITHUB_TOKEN in .env.")
    _maybe_rate_limit(r)
    r.raise_for_status()
    return r.json(), _rate_info(r)

@retry(reraise=True,
       retry=retry_if_exception_type(RateLimited),
       wait=wait_exponential(multiplier=1, min=2, max=30),
       stop=stop_after_attempt(5))
async def _get_file_content(client: httpx.AsyncClient, repo_full_name: str, file_path: str) -> Optional[str]:
    """Fetches the content of a file from a repository."""
    try:
        url = f"{GITHUB_API_REST}/repos/{repo_full_name}/contents/{file_path}"
        r = await client.get(url, headers=_auth_headers(), timeout=30)
        _maybe_rate_limit(r)
        r.raise_for_status()
        data = r.json()
        return base64.b64decode(data['content']).decode('utf-8')
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        raise

@retry(reraise=True,
       retry=retry_if_exception_type(RateLimited),
       wait=wait_exponential(multiplier=1, min=2, max=30),
       stop=stop_after_attempt(5))
async def get_repo_details(client: httpx.AsyncClient, repo_full_name: str) -> Optional[Dict]:
    """Fetches details for a single repository."""
    try:
        url = f"{GITHUB_API_REST}/repos/{repo_full_name}"
        r = await client.get(url, headers=_auth_headers(), timeout=30)
        _maybe_rate_limit(r)
        r.raise_for_status()
        data = r.json()

        # Basic maintenance and support indicators
        last_pushed = datetime.strptime(data.get("pushed_at", ""), "%Y-%m-%dT%H:%M:%SZ")
        days_since_push = (datetime.now() - last_pushed).days
        maintenance_status = "Actively Maintained" if days_since_push < 90 else "Likely Unmaintained"
        support_level = "Official" if data.get("owner", {}).get("type") == "Organization" else "Community"

        return {
            "full_name": data.get("full_name"),
            "license": (data.get("license") or {}).get("name"),
            "origin": data.get("html_url"),
            "maintenance": maintenance_status,
            "support": support_level,
            "stars": data.get("stargazers_count"),
            "forks": data.get("forks_count"),
            "open_issues": data.get("open_issues_count"),
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        raise

async def get_npm_package_metadata(client: httpx.AsyncClient, package_name: str) -> Optional[Dict]:
    """Fetches metadata for an npm package."""
    try:
        url = f"https://registry.npmjs.org/{package_name}/latest"
        r = await client.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        return {
            "full_name": data.get("name"),
            "version": data.get("version"),
            "description": data.get("description"),
            "license": data.get("license"),
            "homepage": data.get("homepage"),
        }
    except httpx.HTTPStatusError:
        return None

async def get_pip_package_metadata(client: httpx.AsyncClient, package_name: str) -> Optional[Dict]:
    """Fetches metadata for a pip package."""
    try:
        url = f"https://pypi.org/pypi/{package_name}/json"
        r = await client.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        info = data.get("info", {})
        return {
            "full_name": info.get("name"),
            "version": info.get("version"),
            "description": info.get("summary"),
            "license": info.get("license"),
            "homepage": info.get("home_page"),
        }
    except httpx.HTTPStatusError:
        return None

async def find_github_repo_for_package(client: httpx.AsyncClient, package_name: str) -> Optional[str]:
    """Heuristically finds a GitHub repository for a given package name."""
    try:
        # Search for the package name, sorting by stars
        search_result = await search_repos(keywords=[package_name], per_page=1)
        if search_result and search_result["items"]:
            # Assume the top result is the correct one
            return search_result["items"][0]["full_name"]
        return None
    except Exception:
        return None

async def _get_direct_dependencies(client: httpx.AsyncClient, repo_full_name: str) -> Dict[str, list]:
    """Scrapes a repository to find its direct dependencies. Does not fetch metadata."""
    dependencies = {"npm": [], "pip": [], "cmake": [], "conan": [], "vcpkg": [], "submodule": []}
    try:
        url = f"{GITHUB_API_REST}/repos/{repo_full_name}/git/trees/main?recursive=1"
        r = await client.get(url, headers=_auth_headers(), timeout=30)
        _maybe_rate_limit(r)
        r.raise_for_status()
        tree = r.json()["tree"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return dependencies
        raise

    for file_obj in tree:
        file_path = file_obj["path"]
        
        if file_path.endswith("package.json"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                try:
                    data = json.loads(content)
                    if "dependencies" in data:
                        dependencies["npm"].extend(data["dependencies"].keys())
                    if "devDependencies" in data:
                        dependencies["npm"].extend(data["devDependencies"].keys())
                except json.JSONDecodeError: pass

        elif file_path.endswith("requirements.txt"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                dependencies["pip"].extend([line.split("==")[0] for line in content.splitlines() if line and not line.startswith("#")])

        elif file_path.endswith("CMakeLists.txt"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                find_package_pattern = re.compile(r'find_package\s*\(\s*([a-zA-Z0-9_]+)')
                dependencies["cmake"].extend(find_package_pattern.findall(content))
        
        elif file_path.endswith("conanfile.txt"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                in_requires_section = False
                for line in content.splitlines():
                    if line.strip() == "[requires]":
                        in_requires_section = True
                    elif line.startswith("["):
                        in_requires_section = False
                    elif in_requires_section and line.strip():
                        dependencies["conan"].append(line.strip().split("/")[0])
        
        elif file_path.endswith("vcpkg.json"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                try:
                    data = json.loads(content)
                    if "dependencies" in data:
                        for dep in data["dependencies"]:
                            if isinstance(dep, str):
                                dependencies["vcpkg"].append(dep)
                            elif isinstance(dep, dict) and "name" in dep:
                                dependencies["vcpkg"].append(dep["name"])
                except json.JSONDecodeError: pass

        elif file_path.endswith(".gitmodules"):
            content = await _get_file_content(client, repo_full_name, file_path)
            if content:
                submodule_url_pattern = re.compile(r'url\s*=\s*https://github\.com/([a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)')
                dependencies["submodule"].extend(submodule_url_pattern.findall(content))
    return dependencies

async def _count_transitive_dependencies(client: httpx.AsyncClient, repo_full_name: str, visited: Set[str], depth: int) -> int:
    """Recursively counts the number of unique transitive dependencies. Does not fetch metadata."""
    MAX_DEPTH = 3 # Safeguard against excessive recursion
    if depth > MAX_DEPTH or repo_full_name in visited:
        return 0

    visited.add(repo_full_name)
    
    try:
        direct_deps_map = await _get_direct_dependencies(client, repo_full_name)
    except RateLimited:
        return 0 # Stop counting if we get rate limited

    count = 0
    tasks = []

    all_deps_in_this_level = [dep for deps in direct_deps_map.values() for dep in deps]
    count += len(all_deps_in_this_level)

    # For sub-dependencies, we can recurse on submodules or heuristically found repos
    for dep_type, deps in direct_deps_map.items():
        for dep_name in deps:
            if dep_type == "submodule":
                tasks.append(_count_transitive_dependencies(client, dep_name, visited, depth + 1))
            elif dep_type in ("npm", "pip", "cmake", "conan", "vcpkg"):
                # This part is heuristic and expensive
                async def find_and_count(name):
                    sub_repo_name = await find_github_repo_for_package(client, name)
                    if sub_repo_name:
                        return await _count_transitive_dependencies(client, sub_repo_name, visited, depth + 1)
                    return 0
                tasks.append(find_and_count(dep_name))

    if tasks:
        results = await asyncio.gather(*tasks)
        count += sum(results)
        
    return count

async def get_dependency_tree(repo_full_name: str) -> Dict:
    """Builds a summarized, hierarchical dependency tree for a repository, without fetching metadata."""
    try:
        async with httpx.AsyncClient() as client:
            dependencies = await _get_direct_dependencies(client, repo_full_name)
            
            relations = []
            MAX_NODES_TO_SHOW = 4

            for dep_type, deps in dependencies.items():
                if deps:
                    total_deps = len(deps)
                    deps_to_show = list(set(deps))[:MAX_NODES_TO_SHOW] # De-duplicate
                    
                    dep_nodes = [{"full_name": dep_name} for dep_name in deps_to_show]

                    relations.append({
                        "full_name": dep_type,
                        "total_count": total_deps,
                        "relations": dep_nodes
                    })

            return {"full_name": repo_full_name, "relations": relations}
    except RateLimited:
        return {
            "full_name": repo_full_name,
            "relations": [
                {"full_name": "Error: GitHub API rate limit exceeded.", "relations": []}
            ]
        }

async def get_dependency_tree_with_metadata(repo_full_name: str) -> Dict:
    """Builds a hierarchical dependency tree for a repository with detailed metadata and transitive dependency counts."""
    try:
        async with httpx.AsyncClient() as client:
            dependencies = await _get_direct_dependencies(client, repo_full_name)
            
            relations = []
            MAX_NODES_FOR_METADATA = 4

            for dep_type, deps in dependencies.items():
                if deps:
                    unique_deps = list(set(deps)) # De-duplicate for processing
                    total_deps = len(unique_deps)
                    
                    deps_to_process = unique_deps[:MAX_NODES_FOR_METADATA]
                    dep_nodes = []
                    
                    for dep_name in deps_to_process:
                        node = {"full_name": dep_name, "version": "latest"}
                        
                        metadata, found_repo_name = None, None
                        
                        if dep_type == "npm":
                            metadata = await get_npm_package_metadata(client, dep_name)
                        elif dep_type == "pip":
                            metadata = await get_pip_package_metadata(client, dep_name)
                        elif dep_type == "submodule":
                            found_repo_name = dep_name
                        else: # cmake, conan, vcpkg
                            found_repo_name = await find_github_repo_for_package(client, dep_name)

                        if found_repo_name:
                            try:
                                repo_details = await get_repo_details(client, found_repo_name)
                                if repo_details:
                                    if metadata: metadata.update(repo_details)
                                    else: metadata = repo_details
                            except Exception:
                                metadata = metadata or {"full_name": f"Error fetching {found_repo_name}"}

                        if metadata: node.update(metadata)
                        
                        transitive_repo_to_scan = found_repo_name if found_repo_name else (await find_github_repo_for_package(client, dep_name) if dep_type not in ["submodule"] else None)
                        if transitive_repo_to_scan:
                            try:
                                transitive_count = await _count_transitive_dependencies(client, transitive_repo_to_scan, visited={repo_full_name}, depth=1)
                                node["transitive_count"] = transitive_count
                                if transitive_count == 1:
                                    # If count is 1, find the name of that single dependency
                                    single_level_deps_map = await _get_direct_dependencies(client, transitive_repo_to_scan)
                                    single_level_deps = [dep for deps in single_level_deps_map.values() for dep in deps]
                                    if len(single_level_deps) == 1:
                                        node["single_transitive_dep_name"] = single_level_deps[0]
                            except RateLimited:
                                node["transitive_count"] = -1 # Indicate error
                        else:
                            node["transitive_count"] = 0

                        dep_nodes.append(node)

                    relations.append({
                        "full_name": dep_type,
                        "total_count": total_deps,
                        "relations": dep_nodes
                    })

            return {"full_name": repo_full_name, "relations": relations}
    except RateLimited:
        return {
            "full_name": repo_full_name,
            "relations": [
                {"full_name": "Error: GitHub API rate limit exceeded.", "relations": []}
            ]
        }

async def search_repos(keywords: List[str], license_key: Optional[str] = None,
                 per_page: int = 20, page: int = 1) -> Dict:
    q = build_query(keywords, license_key)
    items_out = []
    last_rate = {}
    data = {}
    
    async with httpx.AsyncClient() as client:
        try:
            data, rate = await _search_page(client, q, per_page, page)
            last_rate = rate
            for it in data.get("items", []):
                items_out.append({
                    "full_name": it["full_name"],
                    "html_url": it["html_url"],
                    "description": it.get("description"),
                    "language": it.get("language"),
                    "license": (it.get("license") or {}).get("name"),
                    "updated_at": it.get("updated_at"),
                    "has_issues": it.get("has_issues"),
                    "has_wiki": it.get("has_wiki"),
                    "owner": it.get("owner"),
                    "stargazers_count": it.get("stargazers_count"),
                    "forks_count": it.get("forks_count"),
                    "open_issues_count": it.get("open_issues_count"),
                })
        except RateLimited as e:
            print(f"Rate Limit Encountered on page {page}. Stopping retrieval now. {e}")

    return {"q": q, "count": len(items_out), "items": items_out, "_rate": last_rate, "total_count": data.get("total_count", 0)}
