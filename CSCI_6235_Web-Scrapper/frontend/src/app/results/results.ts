import { Component, OnInit, OnDestroy, ViewChild, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatPaginator, MatPaginatorModule, PageEvent, MatPaginatorIntl } from '@angular/material/paginator';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ResultsStateService } from './results-state.service';
import { Subscription, forkJoin } from 'rxjs';

@Injectable()
export class CustomPaginatorIntl extends MatPaginatorIntl {
  override getRangeLabel = (page: number, pageSize: number, length: number) => {
    if (length === 0 || pageSize === 0) {
      return `0`;
    }
    const startIndex = page * pageSize;
    const endIndex = startIndex < length ? Math.min(startIndex + pageSize, length) : startIndex + pageSize;
    return `${startIndex + 1} – ${endIndex}`;
  };
}


@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, MatPaginatorModule, FormsModule, RouterModule, DragDropModule, MatProgressSpinnerModule],
  templateUrl: './results.html',
  styleUrls: ['./results.scss'],
  providers: [{ provide: MatPaginatorIntl, useClass: CustomPaginatorIntl }]
})
export class Results implements OnInit, OnDestroy {

  public repos: any[] = [];
  public categories: string[] = [];
  
  public keyword: string;
  public page: number;
  public perPage: number;
  public totalCount: number;
  public currentPerPageInput: number; // For two-way binding on the input field
  
  public allSortedRepos: any[] = []; // Stores all fetched repos for client-side sorting (max 200)
  public isClientSideSortActive: boolean = false; // Flag to indicate if client-side sorting is active
  
  public keywordError: string = '';
  public isGoButtonDisabled: boolean = true;
  public isLoading: boolean = false;
  public isFetchingDependencies: { [key: string]: boolean } = {};
  public sorts: { column: string, direction: 'asc' | 'desc' }[];
  public isLastPage: boolean = false;
  
