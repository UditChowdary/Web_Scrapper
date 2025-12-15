import os
import json
from typing import List, Dict

CACHE_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data', 'repo_cache_raw.json')

def save_raw_repo_data(data: List[Dict], path=CACHE_FILE_PATH):
    """Writes the list of repository dictionaries to a local JSON file."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(CACHE_FILE_PATH, 'w', encoding='utf-8') as f:
            # Use indent for readability in the prototype stage
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"Successfully saved {len(data)} repositories to {CACHE_FILE_PATH}")
    except Exception as e:
        print(f"Error saving data: {e}")

