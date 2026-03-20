import csv
from dotenv import load_dotenv

# LOAD .env BEFORE importing the client (important)
load_dotenv()

from ingestion.github_client import search_repos

def save_csv(rows, path="sample_api_ccpp.csv"):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "full_name","html_url","description","license",
            "language","stargazers_count","updated_at","archived"
        ])
        w.writeheader()
        w.writerows(rows)
    print(f"[done] wrote {len(rows)} rows to {path}")

if __name__ == "__main__":
    print("Loading .env and calling GitHub...")
    res = search_repos(
        keywords=["matrix", "linear algebra"],  # change if you want
        license_key="mit",
        per_page=10,
        max_pages=2
    )
    print("Query:", res["q"])
    print("Total items:", res["count"])
    print("Rate info:", res["_rate"])
    save_csv(res["items"])