  private routeSub: Subscription | undefined;

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    private router: Router,
    private http: HttpClient,
    public resultsState: ResultsStateService,
    private route: ActivatedRoute
  ) {
    this.keyword = this.resultsState.keyword;
    this.page = this.resultsState.page;
    this.perPage = this.resultsState.perPage;
    this.totalCount = this.resultsState.totalCount;
    this.sorts = this.resultsState.sorts;
    this.repos = this.resultsState.repos;
    this.currentPerPageInput = this.perPage; // Initialize for the input field
    this.allSortedRepos = this.resultsState.allSortedRepos;
    this.isClientSideSortActive = this.resultsState.isClientSideSortActive;
    this.isFetchingDependencies = this.resultsState.isFetchingDependencies;
  }

  ngOnInit(): void {
    this.routeSub = this.route.queryParams.subscribe(params => {
      const q = params['q'];
      if (q && q !== this.keyword) {
        this.keyword = q;
        this.resultsState.keyword = q;
        this.resultsState.page = 1;
        this.page = 1;
        this.fetchResults();
      } else if (this.repos.length === 0 && q) {
        this.keyword = q;
        this.resultsState.keyword = q;
        this.fetchResults();
      }
    });

    if (this.repos.length > 0) {
      this.categories = this.getUniqueCategories(this.repos);
      // Ensure initial repos are sorted if there's any data from state and sort applied
      if (this.sorts.length > 0) {
        if (this.isClientSideSortActive) {
          this._doSort(this.allSortedRepos);
          this.updateDisplayReposFromAllSorted();
        } else {
          this._doSort(this.repos);
        }
      }
    }
  }
  
  ngOnDestroy(): void {
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
  }

  // New method to update this.repos based on current page and allSortedRepos
  updateDisplayReposFromAllSorted() {
    const startIndex = (this.page - 1) * this.perPage;
    const endIndex = Math.min(startIndex + this.perPage, this.allSortedRepos.length);
    this.repos = this.allSortedRepos.slice(startIndex, endIndex);
    this.totalCount = this.allSortedRepos.length;
    this.isLastPage = this.page >= Math.ceil(this.totalCount / this.perPage);
  }

  fetchAndSortTopNRepos(limit: number = 200) {
    setTimeout(() => this.isLoading = true);
    this.allSortedRepos = []; // Clear previous data
    this.resultsState.repoCache.clear(); // Clear cache as we're getting a new dataset

    const requests = [];
    let fetchedCount = 0;
    let pageNum = 1;
    const perPageMax = 100; // GitHub API max per_page

    // Fetch up to 'limit' results, 100 at a time
    while (fetchedCount < limit) {
      requests.push(
        this.http.get(`/api/search?q=${this.resultsState.keyword.trim()}&page=${pageNum}&per_page=${perPageMax}`)
      );
      fetchedCount += perPageMax;
      pageNum++;
    }

    forkJoin(requests).subscribe({
      next: (responses: any[]) => {
        let aggregatedRepos: any[] = [];
        let actualTotalCount = 0;

        responses.forEach(res => {
          res.items.forEach((repo: any) => repo.relations = null);
          aggregatedRepos = aggregatedRepos.concat(res.items);
          if (res.total_count) {
            actualTotalCount = Math.max(actualTotalCount, res.total_count);
          }
        });

        // Cap to the requested limit
        this.allSortedRepos = aggregatedRepos.slice(0, limit);
        this.resultsState.allSortedRepos = this.allSortedRepos;
        
        // Update categories from the full dataset before sorting
        this.categories = this.getUniqueCategories(this.allSortedRepos);

        // Now sort the aggregated results
        this._doSort(this.allSortedRepos); // Sort the full list
        
        // Set flags and reset pagination to display the first page of sorted data
        this.isClientSideSortActive = true;
        this.resultsState.isClientSideSortActive = true;
        this.page = 1;
        this.resultsState.page = 1;

        this.updateDisplayReposFromAllSorted(); // Update repos for current page view
        this.isLoading = false;
      },
      error: (err: any) => {
        console.error('Error in fetchAndSortTopNRepos forkJoin:', err);
        this.isLoading = false;
        // Revert to normal state if fetching fails
        this.isClientSideSortActive = false;
        this.resultsState.isClientSideSortActive = false;
        this.fetchResults(); // Try fetching current page normally
      }
    });
  }

  fetchResults(): void {
    if (this.resultsState.keyword.trim() === '') return;

    setTimeout(() => this.isLoading = true);
    const pageToFetch = this.resultsState.page;
    const perPage = this.resultsState.perPage;
    const cacheKey = `${this.resultsState.keyword.trim()}-${pageToFetch}-${perPage}`;

    if (this.resultsState.repoCache.has(cacheKey)) {
      const cachedData = this.resultsState.repoCache.get(cacheKey)!;
      this.updateStateWithResults(cachedData, pageToFetch);
      setTimeout(() => this.isLoading = false);
      return;
    }

    this.http.get(`/api/search?q=${this.resultsState.keyword.trim()}&page=${pageToFetch}&per_page=${perPage}`)
      .subscribe({
        next: (results: any) => {
          this.isLoading = false;
          
          results.items.forEach((repo: any) => repo.relations = null);
          const dataToCache = { repos: results.items, totalCount: results.total_count };
          this.resultsState.repoCache.set(cacheKey, dataToCache);

          this.updateStateWithResults({repos: results.items, totalCount: results.total_count}, results.page);
        },
        error: (err: any) => {
          this.isLoading = false;
        }
      });
  }

  updateStateWithResults(data: { repos: any[], totalCount: number }, page: number) {
    this.resultsState.repos = data.repos;
    // GitHub API returns up to 1000 results for authenticated users.
    const effectiveTotalCount = Math.min(data.totalCount, 1000);
    this.resultsState.totalCount = effectiveTotalCount;
    this.resultsState.page = page;
    
    this.repos = this.resultsState.repos;
    this.totalCount = this.resultsState.totalCount;
    this.page = this.resultsState.page;
    this.isLastPage = this.page >= Math.ceil(this.totalCount / this.perPage);
    
    if (this.repos.length > 0) {
      this.categories = this.getUniqueCategories(this.repos);
    }
    this._doSort(this.repos);
  }
  
  getUniqueCategories(repos: any[]): string[] {
    const categorySet = new Set<string>();
    repos.forEach(repo => {
      if(repo.categories) {
        Object.keys(repo.categories).forEach(cat => categorySet.add(cat));
      }
    });
    return Array.from(categorySet);
  }

  onPageChange(event: PageEvent): void {
    this.resultsState.page = event.pageIndex + 1;
    this.page = this.resultsState.page; // Update local page property
    
    if (this.isClientSideSortActive) {
      this.updateDisplayReposFromAllSorted(); // Client-side pagination on allSortedRepos
    } else {
      this.fetchResults(); // Server-side pagination
    }
  }
  
  setPageSize(size: any): void {
    let newSize = parseInt(size, 10);
    if (isNaN(newSize) || newSize < 1) {
      newSize = 1;
    }
    if (newSize > 10) {
      newSize = 10;
    }

    // Always update the input to reflect the capped value
    this.currentPerPageInput = newSize; 

    if (newSize !== this.perPage) {
        this.resultsState.perPage = newSize;
        this.perPage = newSize;
        
        // Reset to page 1 when page size changes
        this.resultsState.page = 1;
        this.page = 1;
        if (this.paginator) {
          this.paginator.pageIndex = 0;
        }
        
        if (this.isClientSideSortActive) {
          this.updateDisplayReposFromAllSorted();
        } else {
          this.fetchResults();
        }
    }
  }

  search() {
    this.validateKeyword();
    if (!this.isGoButtonDisabled) {
      this.router.navigate([], { queryParams: { q: this.keyword.trim() } });
      this.resultsState.keyword = this.keyword;
      this.resultsState.page = 1;
      this.page = 1;
      
      // Reset client-side sorting state
      this.isClientSideSortActive = false;
      this.resultsState.isClientSideSortActive = false;
      this.allSortedRepos = [];
      this.resultsState.allSortedRepos = [];

      // Clear all sort criteria
      this.sorts = [];
      this.resultsState.sorts = [];

      // Clear dependency state on new search
      this.resultsState.clearDependencyCache();
      this.isFetchingDependencies = this.resultsState.isFetchingDependencies;

      this.resultsState.repoCache.clear(); // Clear cache for new search
      this.fetchResults();
    }
  }

  onKeywordChange() {
    this.resultsState.keyword = this.keyword;
    this.validateKeyword();
  }

  validateKeyword() {
    const wordCount = this.keyword.trim().split(/\s+/).filter(word => word !== '').length;
    if (wordCount > 6) {
      this.keywordError = 'Keyword cannot exceed 6 words.';
      this.isGoButtonDisabled = true;
    } else {
      this.keywordError = '';
      this.isGoButtonDisabled = this.keyword.trim() === '';
    }
  }
  
  // --- Sorting Logic ---
  applySort(column: string) {
    const existingSort = this.getSortForColumn(column);
    if (existingSort) {
      existingSort.direction = existingSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sorts.push({ column, direction: 'asc' });
    }
    this.resultsState.sorts = this.sorts;

    // Clear dependency state on sort
    this.resultsState.clearDependencyCache();
    this.isFetchingDependencies = this.resultsState.isFetchingDependencies;

    this.resultsState.page = 1; // Reset to page 1 on sort
    this.page = 1;

    if (this.isClientSideSortActive) {
      this._doSort(this.allSortedRepos);
      this.updateDisplayReposFromAllSorted();
    } else {
      // Trigger fetching all repos and then sort them
      this.fetchAndSortTopNRepos(200);
      this.resultsState.repoCache.clear(); // Clear cache for new sorted dataset
    }
  }

  removeSort(column: string) {
    this.sorts = this.sorts.filter(s => s.column !== column);
    this.resultsState.sorts = this.sorts;
    
    // Clear dependency state on sort change
    this.resultsState.clearDependencyCache();
    this.isFetchingDependencies = this.resultsState.isFetchingDependencies;

    this.resultsState.page = 1; // Reset to page 1 on sort change
    this.page = 1;

    if (this.sorts.length === 0) {
      // If no sorts are left, revert to server-side pagination
      this.isClientSideSortActive = false;
      this.resultsState.isClientSideSortActive = false;
      this.allSortedRepos = []; // Clear the full list
      this.resultsState.allSortedRepos = [];
      this.fetchResults();
    } else if (this.isClientSideSortActive) {
      this._doSort(this.allSortedRepos);
      this.updateDisplayReposFromAllSorted();
    }
  }

  getSortForColumn(column: string): { column: string, direction: 'asc' | 'desc' } | undefined {
    return this.sorts.find(s => s.column === column);
  }

  dropSort(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.sorts, event.previousIndex, event.currentIndex);
    this.resultsState.sorts = this.sorts;
    if (this.isClientSideSortActive) {
      this._doSort(this.allSortedRepos);
      this.updateDisplayReposFromAllSorted();
    } else {
      this._doSort(this.repos);
    }
  }

  private _doSort(arrayToSort: any[]) {
    if (this.sorts.length > 0 && arrayToSort.length > 0) {
      arrayToSort.sort((a, b) => {
        for (const sort of this.sorts) {
          let valA: any;
          let valB: any;
          if (this.categories.includes(sort.column)) {
            valA = a.categories[sort.column];
            valB = b.categories[sort.column];
          } else {
            valA = a[sort.column];
            valB = b[sort.column];
          }
          valA = valA ?? '';
          valB = valB ?? '';

          // Case-insensitive comparison for strings
          if (typeof valA === 'string' && typeof valB === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
          }

          const comparison = valA < valB ? -1 : valA > valB ? 1 : 0;
          if (comparison !== 0) {
            return sort.direction === 'asc' ? comparison : -comparison;
          }
        }
        return 0;
      });
    }
  }
  
  getRelationsForRepo(repo: any): any {
    const cachedData = this.resultsState.getDependency(repo.full_name);
    return cachedData?.relations;
  }

  fetchDependencies(repo: any): void {
    if (this.resultsState.getDependency(repo.full_name)) {
      return;
    }

    this.isFetchingDependencies[repo.full_name] = true;
    this.http.get(`/api/dependency-chain/${repo.full_name}`)
      .subscribe({
        next: (dependencies: any) => {
          this.resultsState.setDependency(repo.full_name, dependencies);
          this.isFetchingDependencies[repo.full_name] = false;
        },
        error: () => {
          this.resultsState.setDependency(repo.full_name, { relations: [] });
          this.isFetchingDependencies[repo.full_name] = false;
        }
      });
  }

  viewDependencies(repo: any): void {
    this.router.navigate(['/dependency', repo.full_name.split('/')[0], repo.full_name.split('/')[1]]);
  }
}

