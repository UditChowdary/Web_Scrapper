import { Routes } from '@angular/router';
import { Results} from './results/results';
import { Landing } from './landing/landing';
import { Dependency } from './dependency/dependency';


export const routes: Routes = [
    {path: '', component: Landing},
    {path: 'results', component: Results},
    {path: 'dependency/:owner/:repo', component: Dependency}
];
