from datetime import datetime

def categorize_repo(repo_data):
    """
    Categorizes a repository based on its metadata.
    """
    categories = {
        "open_source": is_open_source(repo_data),
        "plugability": assess_plugability(repo_data),
        "usability": assess_usability(repo_data),
        "extensibility": assess_extensibility(repo_data),
        "origin_pedigree": assess_origin(repo_data),
        "support": assess_support(repo_data),
        "licensing": get_license_type(repo_data),
    }
    
    # Add the categorization to the repo data
    repo_data["categories"] = categories
    return repo_data

def is_open_source(repo_data):
    """
    Determines if a repository is open-source based on the presence of a license.
    """
    return "Yes" if repo_data.get("license") else "No"

def assess_plugability(repo_data):
    """
    Assesses plugability based on keywords suggesting it's a library, framework, or has an API.
    Score: 0-100
    """
    score = 0
    description = repo_data.get("description", "").lower() if repo_data.get("description") else ""
    keywords = ["plugin", "api", "modular", "extension", "library", "framework"]
    for keyword in keywords:
        if keyword in description:
            score += 16
    return min(score, 100)

def assess_usability(repo_data):
    """
    Assesses usability based on documentation, ease-of-use keywords, and popularity.
    Score: 0-100
    """
    score = 0
    description = repo_data.get("description", "").lower() if repo_data.get("description") else ""
    keywords = ["documentation", "tutorial", "guide", "easy", "simple"]
    
    for keyword in keywords:
        if keyword in description:
            score += 10 # Max 50

    if repo_data.get("has_wiki"):
        score += 25

    stargazers = repo_data.get("stargazers_count", 0)
    if stargazers > 1000:
        score += 25
    elif stargazers > 100:
        score += 15
        
    return min(score, 100)

def assess_extensibility(repo_data):
    """
    Assesses extensibility based on keywords and the permissiveness of its license.
    Score: 0-100
    """
    score = 0
    description = repo_data.get("description", "").lower() if repo_data.get("description") else ""
    
    # Keyword score (max 60)
    keywords = ["extend", "customize", "flexible", "configurable"]
    for keyword in keywords:
        if keyword in description:
            score += 15

    # License score (max 40)
    license_info = repo_data.get("license", None)
    if license_info:
        license_key = license_info.lower()
        permissive_licenses = ["mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause"]
        weak_copyleft = ["mpl-2.0", "lgpl-2.1", "lgpl-3.0"]
        
        if any(p in license_key for p in permissive_licenses):
            score += 40
        elif any(w in license_key for w in weak_copyleft):
            score += 20

    return min(score, 100)

def assess_origin(repo_data):
    """
    Assesses the origin of a repository, combining owner type and name.
    """
    owner = repo_data.get("owner", {})
    owner_type = owner.get("type", "Unknown")
    owner_login = owner.get("login", "N/A")
    
    if owner_type == "Organization":
        return f"Organization ({owner_login})"
    elif owner_type == "User":
        return f"Individual ({owner_login})"
    else:
        return "N/A"

def assess_support(repo_data):
    """
    Assesses support based on activity, backing, and community size.
    Score: 0-100
    """
    score = 0
    
    # Activity score (max 30)
    updated_at_str = repo_data.get("updated_at")
    if updated_at_str:
        updated_at = datetime.fromisoformat(updated_at_str.replace("Z", ""))
        days_since_update = (datetime.now() - updated_at).days
        if days_since_update < 90:
            score += 30
        elif days_since_update < 365:
            score += 15

    # Backing score (max 20)
    if repo_data.get("owner", {}).get("type") == "Organization":
        score += 20
        
    # Community/Installed Base score (max 50)
    if repo_data.get("stargazers_count", 0) > 1000:
        score += 25
    if repo_data.get("forks_count", 0) > 100:
        score += 15
    if repo_data.get("has_issues"):
        score += 10
        
    return min(score, 100)

def get_license_type(repo_data):
    """
    Extracts the license type from the repository data.
    """
    return repo_data.get("license", "N/A")
