import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ResultsStateService } from '../results/results-state.service';

@Component({
  selector: 'app-landing',
  imports: [MatIconModule, FormsModule, CommonModule, MatProgressSpinnerModule],
  templateUrl: './landing.html',
  styleUrl: './landing.scss'
})
export class Landing {
  keyword: string = '';
  keywordError: string = '';
  isGoButtonDisabled: boolean = true;
  isLoading: boolean = false;

  constructor(
    private router: Router, 
    private http: HttpClient, 
    private resultsState: ResultsStateService
  ) {
    this.validateKeyword();
  }

  onKeywordChange() {
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

  search() {
    if (!this.isGoButtonDisabled) {
      this.isLoading = true;
      this.resultsState.reset();
      this.resultsState.keyword = this.keyword;
      this.router.navigate(['/results'], { queryParams: { q: this.keyword.trim() } });
    }
  }
}
