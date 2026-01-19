export interface DiskStats {
  name: string;
  free_space: number;
  total_space: number;
}

export interface SystemStats {
  free_memory: number;
  total_memory: number;
  disks: DiskStats[];
}