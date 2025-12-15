import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ResultsStateService {
  // Pagination
  page: number = 1;
  perPage: number = 5;
  totalCount: number = 0;
  // Sorting
  sorts: { column: string, direction: 'asc' | 'desc' }[] = [];
  // Data
  repos: any[] = [];
  originalRepos: any[] = [];
  keyword: string = '';
  // Cache
  repoCache = new Map<string, { repos: any[], totalCount: number }>();
  dependencyCache = new Map<string, any>();
  // For client-side sorting of top N results
  allSortedRepos: any[] = [];
  isClientSideSortActive: boolean = false;
  isFetchingDependencies: { [key: string]: boolean } = {};
  
  private readonly SESSION_STORAGE_PREFIX = 'dependencyChain_';

  constructor() {
    this.loadDependenciesFromSession();
  }

  private loadDependenciesFromSession(): void {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(this.SESSION_STORAGE_PREFIX)) {
        const repoFullName = key.substring(this.SESSION_STORAGE_PREFIX.length);
        const data = JSON.parse(sessionStorage.getItem(key)!);
        this.dependencyCache.set(repoFullName, data);
      }
    }
  }

  getDependency(repoFullName: string): any {
    return this.dependencyCache.get(repoFullName);
  }

  setDependency(repoFullName: string, data: any): void {
    this.dependencyCache.set(repoFullName, data);
    sessionStorage.setItem(`${this.SESSION_STORAGE_PREFIX}${repoFullName}`, JSON.stringify(data));
  }

  clearDependencyCache(): void {
    this.dependencyCache.clear();
    this.isFetchingDependencies = {};
    // Clear only our app's session storage keys
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(this.SESSION_STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  }

  reset() {
    // Pagination
    this.page = 1;
    this.perPage = 5;
    this.totalCount = 0;
    // Sorting
    this.sorts = [];
    // Data
    this.repos = [];
    this.originalRepos = [];
    this.keyword = '';
    // Cache
    this.repoCache.clear();
    this.clearDependencyCache();
    // For client-side sorting of top N results
    this.allSortedRepos = [];
    this.isClientSideSortActive = false;
  }
}


