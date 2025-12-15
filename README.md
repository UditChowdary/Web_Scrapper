# Web-Scrapper

This tool is a component-based enterprise web application designed to scrape metadata from GitHub repositories (specifically targeting C/C++ projects), categorize them, and provide dependency visualization.

## ⚙️ Tech Stack & Architecture
The application uses a split Client/Server architecture built around two main components:

|   Component           | Technology                | Role |
|   -------------       | -------------             | ------------- |
|   Backend/API         | Python (3.10+) & FastAPI  | Handles data retrieval, dependency scraping, and transitive dependency counting. |
|   Data Persistence    | Browser Session Storage   | Caches API results for the current session to improve performance. |
|   Frontend/UI         | Angular & ngx-graph       | Provides the user interface, keyword search, results table, and dependency graph visualization. |

## ✨ Features
*   **GitHub Repository Search:** Search for C/C++ repositories on GitHub by keyword.
*   **Advanced, Multi-Level Sorting:** On the results page, apply multiple sort criteria to the repository list and drag-and-drop the sort indicators to change their priority. The top 200 results are sorted instantly in the browser.
*   **Repository Categorization:** Repositories are automatically categorized based on an analysis of their content, providing metrics like "Usability" and "Portability".
*   **Two-Stage Dependency Analysis:**
    *   **Quick Preview:** On the results page, click "Fetch" to quickly scan a repository for a summary of its direct dependencies without leaving the page.
    *   **In-Depth Visualization:** Click "View" to navigate to a dedicated graph page that displays the repository's direct dependency types (e.g., npm, pip, cmake).
*   **Transitive Dependency Counting:** The graph provides a summary of nested (3rd-level) dependencies. For each direct dependency shown, it displays a summarized count of its own children.
    *   If a dependency has just **one** child, its name is displayed.
    *   If it has over 100, **"100+ more"** is shown.
    *   Otherwise, the exact count is displayed as **"X more"**.
*   **Interactive Metadata Inspection:** Click on any main dependency node in the graph to open a dialog box with detailed metadata, including its license, origin, maintenance status, and more.


## 🚀 Setup & Installation Guide
This guide assumes you have Python 3.10+ and Node.js (LTS) installed on your system, as well as the Angular CLI.

### 1. Clone the Repository
```
git clone https://github.com/MadanKumar995/CSCI_6235_Web-Scrapper.git
cd CSCI_6235_Web-Scrapper
```
### 2. Backend Setup (Python)
Navigate to the backend directory, set up the virtual environment, and install all required Python libraries.
```
cd backend

# Create and activate Python virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows, use `.venv\Scripts\activate`

# Install dependencies from requirements.txt
pip install -r requirements.txt

# Create a .env file and add your GitHub Personal Access Token
echo "GITHUB_TOKEN=your_github_pat" > .env
```
### 3. Frontend Setup (Angular)
Navigate to the frontend directory and install the Node.js/JavaScript dependencies.
```
cd ../frontend

# Install Angular/Node dependencies
npm install
```
## ▶️ How to Run the Project
You must run the Backend API and the Frontend UI simultaneously in two separate terminal windows.

### Terminal 1: Start the Backend API
This runs the FastAPI server, which will handle the GitHub API requests. The API will run on http://127.0.0.1:8000.
```
# Navigate to backend and activate environment
cd backend
source .venv/bin/activate  # On Windows, use `.venv\Scripts\activate`

# Run the FastAPI server with auto-reload
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
### Terminal 2: Start the Frontend UI
This will start the Angular development server and open the application in your browser, typically on http://localhost:4200. The frontend is configured to proxy API requests to the backend.
```
# Navigate to frontend
cd frontend

# Start the Angular server with auto-reload
npm start
```

## Repo Categorization Logic

The repositories in the results table are automatically assigned values for several categories based on the following logic. For categories that result in a numerical score, the range is from 0 to 100.

### Open Source
A simple check for the presence of a software license.
- **Yes:** The repository has a license file.
- **No:** The repository does not have a license file.

### Plugability
Assesses how easily the repository can be integrated as a component into other software.
- **Score Calculation:**
    - A base score of 0.
    - **+16 points** for each of the following keywords found in the repository's description: `plugin`, `api`, `modular`, `extension`, `library`, `framework`.

### Usability
Measures how easy it is for a developer to start using the repository.
- **Score Calculation:**
    - A base score of 0.
    - **+10 points** for each of these keywords in the description: `documentation`, `tutorial`, `guide`, `easy`, `simple` (up to 50 points).
    - **+25 points** if the repository has an active Wiki.
    - **+25 points** for > 1000 stars, or **+15 points** for > 100 stars.

### Extensibility
Evaluates how easily the repository can be modified or extended.
- **Score Calculation:**
    - A base score of 0.
    - **+15 points** for each keyword in the description: `extend`, `customize`, `flexible`, `configurable` (up to 60 points).
    - **+40 points** for highly permissive licenses (MIT, Apache, BSD).
    - **+20 points** for partially permissive (weak copyleft) licenses (MPL, LGPL).

### Origin Pedigree
Identifies the type of entity that owns the repository.
- **Organization (name):** If owned by a GitHub Organization.
- **Individual (name):** If owned by a personal user account.

### Support
Gauges the level of available support based on project activity and community size.
- **Score Calculation:**
    - A base score of 0.
    - **Activity:** **+30 points** if updated within the last 90 days, or **+15 points** if updated within the last year.
    - **Backing:** **+20 points** if owned by an Organization.
    - **Community:** A total of up to 50 points from:
        - **+25 points** for > 1000 stars.
        - **+15 points** for > 100 forks.
        - **+10 points** if the "Issues" tab is enabled.

### Licensing
Simply displays the name of the repository's license.
- **Value:** The name of the license (e.g., "MIT License") or "N/A" if none is found.
