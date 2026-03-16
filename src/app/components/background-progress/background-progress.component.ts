import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService, BackgroundTask } from '../../core/services/app-state.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-background-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './background-progress.component.html',
  styleUrls: ['./background-progress.component.css']
})
export class BackgroundProgressComponent implements OnInit {
  tasks$: Observable<BackgroundTask[]>;

  constructor(private appState: AppStateService) {
    this.tasks$ = this.appState.backgroundTasks$;
  }

  ngOnInit(): void {}

  trackByTaskId(index: number, task: BackgroundTask): string {
    return task.id;
  }

  removeTask(id: string) {
    this.appState.removeTask(id);
  }

  toggleExpand(task: BackgroundTask) {
    task.isExpanded = !task.isExpanded;
  }

  goToMailbox() {
    this.appState.setActiveTab('security');
  }
}
