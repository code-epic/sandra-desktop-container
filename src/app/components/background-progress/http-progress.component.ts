import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService, BackgroundTask } from '../../core/services/app-state.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-http-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './http-progress.component.html',
  styleUrls: ['./http-progress.component.css']
})
export class HttpProgressComponent implements OnInit {
  tasks$: Observable<BackgroundTask[]>;

  constructor(private appState: AppStateService) {
    this.tasks$ = this.appState.httpTasks$;
  }

  ngOnInit(): void {}

  trackByTaskId(index: number, task: BackgroundTask): string {
    return task.id;
  }

  removeTask(id: string) {
    this.appState.removeHttpTask(id);
  }

  toggleExpand(task: BackgroundTask) {
    task.isExpanded = !task.isExpanded;
  }
}
