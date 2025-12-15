import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { NgxGraphModule, Node, Edge } from '@swimlane/ngx-graph';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DependencyMetadata } from '../dependency-metadata/dependency-metadata';

@Component({
  selector: 'app-dependency',
  imports: [CommonModule, NgxChartsModule, NgxGraphModule, MatProgressSpinnerModule, MatIconModule, MatDialogModule],
  templateUrl: './dependency.html',
  styleUrls: ['./dependency.scss']
})
export class Dependency implements OnInit {
  repoFullName: string = '';
  dependencies: any;
  nodes: Node[] = [];
  links: Edge[] = [];
  isLoading: boolean = true;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private http: HttpClient,
    public dialog: MatDialog
  ) {}

  ngOnInit() {
    this.repoFullName = this.route.snapshot.paramMap.get('owner') + '/' + this.route.snapshot.paramMap.get('repo');
    this.fetchMetadata();
  }

  fetchMetadata() {
    this.isLoading = true;
    const cacheKey = `dependencyMetadata_${this.repoFullName}`;
    const cachedData = sessionStorage.getItem(cacheKey);

    if (cachedData) {
      const data = JSON.parse(cachedData);
      this.dependencies = data.relations;
      if (this.dependencies && this.dependencies.length > 0) {
        this.buildGraph();
      }
      this.isLoading = false;
      return;
    }

    this.http.get(`/api/dependency-metadata/${this.repoFullName}`)
      .subscribe({
        next: (data: any) => {
          sessionStorage.setItem(cacheKey, JSON.stringify(data));
          this.dependencies = data.relations;
          if (this.dependencies && this.dependencies.length > 0) {
            this.buildGraph();
          }
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
          // You might want to show an error message to the user
        }
      });
  }

  goBack(): void {
    this.location.back();
  }

  onNodeClick(node: Node): void {
    if (node.data && Object.keys(node.data).length > 0 && !node.id.endsWith('-summary') && !node.data['count-node']) {
      this.dialog.open(DependencyMetadata, {
        data: node.data,
        width: '500px'
      });
    }
  }

  buildGraph() {
    const nodes: Node[] = [];
    const links: Edge[] = [];
    const processedNodes = new Set<string>();
    const MAX_NODES_BEFORE_SUMMARY = 3;

    const addNode = (id: string, label: string, data: any = {}) => {
      if (!processedNodes.has(id)) {
        nodes.push({ id, label, data });
        processedNodes.add(id);
      }
    };

    const addLink = (source: string, target: string) => {
      links.push({ source, target, label: '' });
    };

    const processDepNode = (parent_id: string, dep: any) => {
        if (!dep.full_name) return;

        addNode(dep.full_name, dep.full_name, dep);
        addLink(parent_id, dep.full_name);

        // Check for transitive count and add a node for it
        if (dep.transitive_count > 0) {
            const countNodeId = `${dep.full_name}-transitive-count`;
            let countLabel = '';

            if (dep.transitive_count === 1 && dep.single_transitive_dep_name) {
                countLabel = dep.single_transitive_dep_name;
            } else if (dep.transitive_count > 100) {
                countLabel = "100+ more";
            } else {
                countLabel = `${dep.transitive_count} more`;
            }
            
            // If the label is another dependency name, make it a regular node, otherwise a count node
            const isCountNode = dep.transitive_count !== 1 || !dep.single_transitive_dep_name;
            addNode(countNodeId, countLabel, { 'count-node': isCountNode });
            addLink(dep.full_name, countNodeId);

        } else if (dep.transitive_count === -1) { // Handle error case from backend
            const errorNodeId = `${dep.full_name}-transitive-error`;
            const errorLabel = '?';
            addNode(errorNodeId, errorLabel, { 'count-node': true, 'tooltip': 'Could not count dependencies' });
            addLink(dep.full_name, errorNodeId);
        }
    };

    addNode(this.repoFullName, this.repoFullName, { full_name: this.repoFullName });

    if (Array.isArray(this.dependencies)) {
        this.dependencies.forEach((depType: any) => {
            const depTypeName = depType.full_name;
            addNode(depTypeName, depTypeName);
            addLink(this.repoFullName, depTypeName);

            if (Array.isArray(depType.relations)) {
                const totalRelations = depType.total_count;
                
                if (totalRelations <= MAX_NODES_BEFORE_SUMMARY + 1) {
                    depType.relations.forEach((dep: any) => {
                        processDepNode(depTypeName, dep);
                    });
                } else {
                    for (let i = 0; i < MAX_NODES_BEFORE_SUMMARY; i++) {
                        const dep = depType.relations[i];
                        processDepNode(depTypeName, dep);
                    }
                    const remaining_count = totalRelations - MAX_NODES_BEFORE_SUMMARY;
                    const summary_label = remaining_count > 100 ? "100+ more" : `${remaining_count} more`;
                    const summaryNodeId = `${depTypeName}-summary`;
                    addNode(summaryNodeId, summary_label, {}); // No data for summary node
                    addLink(depTypeName, summaryNodeId);
                }
            }
        });
    }

    this.nodes = nodes;
    this.links = links;
  }
}

